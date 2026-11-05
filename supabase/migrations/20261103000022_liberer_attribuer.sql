-- Story 2.7 — Libérer ou attribuer une demande (AD-4, AD-15, AD-19, AD-20 ;
-- règles 1, 2 et 4 du PRD).
--
-- `liberer(p_demande_id)` : En cours → Nouvelle, sans responsable, pour le
-- responsable ou un administrateur. UNE ligne d'historique `liberation`
-- (auteur l'appelant, ancienne valeur = l'ancien responsable).
-- Déjà Nouvelle sans responsable (double clic, onglet ancien) : réussite,
-- sans nouvelle ligne.
--
-- `attribuer(p_demande_id, p_membre_id)` : réservée à un administrateur
-- actif (vérifié en premier). La demande Nouvelle (avec ou sans responsable)
-- ou En cours passe En cours avec le membre cible pour responsable : même
-- effet qu'une prise en charge. UNE ligne d'historique `attribution`
-- (ancienne valeur = ancien responsable ou null, nouvelle = la cible).
-- Cible déjà responsable d'une demande En cours : réussite, sans nouvelle
-- ligne. La cible doit être un membre actif (jamais un compte invité ou
-- désactivé) : sa ligne est verrouillée en partage, une désactivation
-- simultanée attend la fin de la transaction.
--
-- Ordre des verrous : la demande (`FOR UPDATE`) puis le membre (`FOR SHARE`),
-- comme `changer_statut` (migration 0016). Deux appels simultanés
-- s'exécutent l'un après l'autre ; le second voit le nouvel état.
--
-- Erreurs prévues (P0001) :
--   DROIT_INSUFFISANT   pas un membre actif (liberer), pas un administrateur
--                       actif (attribuer), ou collaborateur qui n'est pas le
--                       responsable (liberer) ;
--   DEMANDE_INTROUVABLE identifiant inconnu ;
--   MEMBRE_INVALIDE     membre cible inconnu, invité ou désactivé (attribuer) ;
--   PASSAGE_INTERDIT    demande Traitée (on la rouvre d'abord).
--
-- `mis_a_jour_le` est écrite par le déclencheur `demandes_dates` (AD-22).
-- EXECUTE accordé à `authenticated` seulement.

-- 1. Libérer --------------------------------------------------------------

create function public.liberer(p_demande_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre      uuid := auth.uid();
  v_statut      text;
  v_responsable uuid;
  v_lignes      integer;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  select d.statut, d.responsable_id
    into v_statut, v_responsable
    from public.demandes d
   where d.id = p_demande_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  -- Déjà libérée (double clic) : réussite, rien n'est écrit.
  if v_statut = 'nouvelle' and v_responsable is null then
    return jsonb_build_object(
      'id',             p_demande_id,
      'statut',         'nouvelle',
      'responsable_id', null
    );
  end if;

  if v_statut <> 'en_cours' then
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  if v_responsable is distinct from v_membre and not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  update public.demandes d
     set statut = 'nouvelle',
         responsable_id = null
   where d.id = p_demande_id
     and d.statut = 'en_cours';

  get diagnostics v_lignes = row_count;
  if v_lignes <> 1 then
    -- Jamais d'historique sans changement.
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  perform prive.ecrire_historique(p_demande_id, 'liberation', v_membre,
                                  v_responsable::text, null);
  return jsonb_build_object(
    'id',             p_demande_id,
    'statut',         'nouvelle',
    'responsable_id', null
  );
end;
$$;

comment on function public.liberer(uuid) is
  'Libération d''une demande En cours par son responsable ou un administrateur : Nouvelle sans responsable, une ligne d''historique (story 2.7). EXECUTE réservé à authenticated.';

revoke all on function public.liberer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.liberer(uuid) to authenticated;

-- 2. Attribuer ------------------------------------------------------------

create function public.attribuer(p_demande_id uuid, p_membre_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre      uuid := auth.uid();
  v_statut      text;
  v_responsable uuid;
  v_lignes      integer;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  select d.statut, d.responsable_id
    into v_statut, v_responsable
    from public.demandes d
   where d.id = p_demande_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  -- Membre cible actif, verrouillé en partage contre une désactivation
  -- simultanée.
  perform 1 from public.membres m
    where m.id = p_membre_id and m.etat = 'actif'
    for share;
  if p_membre_id is null or not found then
    raise exception using errcode = 'P0001', message = 'MEMBRE_INVALIDE';
  end if;

  if v_statut not in ('nouvelle', 'en_cours') then
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  -- Déjà responsable (double clic) : réussite, rien n'est écrit.
  if v_statut = 'en_cours' and v_responsable = p_membre_id then
    return jsonb_build_object(
      'id',             p_demande_id,
      'statut',         'en_cours',
      'responsable_id', p_membre_id
    );
  end if;

  update public.demandes d
     set statut = 'en_cours',
         responsable_id = p_membre_id
   where d.id = p_demande_id
     and d.statut = v_statut
     and d.responsable_id is not distinct from v_responsable;

  get diagnostics v_lignes = row_count;
  if v_lignes <> 1 then
    -- Jamais d'historique sans changement.
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  -- Une seule ligne, même depuis Nouvelle (effet d'une prise en charge).
  perform prive.ecrire_historique(p_demande_id, 'attribution', v_membre,
                                  v_responsable::text, p_membre_id::text);
  return jsonb_build_object(
    'id',             p_demande_id,
    'statut',         'en_cours',
    'responsable_id', p_membre_id
  );
end;
$$;

comment on function public.attribuer(uuid, uuid) is
  'Attribution par un administrateur d''une demande Nouvelle ou En cours à un membre actif : En cours, responsable, une ligne d''historique (story 2.7). EXECUTE réservé à authenticated.';

revoke all on function public.attribuer(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.attribuer(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
