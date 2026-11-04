-- Story 1.6 — Lecture de l'historique par l'équipe (AD-2, AD-3, AD-15, AD-19).
--
-- Crée, sur le modèle de la migration 20261103000007 :
--   - la règle RLS de lecture de `historique`, pour `authenticated` seulement,
--     conditionnée par `prive.est_membre_actif()` ;
--   - les droits de lecture par colonne de `historique` (toutes ses colonnes :
--     elle ne contient que des codes et des identifiants, AD-19).
--
-- `anon` n'obtient aucun droit. `service_role` non plus (migration
-- 20261103000004). Un compte invité ou désactivé ne voit aucune ligne (RLS).
-- Aucune écriture : l'historique ne s'écrit que par `prive.ecrire_historique`.

create policy historique_lecture_membres_actifs
  on public.historique
  for select
  to authenticated
  using ((select prive.est_membre_actif()));

grant select (
  id, demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le
) on public.historique to authenticated;

-- PostgREST : prise en compte immédiate des nouveaux droits.
notify pgrst, 'reload schema';
