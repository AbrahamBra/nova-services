-- Story 5.2 — Gérer les catégories (règle 9, AD-1, AD-19, AD-20).
--
-- Crée :
--   - l'index unique `categories_nom_normalise_key` sur
--     `prive.normaliser(nom)` : un nom unique sans tenir compte des
--     majuscules, des accents, des tirets ni des apostrophes, sur TOUTES les
--     catégories, actives ou non (« formation » et « Formatión » refusés si
--     « Formation » existe) ;
--   - `lister_categories_admin()` : id, nom, actif, ordre et nombre de
--     demandes (toutes confondues) de chaque catégorie, triées `ordre, nom` ;
--   - `ajouter_categorie(p_nom)` : catégorie active, en dernière position
--     (`ordre` = max + 1) ;
--   - `renommer_categorie(p_id, p_nom)` : le nom est lu en direct partout
--     (liste, détail, filtres, anciennes demandes) ;
--   - `desactiver_categorie(p_id)` : plus proposée dans le formulaire ni dans
--     le choix de catégorie ; les demandes qui l'utilisent la gardent (aucune
--     demande n'est modifiée) ;
--   - `activer_categorie(p_id)` : de nouveau proposée.
--
-- Toutes : SECURITY DEFINER, search_path vide, administrateur actif vérifié
-- en premier (DROIT_INSUFFISANT), EXECUTE à authenticated seulement. Chaque
-- changement est inscrit au journal (type `categorie`, auteur =
-- l'administrateur) : categorie_ajoutee, categorie_renommee (seulement si le
-- nom change), categorie_desactivee, categorie_reactivee.
--
-- Garde-fous : il reste toujours au moins une catégorie active, même en cas
-- de désactivations simultanées (verrou consultatif commun, puis
-- DERNIERE_CATEGORIE). Conflit de nom (y compris une course sur l'index
-- unique) : NOM_CATEGORIE_PRIS, avec en DETAIL `{"desactivee": true|false}`
-- (l'écran propose alors de réactiver la catégorie existante).
--
-- Erreurs prévues : DROIT_INSUFFISANT, DONNEES_INVALIDES, NOM_CATEGORIE_PRIS,
-- DERNIERE_CATEGORIE, ETAT_CATEGORIE_INVALIDE.
-- `prive.normaliser` et la vue `demandes_liste` ne changent pas.

-- 1. Nom unique, normalisé -------------------------------------------------

create unique index categories_nom_normalise_key
  on public.categories (prive.normaliser(nom));

-- 2. Utilitaire : nom déjà pris ? ------------------------------------------
-- Lève NOM_CATEGORIE_PRIS si une AUTRE catégorie (que `p_id`) porte déjà ce
-- nom une fois normalisé, avec en DETAIL si elle est désactivée. Appelé
-- seulement par les fonctions ci-dessous (propriétaire postgres) ; aucun
-- droit EXECUTE accordé.

create function prive.verifier_nom_categorie(p_nom text, p_id uuid default null)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_actif boolean;
begin
  select c.actif
    into v_actif
    from public.categories c
   where prive.normaliser(c.nom) = prive.normaliser(p_nom)
     and (p_id is null or c.id <> p_id)
   limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'NOM_CATEGORIE_PRIS',
      detail  = jsonb_build_object('desactivee', not v_actif)::text;
  end if;
end;
$$;

comment on function prive.verifier_nom_categorie(text, uuid) is
  'NOM_CATEGORIE_PRIS (DETAIL {"desactivee": bool}) si une autre catégorie porte déjà ce nom normalisé (story 5.2). Aucun droit EXECUTE.';

revoke all on function prive.verifier_nom_categorie(text, uuid)
  from public, anon, authenticated, service_role;

-- 3. Liste des catégories (page Catégories) --------------------------------

create function public.lister_categories_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  return coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'id',       c.id,
                'nom',      c.nom,
                'actif',    c.actif,
                'ordre',    c.ordre,
                'demandes', (select count(*)::integer
                               from public.demandes d
                              where d.categorie_id = c.id)
              )
              order by c.ordre, c.nom, c.id
            )
       from public.categories c),
    '[]'::jsonb
  );
end;
$$;

comment on function public.lister_categories_admin() is
  'Catégories (id, nom, actif, ordre, nombre de demandes), triées ordre puis nom (story 5.2). Administrateur actif seulement, sinon DROIT_INSUFFISANT. EXECUTE réservé à authenticated.';

revoke all on function public.lister_categories_admin() from public, anon, authenticated, service_role;
grant execute on function public.lister_categories_admin() to authenticated;

-- 4. Ajouter une catégorie -------------------------------------------------

