-- Story 4.4 — Renvoyer ou annuler une invitation (AD-1, AD-17, AD-19, AD-20).
--
-- 1. `noter_renvoi_invitation(p_id)` (administrateur actif, avec sa
--    session) : vérifie que le membre est encore invité (ETAT_COMPTE_INVALIDE
--    sinon), écrit la ligne de journal `invitation_renvoyee` et renvoie
--    l'email du membre, pour que l'action génère le nouveau lien
--    (`generateLink`, invite : même compte Auth, nouveau jeton, l'ancien
--    devient invalide).
-- 2. `annuler_invitation(p_id)` (administrateur actif, avec sa session) :
--    ligne verrouillée, état `invite` obligatoire (ETAT_COMPTE_INVALIDE
--    sinon), suppression de la ligne `membres` et journal
--    `invitation_annulee`. L'action supprime ENSUITE le compte Auth. C'est la
--    seule suppression de membre permise (AD-17) : jamais un compte actif ou
--    désactivé.
--
-- Erreurs prévues : DROIT_INSUFFISANT, DONNEES_INVALIDES, ETAT_COMPTE_INVALIDE.

-- 1. Renvoyer une invitation --------------------------------------------------

create function public.noter_renvoi_invitation(p_id uuid)
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

  -- Ligne verrouillée : une annulation ou une activation simultanée attend la fin.
  select m.nom, m.email, m.etat
    into v_nom, v_email, v_etat
    from public.membres m
   where m.id = p_id
     for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if v_etat <> 'invite' then
    raise exception using errcode = 'P0001', message = 'ETAT_COMPTE_INVALIDE';
  end if;

  perform prive.ecrire_journal(
    'compte',
    jsonb_build_object(
      'evenement', 'invitation_renvoyee',
      'membre_id', p_id,
      'nom',       v_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'nom', v_nom, 'email', v_email);
end;
$$;

comment on function public.noter_renvoi_invitation(uuid) is
  'Renvoi d''une invitation (story 4.4) : membre invité seulement (ETAT_COMPTE_INVALIDE), journal invitation_renvoyee ; renvoie l''email du membre. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.noter_renvoi_invitation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.noter_renvoi_invitation(uuid) to authenticated;

-- 2. Annuler une invitation ---------------------------------------------------

create function public.annuler_invitation(p_id uuid)
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

  -- Ligne verrouillée : une activation (`activer_mon_compte`) simultanée
  -- attend la fin ; si elle passe d'abord, l'état n'est plus `invite`.
  select m.nom, m.etat
    into v_nom, v_etat
    from public.membres m
   where m.id = p_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Seule suppression de membre permise (AD-17) : jamais un compte actif
  -- ou désactivé.
  if v_etat <> 'invite' then
    raise exception using errcode = 'P0001', message = 'ETAT_COMPTE_INVALIDE';
  end if;

  delete from public.membres m
   where m.id = p_id
     and m.etat = 'invite';

  perform prive.ecrire_journal(
    'compte',
    jsonb_build_object(
      'evenement', 'invitation_annulee',
      'membre_id', p_id,
      'nom',       v_nom
    ),
    v_auteur
  );

  return jsonb_build_object('id', p_id, 'nom', v_nom);
end;
$$;

comment on function public.annuler_invitation(uuid) is
  'Annule une invitation (story 4.4) : membre invité seulement (ETAT_COMPTE_INVALIDE), supprime sa ligne membres (seule suppression permise, AD-17), journal invitation_annulee ; le compte Auth est supprimé ensuite par l''action. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.annuler_invitation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.annuler_invitation(uuid) to authenticated;

-- PostgREST : prise en compte immédiate des nouvelles fonctions.
notify pgrst, 'reload schema';
