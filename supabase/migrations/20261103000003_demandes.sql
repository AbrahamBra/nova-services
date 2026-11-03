-- Story 1.3 — Demandes, références, historique et dépôt public
-- (AD-5, AD-6, AD-15, AD-16, AD-18, AD-19, AD-20, AD-22, AD-24, AD-26, AD-31).
--
-- Crée :
--   - la table `compteurs_reference` (un dernier numéro par année, heure de Paris) ;
--   - la table `demandes` (codes fermés, longueurs maximales, email en minuscules) ;
--   - la table `historique` (ajout seulement) ;
--   - le déclencheur des dates de `demandes` (AD-22) ;
--   - l'utilitaire `prive.ecrire_historique` ;
--   - `deposer_demande(...)` : dépôt public, idempotent par `cle_envoi` ;
--   - `lire_confirmation(jeton)` : référence et contact pendant 24 h.
--
-- RLS est activée sur les trois tables, sans aucune règle : `anon` et
-- `authenticated` n'ont aucun droit (migration 20261103000001). Seul
-- `service_role` exécute `deposer_demande` et `lire_confirmation`.
--
-- `responsable_id` et `saisie_par_id` n'ont pas encore de clé étrangère :
-- la table `membres` arrive à la story 1.4, qui l'ajoutera.

-- 1. Compteurs de référence ---------------------------------------------

create table public.compteurs_reference (
  annee          integer primary key check (annee between 2000 and 9999),
  dernier_numero integer not null check (dernier_numero >= 1)
);

comment on table public.compteurs_reference is
  'Dernier numéro de référence attribué, par année civile (heure de Paris). Modifié uniquement par les fonctions de dépôt (AD-6).';

alter table public.compteurs_reference enable row level security;

-- 2. Demandes ------------------------------------------------------------

create table public.demandes (
  id                  uuid        primary key default gen_random_uuid(),
  reference           text        not null unique
                                  check (reference ~ '^NOVA-[0-9]{4}-[0-9]{4,}$'),
  -- Jeton aléatoire de la page de confirmation (64 caractères hexadécimaux).
  jeton_confirmation  text        not null unique
                                  check (jeton_confirmation ~ '^[0-9a-f]{64}$'),
  -- Clé créée à l'affichage du formulaire : un second envoi renvoie la même demande (AD-26).
  cle_envoi           uuid        not null unique,
  canal               text        not null
                                  check (canal in ('formulaire', 'telephone', 'email')),
  nom                 text        not null
                                  check (nom = btrim(nom) and char_length(nom) between 1 and 150),
  -- Facultatif pour la saisie interne (story 2.x), obligatoire pour le formulaire.
  email               text        check (email = lower(btrim(email))
                                         and char_length(email) between 3 and 254
                                         and email like '%_@_%'),
  telephone           text        check (telephone = btrim(telephone)
                                         and char_length(telephone) between 1 and 30),
  societe             text        check (societe = btrim(societe)
                                         and char_length(societe) between 1 and 150),
  objet               text        not null
                                  check (objet = btrim(objet) and char_length(objet) between 1 and 150),
  description         text        not null
                                  check (char_length(btrim(description)) >= 1
                                         and char_length(description) <= 5000),
  categorie_id        uuid        not null references public.categories (id),
  statut              text        not null default 'nouvelle'
                                  check (statut in ('nouvelle', 'en_cours', 'traitee')),
  priorite            text        not null default 'normale'
                                  check (priorite in ('basse', 'normale', 'haute')),
  responsable_id      uuid,       -- clé étrangère vers membres : story 1.4
  saisie_par_id       uuid,       -- clé étrangère vers membres : story 1.4
  consentement_le     timestamptz,
  etat_email          text        not null default 'en_attente'
                                  check (etat_email in ('en_attente', 'envoye', 'echec',
                                                        'non_envoye_demo', 'sans_email')),
  cree_le             timestamptz not null default now(),
  traitee_le          timestamptz,
  mis_a_jour_le       timestamptz not null default now(),

  -- Une demande déposée par le formulaire a toujours un email et un consentement.
  constraint demandes_formulaire_complet check (
    canal <> 'formulaire' or (email is not null and consentement_le is not null)
  )
);

comment on table public.demandes is
  'Demandes des clients. Écrites uniquement par les fonctions SQL (dépôt, saisie, traitement).';

create index demandes_cree_le_idx      on public.demandes (cree_le desc);
create index demandes_email_idx        on public.demandes (email);
create index demandes_categorie_id_idx on public.demandes (categorie_id);

alter table public.demandes enable row level security;

-- 3. Dates gérées par la base (AD-22) -----------------------------------
-- Seul endroit qui écrit `mis_a_jour_le` et `traitee_le` (dernier passage à
-- Traitée). Aucune fonction ne les écrit elle-même.

create function prive.dates_demande()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.mis_a_jour_le := now();
    new.traitee_le := case when new.statut = 'traitee' then now() end;
  else
    new.mis_a_jour_le := now();
    if new.statut = 'traitee' and old.statut is distinct from 'traitee' then
      new.traitee_le := now();
    else
      new.traitee_le := old.traitee_le;
    end if;
  end if;
  return new;
