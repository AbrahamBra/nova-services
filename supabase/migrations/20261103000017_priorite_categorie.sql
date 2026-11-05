-- Story 2.4 — Fixer la priorité et corriger la catégorie (AD-4, AD-15,
-- AD-18, AD-19, AD-22 ; règles 3, 5 et 9 du PRD).
--
-- `changer_priorite(p_demande_id, p_priorite)` : priorité `basse`, `normale`
-- ou `haute` (`DONNEES_INVALIDES` sinon), quel que soit le statut (règle 3).
-- `changer_categorie(p_demande_id, p_categorie_id)` : seulement une catégorie
-- ACTIVE existante (`CATEGORIE_INVALIDE` sinon). Une demande dont la
-- catégorie a été désactivée la garde tant qu'on ne la change pas (règle 9).
--
-- Même valeur qu'avant : succès sans modification ni ligne d'historique
-- (`modifiee` = false). Sinon, une ligne d'historique `changement_priorite`
-- (codes) ou `changement_categorie` (identifiants, AD-19).
--
-- Lecture de la demande verrouillée (`FOR UPDATE`) avant toute décision :
-- deux changements simultanés s'exécutent l'un après l'autre, le second voit
-- la nouvelle valeur (ancienne valeur exacte dans l'historique). La catégorie
-- choisie est verrouillée en partage contre une désactivation simultanée.
--
-- Erreurs prévues (P0001) :
--   DROIT_INSUFFISANT   pas un membre actif (première instruction) ;
--   DEMANDE_INTROUVABLE identifiant inconnu ;
--   DONNEES_INVALIDES   priorité hors liste (ou absente) ;
--   CATEGORIE_INVALIDE  catégorie inconnue, désactivée ou absente.
--
-- `mis_a_jour_le` est écrite par le déclencheur `demandes_dates` (AD-22),
-- jamais par ces fonctions.
-- EXECUTE à `authenticated` seulement.
--
-- Ordre de l'historique : une transaction bloquée par le verrou garde un
-- `now()` antérieur à celui de la gagnante ; l'historique est donc affiché
-- dans l'ordre d'écriture (`id`), pas par `cree_le` (lib/detail-demande.ts).
--
-- Lecture des catégories par l'équipe (liste « Catégorie » du détail, avec
-- la session) : colonne `ordre` ajoutée aux droits de lecture de
-- `authenticated` (`id`, `nom`, `actif` déjà accordées ; même règle RLS :
-- membres actifs seulement).

-- 0. Lecture de l'ordre des catégories -------------------------------------

grant select (ordre) on public.categories to authenticated;

-- 1. Priorité --------------------------------------------------------------

create function public.changer_priorite(p_demande_id uuid, p_priorite text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre   uuid := auth.uid();
  v_ancienne text;
  v_lignes   integer;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  -- Saisie vérifiée avant de verrouiller la demande.
  if p_priorite is null or p_priorite not in ('basse', 'normale', 'haute') then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select d.priorite
    into v_ancienne
    from public.demandes d
   where d.id = p_demande_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  -- Même valeur : rien ne change, aucune ligne d'historique.
  if p_priorite = v_ancienne then
    return jsonb_build_object('id', p_demande_id, 'priorite', v_ancienne, 'modifiee', false);
  end if;

  update public.demandes d
     set priorite = p_priorite
   where d.id = p_demande_id;

  get diagnostics v_lignes = row_count;
  if v_lignes <> 1 then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  perform prive.ecrire_historique(p_demande_id, 'changement_priorite', v_membre,
                                  v_ancienne, p_priorite);
  return jsonb_build_object('id', p_demande_id, 'priorite', p_priorite, 'modifiee', true);
end;
$$;

comment on function public.changer_priorite(uuid, text) is
  'Priorité d''une demande (basse, normale, haute), quel que soit son statut, avec une ligne d''historique si elle change (story 2.4). EXECUTE réservé à authenticated.';

revoke all on function public.changer_priorite(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.changer_priorite(uuid, text) to authenticated;

-- 2. Catégorie -------------------------------------------------------------

create function public.changer_categorie(p_demande_id uuid, p_categorie_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre   uuid := auth.uid();
  v_ancienne uuid;
  v_lignes   integer;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  select d.categorie_id
    into v_ancienne
    from public.demandes d
   where d.id = p_demande_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  -- Même valeur : rien ne change, aucune ligne d'historique, même si la
  -- catégorie a été désactivée depuis (la demande la garde, règle 9).
  if p_categorie_id is not distinct from v_ancienne then
    return jsonb_build_object('id', p_demande_id, 'categorie_id', v_ancienne, 'modifiee', false);
  end if;

  -- Catégorie active, verrouillée en partage contre une désactivation simultanée.
  perform 1 from public.categories c
    where c.id = p_categorie_id and c.actif
    for share;
  if p_categorie_id is null or not found then
    raise exception using errcode = 'P0001', message = 'CATEGORIE_INVALIDE';
  end if;

  update public.demandes d
     set categorie_id = p_categorie_id
   where d.id = p_demande_id;

  get diagnostics v_lignes = row_count;
  if v_lignes <> 1 then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  -- Identifiants dans l'historique, jamais les noms (AD-19).
  perform prive.ecrire_historique(p_demande_id, 'changement_categorie', v_membre,
                                  v_ancienne::text, p_categorie_id::text);
  return jsonb_build_object('id', p_demande_id, 'categorie_id', p_categorie_id, 'modifiee', true);
end;
$$;

comment on function public.changer_categorie(uuid, uuid) is
  'Catégorie d''une demande (catégorie active seulement), quel que soit son statut, avec une ligne d''historique si elle change (story 2.4). EXECUTE réservé à authenticated.';

revoke all on function public.changer_categorie(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.changer_categorie(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
