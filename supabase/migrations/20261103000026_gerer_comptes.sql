-- Story 4.2 — Modifier, désactiver ou réactiver un compte (AD-1, AD-3, AD-19, AD-20).
--
-- Crée :
--   - `modifier_membre(p_id, p_nom, p_role)` : nom et rôle d'un membre ;
--   - `desactiver_membre(p_id)` : `actif` → `desactive` ; ses demandes En
--     cours reviennent en Nouvelle, sans responsable (règle 7) ;
--   - `reactiver_membre(p_id)` : `desactive` → `actif`.
-- Remplace (même signature) :
--   - `lister_comptes()` : en plus, `demandes_en_cours` de chaque compte
--     (annoncé dans la fenêtre « Désactiver ») ;
--   - `verifier_email_libre(p_email)` : COMPTE_DESACTIVE (id du membre en
--     DETAIL) pour l'adresse d'un compte désactivé, au lieu
--     d'EMAIL_DEJA_UTILISE (proposition « Réactiver ce compte »).
--
-- Garde-fous (règle 8) : un administrateur ne se désactive pas et ne change
-- pas son propre rôle (PROPRE_COMPTE) ; il reste toujours au moins un
-- administrateur ACTIF, même en cas d'actions simultanées : `modifier_membre`
-- et `desactiver_membre` passent l'une après l'autre (verrou consultatif
-- commun) et lèvent DERNIER_ADMIN s'il ne resterait aucun administrateur
-- actif. Après l'attente du verrou, l'appelant est revérifié (il a pu être
-- rétrogradé ou désactivé entre-temps) : DROIT_INSUFFISANT.
--
-- Erreurs prévues : DROIT_INSUFFISANT, DONNEES_INVALIDES, PROPRE_COMPTE,
-- ETAT_COMPTE_INVALIDE, DERNIER_ADMIN, COMPTE_DESACTIVE, EMAIL_DEJA_UTILISE.

-- 1. Modifier un membre ----------------------------------------------------

