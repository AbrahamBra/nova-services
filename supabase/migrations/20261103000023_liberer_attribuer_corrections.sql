-- Story 2.7 — corrections de `liberer` et `attribuer` (migration 0022 déjà
-- appliquée ; mêmes signatures, mêmes droits).
--
-- a) `attribuer` : une demande Traitée donne PASSAGE_INTERDIT avant la
--    vérification du membre cible (onglet ancien, membre désactivé : le bon
--    message, la fenêtre se ferme).
-- b) `liberer` : la réussite sans écriture sur une demande déjà Nouvelle sans
--    responsable (double clic) n'est rendue qu'à un administrateur ou à
--    l'auteur de la dernière ligne `liberation` de la demande ; sinon
--    PASSAGE_INTERDIT.

create or replace function public.liberer(p_demande_id uuid)
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
    if not prive.est_admin() and v_membre is distinct from (
         select h.auteur_id from public.historique h
          where h.demande_id = p_demande_id and h.type = 'liberation'
          order by h.id desc limit 1) then
      raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
    end if;
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

create or replace function public.attribuer(p_demande_id uuid, p_membre_id uuid)
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

  if v_statut not in ('nouvelle', 'en_cours') then
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  -- Membre cible actif, verrouillé en partage contre une désactivation
  -- simultanée.
  perform 1 from public.membres m
    where m.id = p_membre_id and m.etat = 'actif'
    for share;
  if p_membre_id is null or not found then
    raise exception using errcode = 'P0001', message = 'MEMBRE_INVALIDE';
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
