-- Story 4.3 — Retrouver l'accès en cas de mot de passe oublié (AD-1, AD-14,
-- AD-19, AD-20, AD-21, AD-23).
--
-- (Le numéro 0027 est réservé à la story 3.4.)
--
-- 1. Table `demandes_reinitialisation` : une demande « Mot de passe oublié »
--    acceptée = une ligne (empreinte HMAC de l'email, empreinte HMAC de
--    l'IP, date). Jamais d'email ni d'IP en clair. RLS activée, aucun droit
--    pour personne, même la clé secrète : seule `demander_reinitialisation`
--    y écrit. Lignes effacées au-delà d'un jour.
-- 2. `demander_reinitialisation(p_empreinte_email, p_empreinte_ip, p_email)`
--    (service_role, action `demanderLienMotDePasse`) : limite d'au plus une
--    demande par adresse toutes les 60 s, 5 par adresse en 24 h (sinon
--    n'importe qui connaissant l'adresse pourrait invalider sans fin le lien
--    en attente du membre : chaque lien généré remplace le précédent) et 5
--    demandes par IP en 15 minutes (au-delà, rien n'est enregistré ni généré). Renvoie `{ "envoyer": … }` :
--    vrai seulement pour un membre ACTIF, sous la limite. L'écran affiche le
--    même message dans tous les cas : la réponse ne sort jamais de l'action.
-- 3. `noter_lien_mot_de_passe(p_id)` (administrateur actif, avec sa
--    session) : vérifie que le membre est actif (ETAT_COMPTE_INVALIDE sinon),
--    écrit la ligne de journal `lien_mot_de_passe_genere` et renvoie l'email
--    du membre, pour que l'action génère le lien (`generateLink`, recovery).
--
-- Erreurs prévues : DONNEES_INVALIDES, DROIT_INSUFFISANT, ETAT_COMPTE_INVALIDE.

-- 1. Table des demandes -----------------------------------------------------

create table public.demandes_reinitialisation (
  id              bigint      generated always as identity primary key,
  -- HMAC-SHA-256 de l'email (minuscules, sans espaces) et de l'IP, en
  -- hexadécimal : jamais l'adresse elle-même.
  empreinte_email text        not null check (empreinte_email ~ '^[0-9a-f]{64}$'),
  empreinte_ip    text        not null check (empreinte_ip ~ '^[0-9a-f]{64}$'),
  cree_le         timestamptz not null default now()
);

comment on table public.demandes_reinitialisation is
  'Demandes « Mot de passe oublié » acceptées (limite : 1 par adresse en 60 s, 5 par adresse en 24 h, 5 par IP en 15 min) : empreintes HMAC de l''email et de l''IP seulement, effacées au-delà d''un jour (AD-23). Écrit uniquement par demander_reinitialisation.';

create index demandes_reinitialisation_email_idx
  on public.demandes_reinitialisation (empreinte_email, cree_le);
create index demandes_reinitialisation_ip_idx
  on public.demandes_reinitialisation (empreinte_ip, cree_le);
create index demandes_reinitialisation_cree_le_idx
  on public.demandes_reinitialisation (cree_le);

alter table public.demandes_reinitialisation enable row level security;

-- Aucune règle RLS ni aucun droit direct, même pour la clé secrète.
revoke all on table public.demandes_reinitialisation
  from public, anon, authenticated, service_role;
revoke all on sequence public.demandes_reinitialisation_id_seq
  from public, anon, authenticated, service_role;

-- 2. Demande de lien ---------------------------------------------------------

create function public.demander_reinitialisation(
  p_empreinte_email text,
  p_empreinte_ip    text,
  p_email           text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Une demande par adresse toutes les 60 s et 5 en 24 h ; 5 par IP en
  -- 15 minutes.
  c_delai_email  constant interval := interval '60 seconds';
  c_limite_jour  constant integer  := 5;
  c_fenetre_jour constant interval := interval '24 hours';
  c_limite_ip    constant integer  := 5;
  c_fenetre_ip   constant interval := interval '15 minutes';
  -- Demandes gardées au plus un jour (AD-23).
  c_conservation constant interval := interval '1 day';
  v_email        text := lower(btrim(p_email, E' \t\n\r\f\v'));
  v_limite       boolean;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  if p_empreinte_email is null or p_empreinte_email !~ '^[0-9a-f]{64}$'
     or p_empreinte_ip is null or p_empreinte_ip !~ '^[0-9a-f]{64}$'
     or v_email is null or v_email = '' or char_length(v_email) > 254
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Verrou jusqu'à la fin de la transaction, toujours dans le même ordre
  -- (email puis IP) : des demandes simultanées passent l'une après l'autre
  -- et la limite ne peut pas être dépassée.
  perform pg_advisory_xact_lock(hashtextextended('demandes_reinitialisation:email:' || p_empreinte_email, 0));
  perform pg_advisory_xact_lock(hashtextextended('demandes_reinitialisation:ip:' || p_empreinte_ip, 0));

  v_limite :=
    exists (
      select 1
        from public.demandes_reinitialisation d
       where d.empreinte_email = p_empreinte_email
         and d.cree_le > now() - c_delai_email
    )
    or (
      select count(*)
        from public.demandes_reinitialisation d
       where d.empreinte_email = p_empreinte_email
         and d.cree_le > now() - c_fenetre_jour
    ) >= c_limite_jour
    or (
      select count(*)
        from public.demandes_reinitialisation d
       where d.empreinte_ip = p_empreinte_ip
         and d.cree_le > now() - c_fenetre_ip
    ) >= c_limite_ip;

  -- Demandes de plus d'un jour effacées au passage (AD-23).
  delete from public.demandes_reinitialisation d
   where d.cree_le < now() - c_conservation;

  if v_limite then
    -- Au-delà de la limite : rien n'est enregistré ni généré.
    return jsonb_build_object('envoyer', false);
  end if;

  insert into public.demandes_reinitialisation (empreinte_email, empreinte_ip)
  values (p_empreinte_email, p_empreinte_ip);

  -- Seul un membre actif reçoit un lien (jamais un invité ni un désactivé).
  return jsonb_build_object(
    'envoyer',
    exists (
      select 1
        from public.membres m
       where m.email = v_email
         and m.etat = 'actif'
    )
  );
end;
$$;

comment on function public.demander_reinitialisation(text, text, text) is
  'Demande « Mot de passe oublié » (action demanderLienMotDePasse) : limite 1 par adresse en 60 s, 5 par adresse en 24 h et 5 par IP en 15 min ; renvoie envoyer = vrai seulement pour un membre actif sous la limite. EXECUTE réservé à service_role.';

revoke all on function public.demander_reinitialisation(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.demander_reinitialisation(text, text, text) to service_role;

-- 3. Lien généré par l'administrateur ----------------------------------------

create function public.noter_lien_mot_de_passe(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur uuid := auth.uid();
  v_nom    text;
  v_email  text;
  v_etat   text;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_id is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Ligne verrouillée : une désactivation simultanée attend la fin.
  select m.nom, m.email, m.etat
    into v_nom, v_email, v_etat
    from public.membres m
   where m.id = p_id
     for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if v_etat <> 'actif' then
    raise exception using errcode = 'P0001', message = 'ETAT_COMPTE_INVALIDE';
  end if;

  perform prive.ecrire_journal(
    'compte',
    jsonb_build_object(
      'evenement', 'lien_mot_de_passe_genere',
      'membre_id', p_id,
      'nom',       v_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'nom', v_nom, 'email', v_email);
end;
$$;

comment on function public.noter_lien_mot_de_passe(uuid) is
  'Lien de mot de passe généré par un administrateur (story 4.3) : membre actif seulement (ETAT_COMPTE_INVALIDE), journal lien_mot_de_passe_genere ; renvoie l''email du membre. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.noter_lien_mot_de_passe(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.noter_lien_mot_de_passe(uuid) to authenticated;

-- PostgREST : prise en compte immédiate des nouvelles fonctions.
notify pgrst, 'reload schema';
