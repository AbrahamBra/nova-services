-- Story 5.4 — Effacer les données d'une personne (droit à l'effacement,
-- AD-1, AD-5, AD-14, AD-19, AD-20, AD-30).
--
-- Crée :
--   - `chercher_demandes_demandeur(p_email)` : demandes dont l'email est
--     EXACTEMENT celui donné (après normalisation : espaces retirés,
--     minuscules), de la plus récente à la plus ancienne :
--     `[{id, reference, cree_le, objet, statut}]` ;
--   - `effacer_demandeur(p_email, p_ids)` : efface en un seul bloc les
--     demandes de cet email, à condition qu'elles soient exactement celles
--     de `p_ids` (la liste vue à l'écran) ; sinon DEMANDES_CHANGEES et rien
--     n'est effacé.
--
-- Les deux : SECURITY DEFINER, search_path vide, administrateur actif vérifié
-- en premier (DROIT_INSUFFISANT), EXECUTE à authenticated seulement.
-- Email vide ou sans la forme x@y.z : DONNEES_INVALIDES. Liste d'ids vide
-- ou contenant null : DONNEES_INVALIDES.
--
-- Effacement, dans la même transaction :
--   1. références inscrites dans `effacements` (`on conflict do nothing`),
--      pour que `rejouer_effacements()` les réefface après une restauration ;
--   2. demandes supprimées ; historique et notes suivent en cascade (leurs
--      déclencheurs laissent passer la suppression avec la demande, AD-5) ;
--   3. journal `donnees` `{evenement: "demandeur_efface", nombre}` au nom de
--      l'administrateur. JAMAIS l'email, le nom ni les références (AD-14).
-- Renvoie `{nombre}`.

-- 1. Recherche -------------------------------------------------------------

create function public.chercher_demandes_demandeur(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email    text := lower(btrim(p_email, E' \t\n\r\f\v'));
  v_resultat jsonb;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if v_email is null or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',        d.id,
               'reference', d.reference,
               'cree_le',   d.cree_le,
               'objet',     d.objet,
               'statut',    d.statut
             )
             order by d.cree_le desc, d.reference desc
           ),
           '[]'::jsonb
         )
    into v_resultat
    from public.demandes d
   where d.email = v_email;

  return v_resultat;
end;
$$;

comment on function public.chercher_demandes_demandeur(text) is
  'Demandes dont l''email est exactement celui donné (espaces retirés, minuscules), de la plus récente à la plus ancienne : [{id, reference, cree_le, objet, statut}] (story 5.4). Email vide ou mal formé : DONNEES_INVALIDES. Administrateur actif seulement, sinon DROIT_INSUFFISANT. EXECUTE réservé à authenticated.';

revoke all on function public.chercher_demandes_demandeur(text) from public, anon, authenticated, service_role;
grant execute on function public.chercher_demandes_demandeur(text) to authenticated;

-- 2. Effacement ------------------------------------------------------------

create function public.effacer_demandeur(p_email text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur   uuid := auth.uid();
  v_email    text := lower(btrim(p_email, E' \t\n\r\f\v'));
  v_attendus uuid[];
  v_trouves  uuid[];
  v_nombre   integer;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if v_email is null or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Verrou sur les demandes de cet email : aucune ne change ni ne disparaît
  -- pendant l'effacement (deux effacements simultanés : le second attend,
  -- puis voit la liste changée).
  perform 1
     from public.demandes d
    where d.email = v_email
      for update;

  -- Liste relue après le verrou (nouvelle image : une demande arrivée
  -- entre-temps y figure).
  select coalesce(array_agg(d.id order by d.id), '{}'::uuid[])
    into v_trouves
    from public.demandes d
   where d.email = v_email;

  select coalesce(array_agg(distinct i order by i), '{}'::uuid[])
    into v_attendus
    from unnest(p_ids) as i;

  if v_trouves <> v_attendus then
    raise exception using errcode = 'P0001', message = 'DEMANDES_CHANGEES';
  end if;

  -- 1. Registre des effacements (rejoué après une restauration, AD-30).
  insert into public.effacements (reference)
  select d.reference
    from public.demandes d
   where d.id = any (v_trouves)
  on conflict (reference) do nothing;

  -- 2. Demandes ; historique et notes en cascade.
  delete from public.demandes d
   where d.id = any (v_trouves);

  get diagnostics v_nombre = row_count;

  -- 3. Journal : le nombre seulement, jamais l'email ni les références.
  perform prive.ecrire_journal(
    'donnees',
    jsonb_build_object('evenement', 'demandeur_efface', 'nombre', v_nombre),
    v_auteur
  );

  return jsonb_build_object('nombre', v_nombre);
end;
$$;

comment on function public.effacer_demandeur(text, uuid[]) is
  'Droit à l''effacement (story 5.4) : efface les demandes de cet email (historique et notes en cascade) si elles sont exactement celles de p_ids, sinon DEMANDES_CHANGEES ; inscrit leurs références dans effacements ; journal donnees « demandeur_efface » {nombre}, sans l''email. Email mal formé ou liste vide : DONNEES_INVALIDES. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.effacer_demandeur(text, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.effacer_demandeur(text, uuid[]) to authenticated;

-- PostgREST : prise en compte immédiate des nouvelles fonctions.
notify pgrst, 'reload schema';
