---
title: 'Story 5.2 — Gérer les catégories'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'adb60844411954a7460578d9ec20cc5a0f68807e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-1-consulter-le-journal.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** les 5 catégories du formulaire sont fixées par migration ; l'administratrice ne peut ni en ajouter, ni en renommer, ni retirer une catégorie qui ne sert plus.

**Approach :** une page `/equipe/admin/categories` (nom, état, nombre de demandes) avec « Ajouter une catégorie », « Renommer », « Désactiver » et « Réactiver », portés par quatre fonctions SQL qui garantissent un nom unique (sans majuscules ni accents) et au moins une catégorie active, et qui écrivent le journal.

## Boundaries & Constraints

**Always :**
- **Page** « Catégories », entrée « Catégories » dans le menu Administration (entre « Comptes » et « Journal »). Tableau Nom · État (« Active » / « Désactivée ») · Demandes (nombre, toutes demandes confondues) · Actions ; cartes sur téléphone ; ordre d'affichage `ordre, nom`. Chargement : squelettes ; erreur : bandeau + « Réessayer » ; collaborateur : `AccesRefuse`.
- **Ajouter** : fenêtre avec le champ Nom (1 à 80 caractères, espaces retirés aux extrémités), erreurs sous le champ ; la catégorie est créée active, en dernière position (`ordre` = max + 1) ; toast « Catégorie ajoutée. ». Elle apparaît aussitôt dans le formulaire public et dans la saisie interne.
- **Renommer** : même fenêtre préremplie ; le nouveau nom s'affiche partout (liste, détail, filtres, anciennes demandes : le nom est déjà lu en direct).
- **Désactiver** : fenêtre de confirmation (modèle `FenetreDesactiver`) « « [Nom] » ne sera plus proposée dans le formulaire ni dans le choix de catégorie. Les [n] demandes qui l'utilisent la gardent. » (phrase sans le nombre si n = 0, singulier pour 1). Refus de la dernière catégorie active : « Il doit rester au moins une catégorie active. ».
- **Réactiver** : bouton direct, toast « Catégorie réactivée. ».
- **Nom unique** sans tenir compte des majuscules, des accents, des tirets ni des apostrophes (`prive.normaliser`), sur **toutes** les catégories, actives ou non : ajouter ou renommer en « formation » ou « Formatión » quand « Formation » existe → sous le champ « Ce nom est déjà pris. », ou « Une catégorie désactivée porte déjà ce nom : réactivez-la. » si la catégorie existante est désactivée. Renommer en changeant seulement les majuscules de son propre nom est permis.
- **Migration `20261103000031_gerer_categories.sql`** : index unique sur `prive.normaliser(nom)` ; `lister_categories_admin()` (id, nom, actif, ordre, nombre de demandes) ; `ajouter_categorie(p_nom)`, `renommer_categorie(p_id, p_nom)`, `desactiver_categorie(p_id)`, `activer_categorie(p_id)`. Toutes `SECURITY DEFINER`, `search_path = ''`, administrateur actif vérifié en premier (`DROIT_INSUFFISANT`), `EXECUTE` à `authenticated` seulement. `desactiver_categorie` prend `pg_advisory_xact_lock(hashtextextended('categories:actives', 0))` puis lève `DERNIERE_CATEGORIE` s'il ne resterait aucune catégorie active ; état déjà atteint → `ETAT_CATEGORIE_INVALIDE`. Conflit de nom (y compris course sur l'index unique) → `NOM_CATEGORIE_PRIS`, avec en détail si l'autre catégorie est désactivée. Id inconnu → `DONNEES_INVALIDES`.
- **Journal** (type `categorie`, auteur = l'administrateur) : `categorie_ajoutee {categorie_id, nom}`, `categorie_renommee {categorie_id, nom, ancien_nom}` (seulement si le nom change), `categorie_desactivee {categorie_id, nom}`, `categorie_reactivee {categorie_id, nom}` ; enregistrés dans `lib/journal.ts` (`CLES_DETAILS_JOURNAL`, `TYPE_EVENEMENT_JOURNAL`, `PHRASES_JOURNAL`) : « Catégorie ajoutée : Formation », « Catégorie renommée : Formation → Formations », « Catégorie désactivée : Formation », « Catégorie réactivée : Formation ».
- Nouveaux codes dans `lib/erreurs.ts` ; listes de droits des tests à jour ; actions dans `lib/actions/categories.ts` (administrateur revérifié, Zod, `revalidatePath` de la page Catégories et de `/`).

**Never :**
- Pas de suppression de catégorie ni de changement d'ordre ; ne pas modifier `prive.normaliser` ni la vue `demandes_liste`.
- Ne pas toucher aux demandes existantes lors d'une désactivation.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Ajouter | « Formation » | Liste + formulaire public ; journal `categorie_ajoutee` |
| Doublon | « formation », « Formatión » | « Ce nom est déjà pris. » sous le champ |
| Doublon désactivé | « Formation » désactivée, ajout « formation » | « Une catégorie désactivée porte déjà ce nom : réactivez-la. » |
| Renommer | Formation → Formations | Nouveau nom sur les anciennes demandes et dans les filtres |
| Désactiver | Catégorie utilisée par 3 demandes | Disparaît du formulaire et du choix du détail ; reste sur les 3 demandes |
| Dernière active | Une seule active | « Il doit rester au moins une catégorie active. » |
| `changer_categorie` | Vers une catégorie désactivée | `CATEGORIE_INVALIDE` (déjà en place, à prouver) |
| Réactiver | Catégorie désactivée | De nouveau proposée |
| Collaborateur | Page ou fonctions | Refus, rien ne change |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000002_categories_parametres.sql:15-91` -- table `categories` (`nom` unique sensible à la casse, `actif`, `ordre`), `infos_publiques()` (filtre `actif`, tri `ordre, nom`) ; `0007:26,50` RLS lecture membres actifs et colonnes accordées ; `0017:40` colonne `ordre`.
- `20261103000019_recherche_corrections.sql:55` -- `prive.normaliser(text)` (immuable, sans droits ; ne pas modifier : la colonne `demandes.recherche` en dépend) ; miroir TS `normaliserRecherche` (`lib/filtres.ts`).
- `20261103000017_priorite_categorie.sql:102-161` -- `changer_categorie` refuse déjà une catégorie inactive (`CATEGORIE_INVALIDE`) ; `deposer_demande` (`0011:120`) et `saisir_demande` (`0021:86`) aussi.
- `lib/infos-publiques.ts`, `app/page.tsx` (`force-dynamic`), `lib/categories.ts` (`lireCategoriesAvec` : actives + actuelle ; `lireCategoriesSaisie`), `lib/options-filtres.ts:35-57` (toutes, suffixe « (désactivée) »), `components/nova/actions-demande.tsx:927` (`ChoixCategorie`).
- `lib/journal.ts:13-150` -- ajouter les 4 événements dans les trois tables ; test de toute la base `tests/story-5-1/base.test.ts:265-375`.
- Modèles d'écran et d'action : `app/equipe/admin/comptes/page.tsx` + `loading.tsx`, `components/nova/comptes/actions-compte.tsx` (`FormulaireModifier`, `FenetreDesactiver`, toasts), `lib/actions/admin.ts` (`verifierAdmin`, `clientSession`, `refusBase`), `components/nova/menu-equipe.tsx:33` (`RUBRIQUES_ADMIN`). Modèle « dernier » : `20261103000026_gerer_comptes.sql:53,151`.
- `lib/erreurs.ts` (`CATEGORIE_INVALIDE`, modèle `DERNIER_ADMIN`), test de concordance `tests/story-1-3/codes-erreur.test.ts` ; listes de droits `tests/securite/*`.
- Tests : base partagée — les catégories de test s'appellent `TEST-5.2-…` et sont **supprimées** en fin de test (avec leurs lignes de journal, purge `nova.purge_journal` comme `effacerJournalDesComptesTest`) ; ne jamais désactiver les 5 catégories réelles. Le cas « dernière catégorie active » se prouve sans toucher aux vraies catégories (transaction annulée, ou contrôle par l'action avec la base simulée).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000031_gerer_categories.sql` -- index, 5 fonctions ; à appliquer sur nova-dev par la session principale
- [x] `lib/erreurs.ts`, `lib/journal.ts`, `lib/schemas/categorie.ts`, `lib/categories-admin.ts` -- codes, événements, schéma, lecture
- [x] `lib/actions/categories.ts` -- quatre actions
- [x] `app/equipe/admin/categories/page.tsx` + `loading.tsx`, `components/nova/categories/*`, menu
- [x] `tests/story-5-2/` -- base (fonctions, unicité normalisée, dernière active, droits, journal), action, écran, navigateur (critères 1 à 4 dont formulaire public et ancienne demande renommée, axe, ordinateur et téléphone) ; listes de droits
- [x] `docs/carnet-ia.md` -- ligne de la story 5.2

**Acceptance Criteria :**
- Given la page Catégories, when j'ajoute « Formation », then elle apparaît aussitôt dans le formulaire public.
- Given une catégorie, when je la renomme, then le nouveau nom apparaît partout, y compris sur les anciennes demandes.
- Given une catégorie utilisée, when je la désactive, then elle disparaît du formulaire et du choix de catégorie du détail, mais reste affichée sur les anciennes demandes ; désactiver la dernière active affiche « Il doit rester au moins une catégorie active. ».
- Given « Formation » existante, when j'ajoute, renomme ou réactive une catégorie en « formation » ou « Formatión », then je lis que ce nom est déjà pris.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | VG + Blind | Verrou de `desactiver_categorie` jamais exercé par deux sessions | medium | Constat VG pré-vérifié ; retirer le verrou ne casserait aucun test → patch (test à deux connexions, catégories de test, annulé) |
| 2 | VG | Course sur l'index unique au renommage jamais testée | medium | Constat VG pré-vérifié → patch |
| 3 | VG | Toast d'erreur après « Désactiver » / « Réactiver » refusé jamais affiché en test | medium | Constat VG pré-vérifié → patch (test navigateur via `ETAT_CATEGORIE_INVALIDE`) |
| 4 | Blind + Edge | Focus perdu sur `ETAT_CATEGORIE_INVALIDE` | low | La ligne change d'état et le bouton disparaît → patch |
| 5 | Blind | Nom inchangé : toast « Catégorie renommée. » trompeur | low | `modifie: false` ignoré → patch |
| 6 | Blind + Edge | Catégorie disparue affichée comme erreur sous le champ Nom | low | Tout `DONNEES_INVALIDES` part sous le champ → patch (bandeau + rafraîchissement) |
| 7 | Blind | Nombre non formaté dans la fenêtre de désactivation | low | Correction directe → patch |
| 8 | Blind | `prive.normaliser` porte maintenant un index unique sans commentaire | low | Demande une migration ; noté pour toute future modification de la fonction → rejeté |
| 9 | Blind | Ancienne contrainte `nom unique` conservée | low | Couverte par l'index normalisé ; sans effet visible → rejeté |
| 10 | Blind | Deux ajouts simultanés reçoivent le même `ordre` | low | Seul effet : ordre départagé par le nom → rejeté |
| 11 | Blind | Saisie interne jamais vérifiée | low | Promis dans la fenêtre ; correction de test directe → patch |
| 12 | Blind | Réponse sans `id` transformée en succès | low | Correction directe → patch |
| 13 | Blind | Chemins d'erreur du renommage sans test navigateur | low | Couverts par les tests de base et d'action → rejeté |
| 14 | Blind | Carnet et plan absents du fichier de relecture | false | Exclus exprès (méthode) |
| 15 | Edge | Migration en échec si des noms existants entrent en collision une fois normalisés | false | Appliquée sans erreur sur nova-dev ; la production ne contient que les 5 catégories de départ, toutes distinctes ; un échec annulerait la migration entière |
| 16 | Edge | Caractères invisibles (U+200B…) contournent l'unicité | low | Saisie volontairement piégée par un administrateur ; demande une migration → rejeté |
| 17 | Edge | Nom fait seulement de ponctuation accepté | low | Se normalise en chaîne vide → patch (au moins une lettre ou un chiffre) |

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-5-2 tests/story-5-1 tests/story-2-4 tests/securite tests/story-1-3` -- vert
- `npx playwright test tests/story-5-2 tests/story-1-2 tests/story-2-4` -- vert, ordinateur et téléphone
