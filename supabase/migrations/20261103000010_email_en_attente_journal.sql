-- Story 1.7 (correctifs) — Email jamais bloqué en attente, journal protégé
-- contre l'effacement (AD-5, AD-13).
--
-- 1. `deposer_demande` (même signature, mêmes droits) renvoie aussi
--    `etat_email` : l'action renvoie l'email tant qu'il est `en_attente`
--    (premier appel coupé, notation perdue, second envoi de la même clé) ;
--    la clé d'idempotence de Resend évite les doublons.
-- 2. `journal` : DELETE et TRUNCATE refusés, sauf si la transaction a posé
--    le drapeau local `nova.purge_journal` à `on`
--    (`select set_config('nova.purge_journal', 'on', true)`), réservé à la
--    future purge au-delà d'un an (`purger_technique`, AD-23).

-- 1. Dépôt public : renvoie aussi l'état de l'email ----------------------

create or replace function public.deposer_demande(
  p_cle_envoi     uuid,
  p_nom           text,
  p_email         text,
  p_telephone     text,
  p_societe       text,
  p_categorie_id  uuid,
  p_objet         text,
  p_description   text,
  p_consentement  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Espaces retirés en début et fin (comme le trim de Zod pour l'ASCII).
  v_blancs      constant text := E' \t\n\r\f\v';
  v_nom         text := btrim(p_nom, v_blancs);
  v_email       text := lower(btrim(p_email, v_blancs));
  v_telephone   text := nullif(btrim(p_telephone, v_blancs), '');
  v_societe     text := nullif(btrim(p_societe, v_blancs), '');
  v_objet       text := btrim(p_objet, v_blancs);
  v_description text := btrim(p_description, v_blancs);
  v_existante   jsonb;
  v_annee       integer;
  v_numero      integer;
  v_reference   text;
  v_jeton       text;
  v_id          uuid;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  -- Second envoi avec la même clé : la demande déjà créée, avec l'état de son
  -- email (l'action renvoie l'email s'il est encore `en_attente`).
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
  exception
    when unique_violation then
      -- Même clé envoyée en même temps par un autre appel : le compteur est
      -- annulé avec ce bloc, on renvoie la demande créée par l'autre appel
      -- (qui, lui, envoie l'email).
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

-- 2. Journal : effacement seulement par la purge --------------------------

create function prive.refuser_effacement_journal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('nova.purge_journal', true), '') = 'on' then
    return case when tg_level = 'ROW' then old else null end;
  end if;
  raise exception 'Le journal ne s''efface pas.';
end;
$$;

comment on function prive.refuser_effacement_journal() is
  'Refuse DELETE et TRUNCATE sur journal, sauf drapeau de transaction nova.purge_journal = on (purge, AD-23).';

revoke all on function prive.refuser_effacement_journal()
  from public, anon, authenticated, service_role;

create trigger journal_effacement_refuse
  before delete on public.journal
  for each row execute function prive.refuser_effacement_journal();

create trigger journal_vidage_refuse
  before truncate on public.journal
  for each statement execute function prive.refuser_effacement_journal();

-- PostgREST : prise en compte immédiate de la nouvelle réponse.
notify pgrst, 'reload schema';
