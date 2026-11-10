---
title: 'Story 5.5 — Supprimer les demandes expirées'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '91caf36732cd0023d575e6f8f0267695d48819ca'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-4-effacer-donnees-personne.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** le formulaire public promet que les demandes sont « conservées [durée] après leur traitement, puis supprimées », mais rien ne supprime les demandes traitées depuis plus longtemps que la durée réglée.

**Approach :** un second bloc « Demandes expirées » sur la page Données personnelles : il annonce « N demandes sont traitées depuis plus de [durée]. » et propose « Supprimer les demandes expirées » avec confirmation ; une fonction `purger_expirees` supprime exactement ces N demandes (historique et notes en cascade) et écrit le journal.

## Boundaries & Constraints

**Always :**
- **Règle** : une demande est expirée si `statut = 'traitee'` et `traitee_le < now() - durée de conservation` (lue dans `parametres`, réglée en 5.3). `traitee_le` est le **dernier** passage à Traitée (déjà tenu par le déclencheur `demandes_dates`) : une demande rouverte puis traitée récemment n'est pas expirée ; une demande jamais traitée ne l'est jamais.
- **Bloc « Demandes expirées »** sous le bloc d'effacement : « N demandes sont traitées depuis plus de [durée]. » (singulier pour 1 ; durée par `formaterDuree`) et le bouton destructeur « Supprimer les demandes expirées » ; à 0 : texte « Aucune demande expirée. » et bouton désactivé. Le nombre est lu au chargement de la page.
- **Confirmation** (même modèle que l'effacement, « Annuler » à gauche et sélectionné) : « N demandes traitées depuis plus de [durée] vont être supprimées définitivement, avec leur historique et leurs notes. Cette action ne peut pas être annulée. » ; après succès : toast « N demandes supprimées. », le bloc se met à jour (« Aucune demande expirée. »).
- **Nombre annoncé = nombre supprimé** : l'écran envoie le nombre affiché ; si le nombre d'expirées a changé entre-temps, rien n'est supprimé et le bloc affiche le nouveau nombre avec un bandeau « Le nombre de demandes expirées a changé. Vérifiez-le avant de supprimer. ».
- **Migration `20261103000034_purger_expirees.sql`** :
  - `compter_expirees()` — administrateur actif sinon `DROIT_INSUFFISANT` ; renvoie `{nombre, duree_mois}`.
  - `purger_expirees(p_nombre_attendu integer)` — administrateur actif ; verrouille les demandes expirées (`for update`) ; si leur nombre ≠ `p_nombre_attendu` → `EXPIREES_CHANGEES` ; si 0 → `DONNEES_INVALIDES` ; sinon, dans la même transaction : inscrit leurs références dans `effacements` (`on conflict do nothing`, pour qu'une restauration de sauvegarde ne les ramène pas), les supprime (historique et notes en cascade), journal `donnees` `{evenement: "expirees_supprimees", nombre, duree_mois}` au nom de l'administrateur ; renvoie `{nombre}`.
  - `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` à `authenticated` seulement ; listes de droits des tests à jour.
- **Journal** : `expirees_supprimees {nombre, duree_mois}` dans `lib/journal.ts` ; phrase « 12 demandes expirées supprimées (traitées depuis plus de 2 ans) » (singulier pour 1). Jamais de référence, nom ni email.
- **Actions** dans `lib/actions/donnees.ts` (`purgerExpirees`), mêmes règles que 5.4 (administrateur revérifié, `DROIT_INSUFFISANT` → `ACCES_REFUSE`, `revalidatePath("/equipe", "layout")`) ; nouveau code dans `lib/erreurs.ts`.
- **Tests sur la base partagée** : la purge touche **toutes** les demandes expirées de nova-dev (données d'essai comprises). Les tests de base l'exécutent seulement dans une **transaction annulée**, avec leurs propres demandes `TEST-5.5-…` datées dans le passé. Le test navigateur vérifie le texte, l'état désactivé et la fenêtre de confirmation, puis **annule** ; il ne lance jamais une vraie purge.

**Never :**
- Pas de purge automatique (nocturne) ni de réglage de la règle ; ne pas supprimer une demande Nouvelle ou En cours, quelle que soit sa date.
- Ne pas modifier le déclencheur `demandes_dates` ni la règle de `traitee_le`.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Expirées | Demandes d'essai traitées il y a plus de 2 ans | « N demandes sont traitées depuis plus de 2 ans. » |
| Purge | Confirmation | Les N supprimées, historique et notes compris ; références dans `effacements` ; journal avec N |
| Rouverte puis traitée récemment | Créée il y a 3 ans, traitée hier | Reste |
| Jamais traitée | Nouvelle ou En cours depuis 5 ans | Reste |
| Aucune | 0 expirée | « Aucune demande expirée. », bouton désactivé |
| Nombre changé | Une demande expire ou est rouverte entre l'affichage et la confirmation | `EXPIREES_CHANGEES`, rien supprimé, nouveau nombre affiché |
| Durée changée | Durée 3 ans | Le calcul suit la durée réglée |
| Collaborateur | Page ou fonctions | Accès refusé ; `DROIT_INSUFFISANT` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000003_demandes.sql:72,91-116` -- `traitee_le` et le déclencheur `demandes_dates` (dernier passage à Traitée).
- `20261103000033_effacer_demandeur.sql` -- modèle direct (droits, verrou `for update`, `effacements`, suppression en cascade, journal, code « liste changée ») ; `20261103000027_effacements.sql` -- registre.
- `20261103000002_categories_parametres.sql` -- `parametres.duree_conservation_mois`.
- `lib/actions/donnees.ts`, `lib/schemas/donnees.ts`, `components/nova/donnees/effacement-demandeur.tsx` (fenêtre de confirmation, bandeau, focus), `app/equipe/admin/donnees/page.tsx` -- ajouter le bloc sans casser l'effacement.
- `lib/journal.ts` (trois tables + test de toute la base `tests/story-5-1/base.test.ts`), `lib/format.ts` (`formaterDuree`), `lib/erreurs.ts`.
- `supabase/essai/demandes-essai.sql:13-26` -- données d'essai : demandes traitées il y a plus de 2 ans et une rouverte puis traitée récemment (dates forcées hors déclencheur).
- Tests : `tests/outils/demandes.ts` (`creerDemandeTest`, option `decalage` ; `traitee_le` à forcer en SQL dans la transaction), `tests/story-5-4/*` (modèle), listes de droits `tests/securite/*`, `tests/story-3-4/rejouer-effacements.test.ts` (déjà indépendant).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000034_purger_expirees.sql` -- deux fonctions ; à appliquer sur nova-dev par la session principale
- [x] `lib/erreurs.ts`, `lib/journal.ts`, `lib/schemas/donnees.ts`, `lib/actions/donnees.ts`, lecture du nombre pour la page
- [x] `components/nova/donnees/*`, `app/equipe/admin/donnees/page.tsx` -- bloc « Demandes expirées »
- [x] `tests/story-5-5/` -- base (transactions annulées : règle, rouverte, jamais traitée, durée réglée, `effacements`, journal, `EXPIREES_CHANGEES`, droits), action, écran, navigateur (texte, 0 désactivé, fenêtre puis Annuler, axe, ordinateur et téléphone) ; listes de droits
- [x] `docs/carnet-ia.md` -- ligne de la story 5.5

**Acceptance Criteria :**
- Given les demandes d'essai traitées il y a plus de 2 ans, when j'ouvre Données personnelles, then je lis « N demandes sont traitées depuis plus de 2 ans. ».
- Given ce nombre, when je clique sur « Supprimer les demandes expirées » et confirme, then ces N demandes disparaissent ; la demande rouverte puis traitée récemment reste.
- Given aucune demande expirée, when j'ouvre la page, then le bouton est désactivé avec « Aucune demande expirée. ».

## Implementation Notes

- Migration 0034 non appliquée par l'agent : essayée dans une transaction annulée sur nova-dev (4 demandes d'essai expirées, `EXPIREES_CHANGEES`, `DONNEES_INVALIDES`, registre, journal, durée à 6 mois). Tests de base 5.5 joués en chargeant la migration dans chaque transaction annulée (modification temporaire, retirée) : verts sauf le test de droits, qui exige la migration appliquée.
- Tests de base : demandes `TEST-5.5-…` créées et datées par de courtes étapes VALIDÉES (`traitee_le` forcée avec `set local session_replication_role = replica` le temps d'une seule mise à jour), effacées après chaque test ; la transaction annulée ne contient que comptage, purge, vérifications et, au besoin, la durée réglée (`lock_timeout` 10 s). Première version : une seule longue transaction par test, qui gardait la ligne du compteur des références (`deposer_demande`) et la ligne `parametres` — `pg_locks` / `pg_stat_activity` l'ont confirmé (5.3 `modifier_parametres` et 5.4 `deposer_demande` en attente) — d'où des dépassements de 5 s dans 5.3 et 5.4 lancés en parallèle. Corrigé dans les tests seulement.
- `purger_expirees` verrouille aussi la ligne `parametres` en partage : la durée ne change pas pendant la suppression.
- Lecture du nombre impossible au chargement : texte « Le nombre de demandes expirées n'a pas pu être lu. Rechargez la page. » et bouton désactivé (cas non prévu par le plan). Erreur imprévue après confirmation : bandeau, bouton désactivé jusqu'au rechargement.
- Navigateur : « 0 désactivé » n'est vérifié dans le navigateur que si nova-dev n'a aucune demande expirée (sinon branche « N demandes… ») ; obtenir 0 demanderait une vraie suppression ou un changement de la durée partagée, tous deux exclus. L'état 0 est couvert par le test d'écran.

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | VG + Blind | Suite de la confirmation (`confirmer()`) jamais exécutée par un test | medium | Constat VG pré-vérifié → patch (fonction pure testée pour chaque issue) |
| 2 | Blind + Edge | Seul le nombre est comparé : un ensemble différent de même taille, ou une durée changée entre-temps, est supprimé | low | Les demandes supprimées sont toutes expirées selon la règle au moment de la purge ; le journal enregistre la durée réellement appliquée → rejeté |
| 3 | Blind | Nombre 0 refusé tard et avec le mauvais code | low | L'écran n'envoie jamais 0 (schéma `min(1)`) ; correction en migration → rejeté |
| 4 | Blind + Edge | « La suppression a peut-être eu lieu » affiché alors que le serveur garantit le contraire | low | → patch (seulement pour l'erreur imprévue) |
| 5 | Blind | Pas d'index sur `traitee_le` | low | Volume d'une petite équipe ; ajout en migration → rejeté |
| 6 | Blind | Purge sans limite de taille : délai dépassé possible | maybe-false | Seulement avec un très grand volume accumulé ; à mesurer en production → reporté |
| 7 | Blind | Durée de conservation absente | false | Colonne `not null`, ligne unique créée par migration |
| 8 | Blind | Chaque passage navigateur ne vérifie qu'un critère selon les données ; ordre des boutons non vérifié sur téléphone | low | Le cas 0 est couvert par le test d'écran ; base partagée → rejeté |
| 9 | Blind | Administrateur désactivé non testé | low | `prive.est_admin()` déjà testé dans les stories précédentes → rejeté |
| 10 | Blind | Erreur de droits montrée comme « illisible » ; échec du client serveur non signalé à Sentry | low | → patch (signalement uniforme) |
| 11 | Blind | Résultat annoncé deux fois aux lecteurs d'écran | low | → patch |
| 12 | Blind + Edge | État local figé sur les valeurs initiales après un rafraîchissement | low | → patch |
| 13 | Blind | Test de base : verrous sur toutes les expirées pendant le test | low | Transaction réduite au strict nécessaire après l'analyse des verrous → rejeté |
| 14 | Blind | Commentaire trop long | low | → patch |
| 15 | Edge | Entier au-delà de 2 147 483 647 | low | → patch |

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-5-5 tests/story-5-4 tests/story-5-1 tests/story-3-4 tests/securite` -- vert, lancés ensemble
- `npx playwright test --project=ordinateur --project=telephone tests/story-5-5 tests/story-5-4` -- vert