end;
$$;

comment on function prive.dates_demande() is
  'Déclencheur de demandes : met à jour mis_a_jour_le et traitee_le (AD-22).';

create trigger demandes_dates
  before insert or update on public.demandes
  for each row execute function prive.dates_demande();

-- 4. Historique (ajout seulement, AD-5, AD-19) ---------------------------

create table public.historique (
  id              bigint      generated always as identity primary key,
  demande_id      uuid        not null references public.demandes (id) on delete cascade,
  -- « demandeur » (dépôt par le formulaire) ou « membre » (action de l'équipe).
  auteur_type     text        not null check (auteur_type in ('demandeur', 'membre')),
  auteur_id       uuid,       -- clé étrangère vers membres : story 1.4
  type            text        not null
                              check (type in ('creation', 'prise_en_charge', 'attribution',
                                              'liberation', 'changement_statut',
                                              'classement_sans_suite', 'changement_priorite',
                                              'changement_categorie', 'note_ajoutee',
                                              'retour_nouvelle')),
  -- Codes (AD-18) ou identifiants, jamais des libellés.
  ancienne_valeur text,
  nouvelle_valeur text,
  cree_le         timestamptz not null default now(),

  constraint historique_auteur_coherent check (
    (auteur_type = 'demandeur' and auteur_id is null)
    or (auteur_type = 'membre' and auteur_id is not null)
  )
);

comment on table public.historique is
  'Historique des demandes, en ajout seulement. Écrit uniquement via prive.ecrire_historique.';

create index historique_demande_id_idx on public.historique (demande_id, cree_le);

alter table public.historique enable row level security;

-- Ajout seulement : aucune ligne n'est jamais modifiée (les suppressions
-- passent par l'effacement complet d'une demande, en cascade).
create function prive.refuser_modification_historique()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'L''historique ne se modifie pas.';
end;
$$;

create trigger historique_ajout_seulement
  before update on public.historique
  for each row execute function prive.refuser_modification_historique();

-- 5. Utilitaire d'écriture de l'historique -------------------------------
-- Appelé seulement par les fonctions SQL (propriétaire postgres). Aucun
-- droit EXECUTE accordé. Sans auteur : « demandeur ».

create function prive.ecrire_historique(
  p_demande_id      uuid,
  p_type            text,
  p_auteur_id       uuid default null,
  p_ancienne_valeur text default null,
  p_nouvelle_valeur text default null
)
returns void
language sql
set search_path = ''
as $$
  insert into public.historique
    (demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur)
  values
    (p_demande_id,
     case when p_auteur_id is null then 'demandeur' else 'membre' end,
     p_auteur_id, p_type, p_ancienne_valeur, p_nouvelle_valeur);
$$;

comment on function prive.ecrire_historique(uuid, text, uuid, text, text) is
  'Seule écriture de l''historique (AD-19). Sans auteur : le demandeur.';

-- 6. Dépôt public ---------------------------------------------------------
-- Appelée par l'action serveur `deposer` avec la clé secrète, après Zod.
-- Revérifie tout (appel direct possible avec la clé secrète) et lève des
-- erreurs prévues en P0001 (AD-20) :
--   CONSENTEMENT_REQUIS, DONNEES_INVALIDES, CATEGORIE_INVALIDE.
-- Idempotente : une même `cle_envoi` renvoie la demande déjà créée (AD-26).

create function public.deposer_demande(
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

  -- Second envoi avec la même clé : la demande déjà créée.
  select jsonb_build_object('reference', d.reference, 'jeton', d.jeton_confirmation)
    into v_existante
    from public.demandes d
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
      -- annulé avec ce bloc, on renvoie la demande créée par l'autre appel.
      select jsonb_build_object('reference', d.reference, 'jeton', d.jeton_confirmation)
        into v_existante
        from public.demandes d
       where d.cle_envoi = p_cle_envoi;
      if v_existante is null then
        raise;
      end if;
      return v_existante;
  end;

  return jsonb_build_object('reference', v_reference, 'jeton', v_jeton);
end;
$$;

comment on function public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean) is
  'Dépôt public (action deposer). Idempotent par cle_envoi. EXECUTE réservé à service_role.';

revoke all on function public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean)
  to service_role;

-- 7. Page de confirmation ------------------------------------------------
-- Renvoie la référence et le contact de Nova, jamais de donnée du demandeur,
-- pendant 24 h après le dépôt. Jeton inconnu, mal formé ou expiré : null.

create function public.lire_confirmation(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reference',     d.reference,
    'nom_affiche',   p.nom_affiche,
    'email_contact', p.email_contact
  )
  from public.demandes d
  cross join public.parametres p
  where p_jeton ~ '^[0-9a-f]{64}$'
    and d.jeton_confirmation = p_jeton
    and d.cree_le > now() - interval '24 hours';
$$;

comment on function public.lire_confirmation(text) is
  'Référence et contact affichés sur /confirmation/[jeton], pendant 24 h. EXECUTE réservé à service_role.';

revoke all on function public.lire_confirmation(text) from public, anon, authenticated;
grant execute on function public.lire_confirmation(text) to service_role;
