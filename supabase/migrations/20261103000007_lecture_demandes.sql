-- Story 1.5 — Lecture des demandes par l'équipe (AD-2, AD-3, AD-15, AD-25).
--
-- Crée :
--   - les règles RLS de lecture sur `demandes`, `categories` et `membres`,
--     pour `authenticated` seulement, conditionnées par `prive.est_membre_actif()` ;
--   - les droits de lecture **par colonne** :
--       * `demandes` : toutes les colonnes sauf `jeton_confirmation` et `cle_envoi` ;
--       * `membres`  : `id`, `nom`, `etat` (ni email ni rôle) ;
--       * `categories` : `id`, `nom`, `actif` ;
--   - la vue `demandes_liste` (`security_invoker = true`) : les demandes avec
--     le nom de leur catégorie et le nom de leur responsable.
--
-- `anon` n'obtient aucun droit. `service_role` non plus : il n'a aucun droit
-- direct sur les tables (migration 20261103000004) et la vue lui est retirée.
-- Un compte invité ou désactivé ne voit aucune ligne (RLS).

-- 1. Règles RLS de lecture ------------------------------------------------
-- `(select …)` : la fonction est évaluée une seule fois par requête.

create policy demandes_lecture_membres_actifs
  on public.demandes
  for select
  to authenticated
  using ((select prive.est_membre_actif()));

create policy categories_lecture_membres_actifs
  on public.categories
  for select
  to authenticated
  using ((select prive.est_membre_actif()));

create policy membres_lecture_membres_actifs
  on public.membres
  for select
  to authenticated
  using ((select prive.est_membre_actif()));

-- 2. Droits par colonne ----------------------------------------------------
-- Jamais `jeton_confirmation` (accès à la page de confirmation) ni
-- `cle_envoi` (anti-doublon du formulaire).

grant select (
  id, reference, canal, nom, email, telephone, societe, objet, description,
  categorie_id, statut, priorite, responsable_id, saisie_par_id,
  consentement_le, etat_email, cree_le, traitee_le, mis_a_jour_le
) on public.demandes to authenticated;

grant select (id, nom, etat) on public.membres to authenticated;

grant select (id, nom, actif) on public.categories to authenticated;

-- 3. Vue de la liste (AD-25) -------------------------------------------------
-- Lue avec la session de la personne connectée : RLS et droits par colonne
-- des tables s'appliquent (security_invoker). La colonne de recherche
-- normalisée arrivera avec la recherche (story 2.5).

create view public.demandes_liste
  with (security_invoker = true)
as
select
  d.id,
  d.reference,
  d.cree_le,
  d.nom,
  d.societe,
  d.email,
  d.objet,
  d.categorie_id,
  c.nom  as categorie_nom,
  d.canal,
  d.statut,
  d.priorite,
  d.responsable_id,
  m.nom  as responsable_nom,
  d.etat_email,
  d.traitee_le
from public.demandes d
join public.categories c on c.id = d.categorie_id
left join public.membres m on m.id = d.responsable_id;

comment on view public.demandes_liste is
  'Liste des demandes pour l''équipe (catégorie et responsable en clair). security_invoker : RLS des tables appliquée.';

-- Droits par défaut de Supabase sur les nouvelles vues : tout retirer, puis
-- accorder la lecture aux seuls membres connectés.
revoke all on table public.demandes_liste from public, anon, authenticated, service_role;
grant select on table public.demandes_liste to authenticated;

-- PostgREST : prise en compte immédiate de la nouvelle vue.
notify pgrst, 'reload schema';