create function public.modifier_membre(p_id uuid, p_nom text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur uuid := auth.uid();
  v_nom    text := btrim(p_nom, E' \t\n\r\f\v');
  v_ancien_nom  text;
  v_ancien_role text;
  v_etat        text;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_id is null
     or v_nom is null or char_length(v_nom) not between 1 and 150
     or p_role is null or p_role not in ('collaborateur', 'administrateur')
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Un seul changement de rôle ou désactivation à la fois (règle 8).
  perform pg_advisory_xact_lock(hashtextextended('membres:administrateurs', 0));

  select m.nom, m.role, m.etat
    into v_ancien_nom, v_ancien_role, v_etat
    from public.membres m
   where m.id = p_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Sur soi-même : le nom seulement.
  if p_id = v_auteur and p_role <> v_ancien_role then
    raise exception using errcode = 'P0001', message = 'PROPRE_COMPTE';
  end if;

  -- Un administrateur actif rétrogradé : il doit en rester un autre.
  if v_ancien_role = 'administrateur' and v_etat = 'actif' and p_role <> 'administrateur'
     and not exists (
       select 1 from public.membres m
        where m.id <> p_id and m.role = 'administrateur' and m.etat = 'actif'
     )
  then
    raise exception using errcode = 'P0001', message = 'DERNIER_ADMIN';
  end if;

  -- L'appelant a pu perdre ses droits pendant l'attente du verrou.
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if v_nom = v_ancien_nom and p_role = v_ancien_role then
    -- Rien ne change : réussite, rien n'est écrit.
    return jsonb_build_object('id', p_id, 'nom', v_nom, 'role', p_role, 'modifie', false);
  end if;

  update public.membres m
     set nom = v_nom,
         role = p_role
   where m.id = p_id;

  perform prive.ecrire_journal(
    'compte',
    jsonb_build_object(
      'evenement',   'compte_modifie',
      'membre_id',   p_id,
      'nom',         v_nom,
      'role',        p_role,
      'ancien_nom',  v_ancien_nom,
      'ancien_role', v_ancien_role
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'nom', v_nom, 'role', p_role, 'modifie', true);
end;
$$;

comment on function public.modifier_membre(uuid, text, text) is
  'Nom et rôle d''un membre (story 4.2) ; jamais son propre rôle (PROPRE_COMPTE), toujours un administrateur actif (DERNIER_ADMIN). Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.modifier_membre(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.modifier_membre(uuid, text, text) to authenticated;

-- 2. Désactiver un membre ------------------------------------------------
-- Effet immédiat partout (AD-3) : les droits sont relus dans `membres` à
-- chaque requête. Ses demandes En cours reviennent en Nouvelle, sans
-- responsable, avec une ligne d'historique `retour_nouvelle` chacune, au nom
-- de l'administrateur. Son nom reste dans les historiques (rien n'est
-- supprimé).

create function public.desactiver_membre(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur  uuid := auth.uid();
  v_nom     text;
  v_role    text;
  v_etat    text;
  v_demande uuid;
  v_nombre  integer := 0;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_id is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if p_id = v_auteur then
    raise exception using errcode = 'P0001', message = 'PROPRE_COMPTE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('membres:administrateurs', 0));

  -- Ligne verrouillée : une attribution ou une réouverture simultanée vers
  -- ce membre (verrou partagé, migrations 0016 et 0023) attend la fin.
  select m.nom, m.role, m.etat
    into v_nom, v_role, v_etat
    from public.membres m
   where m.id = p_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if v_etat <> 'actif' then
    raise exception using errcode = 'P0001', message = 'ETAT_COMPTE_INVALIDE';
  end if;

  if v_role = 'administrateur' and not exists (
    select 1 from public.membres m
     where m.id <> p_id and m.role = 'administrateur' and m.etat = 'actif'
  ) then
    raise exception using errcode = 'P0001', message = 'DERNIER_ADMIN';
  end if;

  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  update public.membres m
     set etat = 'desactive'
   where m.id = p_id;

  -- Ses demandes En cours : Nouvelle, sans responsable (règle 7).
  for v_demande in
    select d.id
      from public.demandes d
     where d.responsable_id = p_id
       and d.statut = 'en_cours'
     order by d.cree_le, d.id
       for update
  loop
    update public.demandes d
       set statut = 'nouvelle',
           responsable_id = null
     where d.id = v_demande;
    perform prive.ecrire_historique(v_demande, 'retour_nouvelle', v_auteur,
                                    'en_cours', 'nouvelle');
    v_nombre := v_nombre + 1;
  end loop;

  perform prive.ecrire_journal(
    'compte',
    jsonb_build_object(
      'evenement',        'compte_desactive',
      'membre_id',        p_id,
      'nom',              v_nom,
      'demandes_remises', v_nombre
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'etat', 'desactive', 'demandes_remises', v_nombre);
end;
$$;

comment on function public.desactiver_membre(uuid) is
  'Désactive un membre actif (story 4.2) : ses demandes En cours reviennent en Nouvelle sans responsable (historique retour_nouvelle). Jamais soi-même (PROPRE_COMPTE), toujours un administrateur actif (DERNIER_ADMIN). EXECUTE réservé à authenticated.';

revoke all on function public.desactiver_membre(uuid) from public, anon, authenticated, service_role;
grant execute on function public.desactiver_membre(uuid) to authenticated;

-- 3. Réactiver un membre -------------------------------------------------

create function public.reactiver_membre(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur uuid := auth.uid();
  v_nom    text;
  v_etat   text;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_id is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select m.nom, m.etat
    into v_nom, v_etat
    from public.membres m
   where m.id = p_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if v_etat <> 'desactive' then
    raise exception using errcode = 'P0001', message = 'ETAT_COMPTE_INVALIDE';
  end if;

  update public.membres m
     set etat = 'actif'
   where m.id = p_id;

  perform prive.ecrire_journal(
    'compte',
    jsonb_build_object(
      'evenement', 'compte_reactive',
      'membre_id', p_id,
      'nom',       v_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'etat', 'actif');
end;
$$;

comment on function public.reactiver_membre(uuid) is
  'Réactive un membre désactivé (story 4.2), sinon ETAT_COMPTE_INVALIDE. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.reactiver_membre(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reactiver_membre(uuid) to authenticated;

-- 4. Liste des comptes, avec le nombre de demandes En cours ----------------

create or replace function public.lister_comptes()
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
                'id',                m.id,
                'nom',               m.nom,
                'email',             m.email,
                'role',              m.role,
                'etat',              m.etat,
                'demandes_en_cours', (select count(*)::integer
                                        from public.demandes d
                                       where d.responsable_id = m.id
                                         and d.statut = 'en_cours')
              )
              order by lower(m.nom), m.id
            )
       from public.membres m),
    '[]'::jsonb
  );
end;
$$;

comment on function public.lister_comptes() is
  'Comptes de l''équipe (nom, email, rôle, état, demandes En cours), triés par nom. Administrateur actif seulement, sinon DROIT_INSUFFISANT.';

revoke all on function public.lister_comptes() from public, anon, authenticated, service_role;
grant execute on function public.lister_comptes() to authenticated;

-- 5. Adresse libre : cas du compte désactivé -----------------------------

create or replace function public.verifier_email_libre(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email, E' \t\n\r\f\v'));
  v_id    uuid;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).
  if v_email is null or v_email = '' then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Compte désactivé : l'écran propose « Réactiver ce compte ».
  select m.id into v_id
    from public.membres m
   where m.email = v_email
     and m.etat = 'desactive';
  if found then
    raise exception using
      errcode = 'P0001',
      message = 'COMPTE_DESACTIVE',
      detail  = jsonb_build_object('id', v_id)::text;
  end if;

  if exists (select 1 from public.membres m where m.email = v_email)
     or exists (select 1 from auth.users u where lower(u.email) = v_email)
  then
    raise exception using errcode = 'P0001', message = 'EMAIL_DEJA_UTILISE';
  end if;

  return jsonb_build_object('libre', true);
end;
$$;

comment on function public.verifier_email_libre(text) is
  'COMPTE_DESACTIVE (id en DETAIL) pour un compte désactivé, EMAIL_DEJA_UTILISE si l''adresse est déjà dans membres ou auth.users (avant une invitation). EXECUTE réservé à service_role.';

revoke all on function public.verifier_email_libre(text) from public, anon, authenticated, service_role;
grant execute on function public.verifier_email_libre(text) to service_role;
