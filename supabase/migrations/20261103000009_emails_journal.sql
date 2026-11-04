-- Story 1.7 — Email de confirmation et journal (AD-4, AD-5, AD-13, AD-14,
-- AD-15, AD-19, AD-20).
--
-- Crée :
--   - la table `journal` (ajout seulement, types fermés, jamais de donnée de
--     demandeur) ;
--   - l'utilitaire `prive.ecrire_journal`, seule écriture du journal ;
--   - `noter_resultat_email(id, etat, code)` : résultat de l'envoi de l'email
--     de confirmation, passage autorisé seulement depuis `en_attente`,
--     réservée à `service_role` ;
--
-- Remplace (même signature, mêmes droits) :
--   - `deposer_demande` : renvoie aussi les données de l'email (AD-13) :
--     identifiant, objet, date, contact, et `nouvelle` (vrai seulement pour
--     l'appel qui a créé la demande : un second envoi avec la même clé ne
--     renvoie pas l'email) ;
--   - `lire_confirmation` : renvoie aussi l'état de l'email.
--
-- Le journal n'a aucun droit direct, pour personne (lecture : story 5.1).

-- 1. Journal (ajout seulement, AD-5, AD-19) ------------------------------

create table public.journal (
  id          bigint      generated always as identity primary key,
  type        text        not null
                          check (type in ('compte', 'parametre', 'categorie', 'donnees',
                                          'email', 'connexion')),
  -- Codes et identifiants seulement ; jamais l'adresse ni le nom d'un demandeur (AD-14).
  details     jsonb       not null default '{}'::jsonb
                          check (jsonb_typeof(details) = 'object'),
  -- « membre » (action d'un membre) ou « systeme » (application, tâche planifiée).
  auteur_type text        not null check (auteur_type in ('membre', 'systeme')),
  auteur_id   uuid        references public.membres (id),
  cree_le     timestamptz not null default now(),

  constraint journal_auteur_coherent check (
    (auteur_type = 'systeme' and auteur_id is null)
    or (auteur_type = 'membre' and auteur_id is not null)
  )
);

comment on table public.journal is
  'Journal des événements, en ajout seulement. Écrit uniquement via prive.ecrire_journal. Ne cite jamais un demandeur (AD-14).';

create index journal_cree_le_idx on public.journal (cree_le desc);

alter table public.journal enable row level security;

-- Aucune règle RLS ni aucun droit direct, même pour la clé secrète.
revoke all on table public.journal from public, anon, authenticated, service_role;
revoke all on sequence public.journal_id_seq from public, anon, authenticated, service_role;

-- Ajout seulement : aucune ligne n'est jamais modifiée (la purge au-delà
-- d'un an, AD-23, passera par `purger_technique`).
create function prive.refuser_modification_journal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Le journal ne se modifie pas.';
end;
$$;

create trigger journal_ajout_seulement
  before update on public.journal
  for each row execute function prive.refuser_modification_journal();

-- 2. Utilitaire d'écriture du journal ------------------------------------
-- Appelé seulement par les fonctions SQL (propriétaire postgres). Aucun
-- droit EXECUTE accordé. Sans auteur : « systeme ».

create function prive.ecrire_journal(
  p_type      text,
  p_details   jsonb default '{}'::jsonb,
  p_auteur_id uuid  default null
)
returns void
language sql
set search_path = ''
as $$
  insert into public.journal (type, details, auteur_type, auteur_id)
  values (p_type,
          coalesce(p_details, '{}'::jsonb),
          case when p_auteur_id is null then 'systeme' else 'membre' end,
          p_auteur_id);
$$;

comment on function prive.ecrire_journal(text, jsonb, uuid) is
  'Seule écriture du journal (AD-19). Sans auteur : le système.';

revoke all on function prive.ecrire_journal(text, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function prive.refuser_modification_journal()
  from public, anon, authenticated, service_role;

-- 3. Résultat de l'envoi de l'email --------------------------------------
-- Appelée par l'action `deposer` après l'envoi (AD-13). Erreurs prévues :
--   DONNEES_INVALIDES (état inconnu ou non permis),
--   DEMANDE_INTROUVABLE (identifiant inconnu),
--   EMAIL_DEJA_NOTE (l'état n'est plus `en_attente` : seul le premier
--   passage compte).
-- Un échec écrit une ligne `email` au journal, auteur « système », avec la
-- référence et le code d'erreur, jamais l'adresse du demandeur (AD-14).

create function public.noter_resultat_email(
  p_demande_id  uuid,
  p_etat        text,
  p_code_erreur text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  -- Code d'erreur court, en minuscules (ex. `delai_depasse`, `invalid_api_key`) :
  -- tout autre texte est remplacé, pour ne jamais recopier un message
  -- qui contiendrait une adresse.
  v_code      text := case
                        when p_code_erreur ~ '^[a-z0-9_]{1,64}$' then p_code_erreur
                        else 'inconnu'
                      end;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  if p_etat is null or p_etat not in ('envoye', 'echec', 'non_envoye_demo') then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  update public.demandes d
     set etat_email = p_etat
   where d.id = p_demande_id
     and d.etat_email = 'en_attente'
  returning d.reference into v_reference;

  if v_reference is null then
    if exists (select 1 from public.demandes d where d.id = p_demande_id) then
      raise exception using errcode = 'P0001', message = 'EMAIL_DEJA_NOTE';
    end if;
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  if p_etat = 'echec' then
    perform prive.ecrire_journal(
      'email',
      jsonb_build_object('evenement', 'echec_confirmation',
                         'reference', v_reference,
                         'code', v_code)
    );
  end if;
end;
$$;

comment on function public.noter_resultat_email(uuid, text, text) is
  'Résultat de l''email de confirmation, depuis en_attente seulement (AD-13). EXECUTE réservé à service_role.';

revoke all on function public.noter_resultat_email(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.noter_resultat_email(uuid, text, text) to service_role;

-- 4. Dépôt public : renvoie aussi les données de l'email -----------------
-- Même logique que la migration 20261103000003 ; seule la réponse change :
--   reference, jeton (inchangés), id, objet, cree_le, nom_affiche,
--   email_contact, et nouvelle (vrai pour l'appel qui a créé la demande).
-- `create or replace` garde les droits : EXECUTE à service_role seul.

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

  -- Second envoi avec la même clé : la demande déjà créée (sans renvoi d'email).
  select jsonb_build_object(
           'reference', d.reference, 'jeton', d.jeton_confirmation, 'id', d.id,
           'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
           'email_contact', p.email_contact, 'nouvelle', false)
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
               'email_contact', p.email_contact, 'nouvelle', false)
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
             'email_contact', p.email_contact, 'nouvelle', true)
      from public.demandes d
      left join public.parametres p on true
     where d.id = v_id
  );
end;
$$;

-- 5. Page de confirmation : renvoie aussi l'état de l'email -------------
-- La phrase « Un email de confirmation vous a été envoyé. » ne s'affiche
-- que si l'état vaut `envoye`. Toujours aucune donnée du demandeur.

create or replace function public.lire_confirmation(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reference',     d.reference,
    'nom_affiche',   p.nom_affiche,
    'email_contact', p.email_contact,
    'etat_email',    d.etat_email
  )
  from public.demandes d
  cross join public.parametres p
  where p_jeton ~ '^[0-9a-f]{64}$'
    and d.jeton_confirmation = p_jeton
    and d.cree_le > now() - interval '24 hours';
$$;

-- PostgREST : prise en compte immédiate de la nouvelle fonction.
notify pgrst, 'reload schema';