create function public.ajouter_categorie(p_nom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur uuid := auth.uid();
  v_nom    text := btrim(p_nom, E' \t\n\r\f\v');
  v_id     uuid;
  v_ordre  integer;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if v_nom is null or char_length(v_nom) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  perform prive.verifier_nom_categorie(v_nom);

  select coalesce(max(c.ordre), 0) + 1 into v_ordre from public.categories c;

  begin
    insert into public.categories (nom, actif, ordre)
    values (v_nom, true, v_ordre)
    returning id into v_id;
  exception when unique_violation then
    -- Même nom ajouté au même instant par un autre administrateur : la
    -- ligne concurrente est maintenant visible.
    perform prive.verifier_nom_categorie(v_nom);
    raise exception using
      errcode = 'P0001',
      message = 'NOM_CATEGORIE_PRIS',
      detail  = jsonb_build_object('desactivee', false)::text;
  end;

  perform prive.ecrire_journal(
    'categorie',
    jsonb_build_object(
      'evenement',    'categorie_ajoutee',
      'categorie_id', v_id,
      'nom',          v_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', v_id, 'nom', v_nom, 'actif', true, 'ordre', v_ordre);
end;
$$;

comment on function public.ajouter_categorie(text) is
  'Ajoute une catégorie active en dernière position (story 5.2) ; nom de 1 à 80 caractères (DONNEES_INVALIDES), unique une fois normalisé (NOM_CATEGORIE_PRIS). Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.ajouter_categorie(text) from public, anon, authenticated, service_role;
grant execute on function public.ajouter_categorie(text) to authenticated;

-- 5. Renommer une catégorie ------------------------------------------------

create function public.renommer_categorie(p_id uuid, p_nom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur     uuid := auth.uid();
  v_nom        text := btrim(p_nom, E' \t\n\r\f\v');
  v_ancien_nom text;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_id is null or v_nom is null or char_length(v_nom) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select c.nom
    into v_ancien_nom
    from public.categories c
   where c.id = p_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Son propre nom (même seulement les majuscules changées) reste permis.
  perform prive.verifier_nom_categorie(v_nom, p_id);

  if v_nom = v_ancien_nom then
    -- Rien ne change : réussite, rien n'est écrit.
    return jsonb_build_object('id', p_id, 'nom', v_nom, 'modifie', false);
  end if;

  begin
    update public.categories c
       set nom = v_nom
     where c.id = p_id;
  exception when unique_violation then
    perform prive.verifier_nom_categorie(v_nom, p_id);
    raise exception using
      errcode = 'P0001',
      message = 'NOM_CATEGORIE_PRIS',
      detail  = jsonb_build_object('desactivee', false)::text;
  end;

  perform prive.ecrire_journal(
    'categorie',
    jsonb_build_object(
      'evenement',    'categorie_renommee',
      'categorie_id', p_id,
      'nom',          v_nom,
      'ancien_nom',   v_ancien_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'nom', v_nom, 'modifie', true);
end;
$$;

comment on function public.renommer_categorie(uuid, text) is
  'Renomme une catégorie (story 5.2) ; nom de 1 à 80 caractères (DONNEES_INVALIDES), unique une fois normalisé (NOM_CATEGORIE_PRIS). Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.renommer_categorie(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.renommer_categorie(uuid, text) to authenticated;

-- 6. Désactiver une catégorie ----------------------------------------------
-- Les demandes qui l'utilisent la gardent : aucune n'est modifiée.

create function public.desactiver_categorie(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur uuid := auth.uid();
  v_nom    text;
  v_actif  boolean;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_id is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Une seule désactivation à la fois : il reste toujours une catégorie active.
  perform pg_advisory_xact_lock(hashtextextended('categories:actives', 0));

  select c.nom, c.actif
    into v_nom, v_actif
    from public.categories c
   where c.id = p_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if not v_actif then
    raise exception using errcode = 'P0001', message = 'ETAT_CATEGORIE_INVALIDE';
  end if;

  if not exists (
    select 1 from public.categories c where c.id <> p_id and c.actif
  ) then
    raise exception using errcode = 'P0001', message = 'DERNIERE_CATEGORIE';
  end if;

  -- L'appelant a pu perdre ses droits pendant l'attente du verrou.
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  update public.categories c
     set actif = false
   where c.id = p_id;

  perform prive.ecrire_journal(
    'categorie',
    jsonb_build_object(
      'evenement',    'categorie_desactivee',
      'categorie_id', p_id,
      'nom',          v_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'actif', false);
end;
$$;

comment on function public.desactiver_categorie(uuid) is
  'Désactive une catégorie active (story 5.2) ; les demandes la gardent. Jamais la dernière active (DERNIERE_CATEGORIE) ; déjà désactivée : ETAT_CATEGORIE_INVALIDE. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.desactiver_categorie(uuid) from public, anon, authenticated, service_role;
grant execute on function public.desactiver_categorie(uuid) to authenticated;

-- 7. Réactiver une catégorie -----------------------------------------------
-- Aucun conflit de nom possible : l'index unique couvre aussi les
-- catégories désactivées.

create function public.activer_categorie(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur uuid := auth.uid();
  v_nom    text;
  v_actif  boolean;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_id is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select c.nom, c.actif
    into v_nom, v_actif
    from public.categories c
   where c.id = p_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if v_actif then
    raise exception using errcode = 'P0001', message = 'ETAT_CATEGORIE_INVALIDE';
  end if;

  update public.categories c
     set actif = true
   where c.id = p_id;

  perform prive.ecrire_journal(
    'categorie',
    jsonb_build_object(
      'evenement',    'categorie_reactivee',
      'categorie_id', p_id,
      'nom',          v_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'actif', true);
end;
$$;

comment on function public.activer_categorie(uuid) is
  'Réactive une catégorie désactivée (story 5.2), sinon ETAT_CATEGORIE_INVALIDE. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.activer_categorie(uuid) from public, anon, authenticated, service_role;
grant execute on function public.activer_categorie(uuid) to authenticated;

-- PostgREST : prise en compte immédiate des nouvelles fonctions.
notify pgrst, 'reload schema';
