-- Story 1.8 — Bloquer les envois en masse (AD-14, AD-16, AD-23).
--
-- 1. Table `envois_formulaire` : un envoi accepté du formulaire public =
--    une ligne (empreinte HMAC de l'IP, clé d'envoi, date). Jamais d'IP en
--    clair : la colonne n'accepte qu'une empreinte hexadécimale de 64
--    caractères (HMAC-SHA-256, calculée par lib/server/empreintes.ts).
--    RLS activée, aucun droit pour personne, même la clé secrète : seule
--    `deposer_demande` y écrit.
-- 2. `deposer_demande` reçoit `p_empreinte_ip` (nouvelle signature, l'ancienne
--    est supprimée : un ancien appel sans empreinte échoue, il ne peut plus
--    contourner la limite). En une seule transaction, verrou sur l'empreinte :
--    compte les envois des 10 dernières minutes, refuse au-delà de 5
--    (`TROP_D_ENVOIS`), enregistre l'envoi, efface les empreintes de plus
--    d'une heure. Un renvoi de la même `cle_envoi` (demande déjà
--    enregistrée) n'est pas compté.

-- 1. Table des envois ------------------------------------------------------

create table public.envois_formulaire (
  id          bigint      generated always as identity primary key,
  -- HMAC-SHA-256 de l'IP, en hexadécimal : jamais l'adresse elle-même.
  empreinte_ip text       not null check (empreinte_ip ~ '^[0-9a-f]{64}$'),
  cle_envoi   uuid        not null unique,
  cree_le     timestamptz not null default now()
);

comment on table public.envois_formulaire is
  'Envois acceptés du formulaire public (anti-spam, AD-16) : empreinte HMAC de l''IP seulement, effacée au-delà d''une heure (AD-23). Écrit uniquement par deposer_demande.';

create index envois_formulaire_empreinte_idx
  on public.envois_formulaire (empreinte_ip, cree_le);
create index envois_formulaire_cree_le_idx
  on public.envois_formulaire (cree_le);

alter table public.envois_formulaire enable row level security;

-- Aucune règle RLS ni aucun droit direct, même pour la clé secrète.
revoke all on table public.envois_formulaire from public, anon, authenticated, service_role;
revoke all on sequence public.envois_formulaire_id_seq
  from public, anon, authenticated, service_role;

-- 2. Dépôt public avec limite d'envois -------------------------------------

-- Ancienne signature supprimée : sans empreinte, plus aucun dépôt possible.
drop function public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean);

