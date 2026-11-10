-- Story 5.5 — Supprimer les demandes expirées (AD-1, AD-5, AD-14, AD-19,
-- AD-20, AD-30).
--
-- Une demande est EXPIRÉE quand elle est Traitée et que son DERNIER passage
-- à Traitée (`traitee_le`, tenu par le déclencheur `demandes_dates`) date de
-- plus longtemps que la durée de conservation réglée
-- (`parametres.duree_conservation_mois`, story 5.3) :
--   statut = 'traitee' and traitee_le < now() - durée.
-- Une demande Nouvelle ou En cours ne l'est jamais, quelle que soit sa date ;
-- une demande rouverte puis traitée récemment non plus.
--
-- Crée :
--   - `compter_expirees()` : `{nombre, duree_mois}` (nombre de demandes
--     expirées, durée réglée) ;
--   - `purger_expirees(p_nombre_attendu)` : supprime en un seul bloc les
--     demandes expirées, à condition qu'elles soient exactement au nombre
--     annoncé à l'écran ; sinon EXPIREES_CHANGEES et rien n'est supprimé.
--
-- Les deux : SECURITY DEFINER, search_path vide, administrateur actif vérifié
-- en premier (DROIT_INSUFFISANT), EXECUTE à authenticated seulement.
--
-- Suppression, dans la même transaction :
--   1. références inscrites dans `effacements` (`on conflict do nothing`),
--      pour qu'une restauration de sauvegarde ne les ramène pas
--      (`rejouer_effacements()`, AD-30) ;
--   2. demandes supprimées ; historique et notes suivent en cascade ;
--   3. journal `donnees` `{evenement: "expirees_supprimees", nombre,
--      duree_mois}` au nom de l'administrateur. Jamais une référence, un nom
--      ni un email (AD-14).
-- Renvoie `{nombre}`.
--
-- Aucune purge automatique : seulement à la demande d'un administrateur.

-- 1. Nombre de demandes expirées -------------------------------------------

create function public.compter_expirees()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_duree  integer;
  v_nombre integer;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  select p.duree_conservation_mois into v_duree from public.parametres p;

  select count(*)::integer
    into v_nombre
    from public.demandes d
   where d.statut = 'traitee'
     and d.traitee_le < now() - make_interval(months => v_duree);

  return jsonb_build_object('nombre', v_nombre, 'duree_mois', v_duree);
end;
$$;

comment on function public.compter_expirees() is
  'Nombre de demandes Traitées depuis plus que la durée de conservation réglée (dernier passage à Traitée, traitee_le) : {nombre, duree_mois} (story 5.5). Administrateur actif seulement, sinon DROIT_INSUFFISANT. EXECUTE réservé à authenticated.';

revoke all on function public.compter_expirees() from public, anon, authenticated, service_role;
grant execute on function public.compter_expirees() to authenticated;

-- 2. Suppression -----------------------------------------------------------

create function public.purger_expirees(p_nombre_attendu integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur uuid := auth.uid();
  v_duree  integer;
  v_ids    uuid[];
  v_nombre integer;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if p_nombre_attendu is null or p_nombre_attendu < 0 then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Durée verrouillée en partage : elle ne change pas pendant la suppression
  -- (un enregistrement des paramètres attend la fin).
  select p.duree_conservation_mois
    into v_duree
    from public.parametres p
     for share;

  -- Demandes expirées verrouillées : aucune n'est rouverte ni modifiée
  -- pendant la suppression (une demande rouverte entre-temps est relue
  -- après le verrou et n'est plus retenue).
  select coalesce(array_agg(e.id), '{}'::uuid[])
    into v_ids
    from (
      select d.id
        from public.demandes d
       where d.statut = 'traitee'
         and d.traitee_le < now() - make_interval(months => v_duree)
         for update
    ) as e;

  if cardinality(v_ids) <> p_nombre_attendu then
    raise exception using errcode = 'P0001', message = 'EXPIREES_CHANGEES';
  end if;

  if cardinality(v_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- 1. Registre des effacements (rejoué après une restauration, AD-30).
  insert into public.effacements (reference)
  select d.reference
    from public.demandes d
   where d.id = any (v_ids)
  on conflict (reference) do nothing;

  -- 2. Demandes ; historique et notes en cascade.
  delete from public.demandes d
   where d.id = any (v_ids);

  get diagnostics v_nombre = row_count;

  -- 3. Journal : le nombre et la durée seulement, jamais une référence.
  perform prive.ecrire_journal(
    'donnees',
    jsonb_build_object(
      'evenement',  'expirees_supprimees',
      'nombre',     v_nombre,
      'duree_mois', v_duree),
    v_auteur
  );

  return jsonb_build_object('nombre', v_nombre);
end;
$$;

comment on function public.purger_expirees(integer) is
  'Supprime les demandes expirées (story 5.5 : Traitées depuis plus que la durée de conservation, historique et notes en cascade) si elles sont exactement p_nombre_attendu, sinon EXPIREES_CHANGEES ; aucune : DONNEES_INVALIDES. Inscrit leurs références dans effacements ; journal donnees « expirees_supprimees » {nombre, duree_mois}. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.purger_expirees(integer) from public, anon, authenticated, service_role;
grant execute on function public.purger_expirees(integer) to authenticated;

-- PostgREST : prise en compte immédiate des nouvelles fonctions.
notify pgrst, 'reload schema';
