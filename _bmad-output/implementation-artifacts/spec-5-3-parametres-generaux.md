---
title: 'Story 5.3 — Modifier les paramètres généraux'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '1d383f5ee341e1044b46645de90bbb522e5af92c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-2-gerer-les-categories.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** le nom affiché, l'email de contact et la durée de conservation montrés aux clients sont figés par migration (« Nova Services », `contact@nova-services.example`, 24 mois).

**Approach :** une page `/equipe/admin/parametres` avec un formulaire (nom affiché, email de contact, durée de conservation de 6 mois à 5 ans) et un aperçu de la phrase vue par les clients ; une fonction `modifier_parametres` qui vérifie, enregistre et écrit le journal. Les pages publiques et l'email lisent déjà ces valeurs en direct.

## Boundaries & Constraints

**Always :**
- **Page** « Paramètres », entrée « Paramètres » dans le menu Administration (après « Catégories », avant « Journal »). Formulaire prérempli : « Nom affiché » (1 à 150 caractères), « Email de contact », « Durée de conservation » (liste : 6 mois, 1 an, 18 mois, 2 ans, 3 ans, 4 ans, 5 ans, libellés par `formaterDuree`) ; bouton « Enregistrer les paramètres » ; toast « Paramètres enregistrés. » ; erreurs sous le champ (« Cette adresse email ne semble pas valide. », même schéma Zod que les autres emails), focus sur le premier champ en erreur, saisie conservée. Collaborateur : `AccesRefuse`.
- **Aperçu** sous le formulaire, mis à jour pendant la saisie : la phrase du formulaire public « … Elles sont conservées [durée] après son traitement, puis supprimées. Pour les faire effacer, écrivez à [email]. » (même texte que `components/formulaire-depot.tsx:392-398`, extrait en une fonction partagée pour ne pas le dupliquer).
- **Effet** : formulaire public (en-tête, phrase de conservation, lien mailto), page de confirmation (« Contactez [nom] », email) et prochain email de confirmation affichent les nouvelles valeurs au chargement suivant (`revalidatePath("/")` et pages déjà `force-dynamic`).
- **Migration `20261103000032_modifier_parametres.sql`** : `modifier_parametres(p_nom_affiche, p_email_contact, p_duree_mois)` — administrateur actif sinon `DROIT_INSUFFISANT` ; valeurs normalisées (nom `btrim`, email `lower(btrim)`) ; nom vide/trop long, email sans forme `x@y.z`, durée hors 6–60 → `DONNEES_INVALIDES` ; met à jour `mis_a_jour_le` ; si rien ne change, renvoie `{modifie: false}` sans journal ; sinon journal `parametre` `{evenement: "parametres_modifies", …}` avec, pour chaque champ changé, l'ancienne et la nouvelle valeur (`nom_affiche`, `ancien_nom_affiche`, `email_contact`, `ancien_email_contact`, `duree_conservation_mois`, `ancienne_duree_conservation_mois`, seulement les clés des champs changés). `lire_parametres_admin()` pour préremplir. `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` à `authenticated` seulement ; listes de droits des tests à jour.
- **Journal** : l'événement enregistré dans `lib/journal.ts` (clés possibles, type `parametre`, phrase « Paramètres modifiés : email de contact a → b ; durée de conservation 2 ans → 3 ans » — seulement les champs changés).
- **Tests sur la base partagée** (la ligne `parametres` est lue par le formulaire public et par d'autres tests) : les tests Vitest ne modifient la ligne que dans une transaction **annulée**. Le test navigateur qui enregistre de vraies valeurs (critères 1 et 2) tourne dans un projet Playwright séparé qui **dépend** des projets `ordinateur` et `telephone` (il passe après tous les autres) et **remet toujours** les valeurs de départ en `finally`.

**Never :**
- Ne pas remplacer « Nova Services » dans les titres d'onglet, le menu de l'espace équipe ni les pages d'invitation (nom du produit, pas le nom affiché aux clients).
- Pas de champ supplémentaire (téléphone, adresse) ; pas de purge des demandes ici (story 5.5).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Email changé | `accueil@nova.example` | Formulaire public et page de confirmation l'affichent ; journal avec ancien et nouveau |
| Durée 3 ans | 36 mois | Aperçu et formulaire public : « 3 ans » |
| Email mal écrit | `accueil@nova` | « Cette adresse email ne semble pas valide. » sous le champ, rien d'enregistré |
| Durée hors bornes | 5 ou 61 (appel direct) | `DONNEES_INVALIDES` |
| Rien de changé | Mêmes valeurs | Pas de ligne de journal ; toast « Paramètres enregistrés. » |
| Collaborateur | Page ou fonction | Accès refusé ; `DROIT_INSUFFISANT` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000002_categories_parametres.sql:38-96` -- table `parametres` (une ligne, checks nom 1–150, email `lower(btrim)` + `like '%_@_%'`, durée 6–60, `mis_a_jour_le`, RLS sans règle), `infos_publiques()`.
- `20261103000009_emails_journal.sql:302` (`lire_confirmation`), `0011:47` (`deposer_demande`), `0021` (`saisir_demande`) -- lisent la ligne en direct ; ne pas les modifier.
- `lib/infos-publiques.ts:35-54`, `app/page.tsx:11-39`, `components/formulaire-depot.tsx:392-398` (phrase à extraire), `lib/confirmation.ts`, `app/confirmation/[jeton]/page.tsx:72-113`, `lib/server/emails.ts:97` (`contenuConfirmation`).
- `lib/format.ts:55` (`formaterDuree`) et son test `tests/story-1-2/format-duree.test.ts`.
- Modèles : `20261103000031_gerer_categories.sql` (droits, journal, `modifie: false`), `lib/actions/categories.ts` (`verifierAdmin`, `clientSession`, `refusBase`, `rafraichir`), `lib/schemas/compte.ts` / `categorie.ts`, `components/nova/categories/fenetre-nom-categorie.tsx` (`useTransition`, erreurs sous le champ), schéma email `lib/schemas/invitation.ts:36-45`.
- `lib/journal.ts` (`CLES_DETAILS_JOURNAL` — ici un ensemble de clés **permises**, toutes facultatives sauf `evenement` ; adapter le contrôle si la structure l'impose), test de toute la base `tests/story-5-1/base.test.ts:265-363` ; `lib/erreurs.ts` ; `components/nova/menu-equipe.tsx:34` ; listes de droits `tests/securite/*`.
- Tests qui lisent les valeurs de départ (ne doivent jamais voir d'autres valeurs) : `tests/story-1-2/infos-publiques.test.ts:50`, `formulaire.spec.ts:24,66`, `tests/story-1-3/envoi.spec.ts:135`, `deposer.test.ts:357`, `tests/story-1-7/notation.test.ts:124,304` ; modèle de modification annulée : `infos-publiques.test.ts:120-138`. `playwright.config.ts` pour le projet dépendant.
- `deferred-work.md:15-17` -- `mis_a_jour_le` à mettre à jour par `modifier_parametres` (traité ici).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000032_modifier_parametres.sql` -- deux fonctions ; à appliquer sur nova-dev par la session principale
- [x] `lib/erreurs.ts`, `lib/journal.ts`, `lib/schemas/parametres.ts`, `lib/parametres-admin.ts`, phrase de conservation partagée
- [x] `lib/actions/parametres.ts` -- `modifierParametres`
- [x] `app/equipe/admin/parametres/page.tsx` + `loading.tsx`, `components/nova/parametres/*`, menu
- [x] `tests/story-5-3/` -- base (transactions annulées : bornes, normalisation, journal, `modifie: false`, droits), action, écran (aperçu), navigateur dans un projet Playwright dépendant (critères 1 à 3, valeurs remises), axe, ordinateur et téléphone ; listes de droits
- [x] `docs/carnet-ia.md` -- ligne de la story 5.3

**Acceptance Criteria :**
- Given la page Paramètres, when je change l'email de contact, then le formulaire public et la page de confirmation affichent le nouveau.
- Given la durée de conservation, when je choisis 3 ans, then l'aperçu et le formulaire public affichent « 3 ans ».
- Given un email mal écrit, when j'enregistre, then un message l'indique sous le champ.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | VG + Blind | Durée enregistrée hors liste : l'option disparaît après un autre choix, et l'écran n'est pas testé avec elle | medium | Options construites depuis la saisie ; test seulement sur l'aide → patch (valeur enregistrée toujours proposée + test d'écran) |
| 2 | Blind + Edge | Deux administrateurs : le second écrase le premier sans avertissement | maybe-false | Demande deux sessions ouvertes en même temps ; correction = version attendue dans `modifier_parametres` (migration) → reporté |
| 3 | Blind | Les titres d'onglet gardent « Nova Services » | false | Décision du plan (Never) : nom du produit, pas le nom affiché aux clients |
| 4 | Blind | Aucun test ne prouve que l'email de confirmation lit les nouvelles valeurs | low | `deposer_demande` lit la ligne en direct, mais rien ne le vérifie ici → patch (test en transaction annulée) |
| 5 | Blind | Ligne `parametres` absente : `DONNEES_INVALIDES` | false | Ligne unique créée par migration, clé `check (id)` ; ne peut pas manquer |
| 6 | Blind + Edge | Projet Playwright dépendant sauté si un autre test échoue | low | L'exécution est alors rouge de toute façon et doit être relancée → rejeté |
| 7 | Blind | Le test réel modifie la base partagée pendant quelques secondes | maybe-false | Seulement si deux exécutions se chevauchent ; valeurs toujours remises → reporté (noté) |
| 8 | Blind | Bandeau d'erreur générale sans test | low | Même convention que les autres écrans d'administration → rejeté |
| 9 | Blind | Constantes 6/60 et `formaterDuree` recopiées | low | Correction directe → patch |
| 10 | Blind | `lireSaisieParametres` inutilisée | low | Code mort → patch |
| 11 | Blind | Règles de nettoyage différentes entre Zod et SQL (espaces Unicode) | low | Seulement par appel direct ; la base reste stricte → rejeté |
| 12 | Blind | Commentaire ajouté au milieu de `MESSAGES_ERREUR` | low | Bruit → patch |
| 13 | Blind | Phrase du journal ambiguë si un nom contient « → » ou « ; » | low | Correction directe (guillemets) → patch |
| 14 | Blind | Squelette de chargement différent de la page | low | Correction directe → patch |
| 15 | Edge | Focus sur un champ désactivé pendant l'envoi | low | Correction directe → patch |
| 16 | Edge | Bandeau d'erreur qui reste pendant la correction | low | Correction directe → patch |
| 17 | Edge | Événement à clés facultatives sans paires déclarées : refus silencieux | low | Correction directe → patch |
| 18 | Edge | Tests qui supposent des valeurs de départ différentes des valeurs de test | low | Correction directe → patch |

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-5-3 tests/story-5-1 tests/story-1-2 tests/story-1-3 tests/story-1-7 tests/securite` -- vert, lancés ensemble
- `npx playwright test` sur `tests/story-5-3 tests/story-1-2 tests/story-1-3` -- vert, ordinateur et téléphone, le projet dépendant en dernier