create function public.deposer_demande(
  p_cle_envoi     uuid,
  p_nom           text,
  p_email         text,
  p_telephone     text,
  p_societe       text,
  p_categorie_id  uuid,
  p_objet         text,
  p_description   text,
  p_consentement  boolean,
  p_empreinte_ip  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Limite : 5 envois en 10 minutes par empreinte d'IP (AD-16).
  c_limite      constant integer  := 5;
  c_fenetre     constant interval := interval '10 minutes';
  -- Empreintes gardées au plus une heure (AD-23).
  c_conservation constant interval := interval '1 hour';
  -- Espaces retirés en début et fin (comme le trim de Zod pour l'ASCII).
  v_blancs      constant text := E' \t\n\r\f\v';
  v_nom         text := btrim(p_nom, v_blancs);
  v_email       text := lower(btrim(p_email, v_blancs));
  v_telephone   text := nullif(btrim(p_telephone, v_blancs), '');
  v_societe     text := nullif(btrim(p_societe, v_blancs), '');
  v_objet       text := btrim(p_objet, v_blancs);
  v_description text := btrim(p_description, v_blancs);
  v_existante   jsonb;
  v_envois      integer;
  v_annee       integer;
  v_numero      integer;
  v_reference   text;
  v_jeton       text;
  v_id          uuid;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  -- Second envoi avec la même clé : la demande déjà créée, avec l'état de son
  -- email. Pas compté comme un nouvel envoi.
  select jsonb_build_object(
           'reference', d.reference, 'jeton', d.jeton_confirmation, 'id', d.id,
           'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
           'email_contact', p.email_contact, 'nouvelle', false,
           'etat_email', d.etat_email)
    into v_existante
    from public.demandes d
    left join public.parametres p on true
   where d.cle_envoi = p_cle_envoi;
  if v_existante is not null then
    return v_existante;
  end if;

  if p_consentement is distinct from true then
    raise exception using errcode = 'P0001', message = 'CONSENTEMENT_REQUIS';
  end if;

  if p_cle_envoi is null
     or p_empreinte_ip is null or p_empreinte_ip !~ '^[0-9a-f]{64}$'
     or v_nom is null or char_length(v_nom) not between 1 and 150
     or v_email is null or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or (v_telephone is not null and char_length(v_telephone) > 30)
     or (v_societe is not null and char_length(v_societe) > 150)
     or v_objet is null or char_length(v_objet) not between 1 and 150
     or v_description is null or char_length(v_description) not between 1 and 5000
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if p_categorie_id is null or not exists (
    select 1 from public.categories c where c.id = p_categorie_id and c.actif
  ) then
    raise exception using errcode = 'P0001', message = 'CATEGORIE_INVALIDE';
  end if;

  -- Limite d'envois. Verrou sur l'empreinte jusqu'à la fin de la
  -- transaction : deux envois simultanés de la même IP passent l'un après
  -- l'autre, le second voit l'envoi du premier (nouvelle image de la base à
  -- chaque instruction) et la limite ne peut pas être dépassée.
  perform pg_advisory_xact_lock(hashtextextended('envois_formulaire:' || p_empreinte_ip, 0));

  -- Même clé enregistrée par un autre appel pendant l'attente du verrou :
  -- la demande existante, sans compter un nouvel envoi.
  select jsonb_build_object(
           'reference', d.reference, 'jeton', d.jeton_confirmation, 'id', d.id,
           'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
           'email_contact', p.email_contact, 'nouvelle', false,
           'etat_email', d.etat_email)
    into v_existante
    from public.demandes d
    left join public.parametres p on true
   where d.cle_envoi = p_cle_envoi;
  if v_existante is not null then
    return v_existante;
  end if;

  select count(*)::integer
    into v_envois
    from public.envois_formulaire e
   where e.empreinte_ip = p_empreinte_ip
     and e.cree_le > now() - c_fenetre;
  if v_envois >= c_limite then
    raise exception using errcode = 'P0001', message = 'TROP_D_ENVOIS';
  end if;

  begin
    -- Numéro suivant de l'année (heure de Paris). L'upsert verrouille la
    -- ligne de l'année jusqu'à la fin de la transaction : deux dépôts
    -- simultanés reçoivent deux numéros consécutifs (AD-6).
    v_annee := extract(year from (now() at time zone 'Europe/Paris'))::integer;

    insert into public.compteurs_reference as c (annee, dernier_numero)
    values (v_annee, 1)
    on conflict (annee) do update
      set dernier_numero = c.dernier_numero + 1
    returning c.dernier_numero into v_numero;

    -- 4 chiffres minimum, davantage au-delà de 9 999.
    v_reference := 'NOVA-' || v_annee::text || '-'
                   || lpad(v_numero::text, greatest(4, char_length(v_numero::text)), '0');

    -- 256 bits aléatoires (gen_random_uuid utilise un générateur sûr).
    v_jeton := replace(gen_random_uuid()::text, '-', '')
               || replace(gen_random_uuid()::text, '-', '');

    insert into public.demandes
      (reference, jeton_confirmation, cle_envoi, canal, nom, email, telephone, societe,
       objet, description, categorie_id, consentement_le)
    values
      (v_reference, v_jeton, p_cle_envoi, 'formulaire', v_nom, v_email, v_telephone,
       v_societe, v_objet, v_description, p_categorie_id, now())
    returning id into v_id;

    perform prive.ecrire_historique(v_id, 'creation', null, null, 'formulaire');

    -- Envoi compté (annulé avec ce bloc si la clé existait déjà).
    insert into public.envois_formulaire (empreinte_ip, cle_envoi)
    values (p_empreinte_ip, p_cle_envoi);
  exception
    when unique_violation then
      -- Même clé envoyée en même temps par un autre appel (autre IP) : le
      -- compteur et l'envoi sont annulés avec ce bloc, on renvoie la demande
      -- créée par l'autre appel (qui, lui, envoie l'email).
      select jsonb_build_object(
               'reference', d.reference, 'jeton', d.jeton_confirmation, 'id', d.id,
               'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
               'email_contact', p.email_contact, 'nouvelle', false,
               'etat_email', d.etat_email)
        into v_existante
        from public.demandes d
        left join public.parametres p on true
       where d.cle_envoi = p_cle_envoi;
      if v_existante is null then
        raise;
      end if;
      return v_existante;
  end;

  -- Empreintes de plus d'une heure effacées au passage (AD-23).
  delete from public.envois_formulaire e
   where e.cree_le < now() - c_conservation;

  return (
    select jsonb_build_object(
             'reference', d.reference, 'jeton', d.jeton_confirmation, 'id', d.id,
             'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
             'email_contact', p.email_contact, 'nouvelle', true,
             'etat_email', d.etat_email)
      from public.demandes d
      left join public.parametres p on true
     where d.id = v_id
  );
end;
$$;

comment on function public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean, text) is
  'Dépôt public (action deposer). Idempotent par cle_envoi. Limite : 5 envois en 10 minutes par empreinte HMAC d''IP (TROP_D_ENVOIS). EXECUTE réservé à service_role.';

revoke all on function public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean, text)
  to service_role;

-- PostgREST : prise en compte immédiate de la nouvelle signature.
notify pgrst, 'reload schema';
