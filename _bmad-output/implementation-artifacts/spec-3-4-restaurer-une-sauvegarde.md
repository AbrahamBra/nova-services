---
title: 'Story 3.4 — Restaurer une sauvegarde (essai réel)'
type: 'feature'
created: '2026-11-06'
status: 'in-review'
baseline_commit: '52b4d074ed8952f3fc99b62c6bd8385c47840909'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/.github/workflows/sauvegarde-nocturne.yml'
  - '{project-root}/docs/exploitation/restauration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** une sauvegarde n'a de valeur que si on sait la remettre en place. Personne n'a encore restauré une sauvegarde de Nova Services, et rien n'empêche des données effacées à la demande d'une personne de réapparaître après une restauration (AD-30).

**Approach :** créer le registre `effacements` et la fonction `rejouer_effacements()` ; créer une tâche GitHub « Restauration de test » qui déchiffre la dernière sauvegarde de production, la restaure dans une **base Supabase jetable créée dans le runner** (jamais dans `nova-dev` ni en production), rejoue les effacements, compare les nombres de demandes et publie un rapport ; faire l'essai réel avec Abraham et écrire la procédure.

## Boundaries & Constraints

**Always :**
- **Décision d'Abraham (06/11/2026) :** restauration dans une base jetable du runner GitHub (option a), et non dans `nova-dev`, pour ne pas écraser la base partagée de la session principale. Écart assumé avec AD-12 (« vers le projet de développement ») et avec le critère 3 de la story (`donnees:remplir` devient sans objet, `nova-dev` n'étant jamais touché) ; à noter dans la procédure et le carnet.
- Migration `supabase/migrations/20261103000027_effacements.sql` (numéro 0027 réservé auprès de la session principale ; si la 0028 est fusionnée avant, renuméroter) : table `public.effacements` (référence de demande unique, date d'effacement ; aucune autre donnée), RLS activée, aucun droit direct pour `anon`, `authenticated`, `service_role` ; fonction `public.rejouer_effacements()` `SECURITY DEFINER`, `SET search_path = ''`, tables qualifiées, `EXECUTE` à `service_role` seul (AD-15), qui supprime les demandes dont la référence figure dans `effacements` (historique et notes suivent par `on delete cascade`) et renvoie le nombre de demandes effacées à nouveau. Aucune écriture dans `effacements` ici : `effacer_demandeur` (epic 5) la remplira.
- `tests/securite/` et la liste exacte des fonctions exécutables par `service_role` de `tests/story-1-3/deposer.test.ts` (vers les lignes 412-436) : complétées pour la table et la fonction (accord de la session principale). Dès l'envoi de la branche, la CI applique 0027 sur `nova-dev` (`db:push -- --yes`) : la migration doit être sans risque pour la base partagée (création seulement).
- `.github/workflows/restauration-test.yml`, nom « Restauration de test » : `workflow_dispatch` seulement ; `permissions: actions: read, contents: read` ; télécharge le dernier artefact `sauvegarde-production-*` réussi de « Sauvegarde nocturne » (ou celui d'une exécution donnée en entrée) ; vérifie et déchiffre avec `SAUVEGARDE_PHRASE` (mêmes précautions que la sauvegarde : phrase par fichier, fichiers en clair supprimés à la fin, rien d'affiché) ; démarre une base Supabase locale avec la CLI 3.0 du dépôt **sans** appliquer les migrations du dépôt ni `seed.sql` (la structure vient de la sauvegarde) ; restaure `roles.sql`, `structure.sql`, puis `donnees.sql` avec `session_replication_role = replica`, en une transaction, arrêt à la première erreur (méthode de la documentation Supabase « Backup and restore using CLI ») ; appelle `select public.rejouer_effacements()` ; publie dans le résumé : date de la sauvegarde, lignes de `public.demandes` dans `donnees.sql`, demandes restaurées, membres et comptes restaurés, demandes effacées à nouveau, durée de chaque étape. Échec en rouge si les nombres diffèrent.
- La tâche ne se connecte jamais à `nova-dev` ni à la production : elle n'a besoin que de `SAUVEGARDE_PHRASE` et du jeton GitHub.
- Test Vitest `tests/story-3-4/` : contenu de la tâche (déclencheur, permissions, aucun secret de base, rejeu des effacements, comparaison des nombres) et comportement de `rejouer_effacements()` sur la base de développement avec des données `TEST-` créées puis supprimées par le test.
- Essai réel : Abraham dépose 3 demandes fictives en production (`Contrôle restauration 1/2/3`), lance « Sauvegarde nocturne » à la main puis « Restauration de test » ; le rapport doit montrer le même nombre de demandes que la production à l'heure de la sauvegarde.
- `docs/exploitation/restauration.md` : quand restaurer, procédure de l'essai (base jetable), procédure de la **vraie** restauration en production (nouvelle sauvegarde d'abord, mise en maintenance, restauration dans `nova-prod`, `rejouer_effacements()`, vérifications), date, durée et résultat de l'essai. Carnet IA : ligne 3.4 et incidents.

**Never :** aucune restauration dans `nova-dev` ni en production pendant cette story ; aucune donnée de la sauvegarde dans les journaux ni dans un artefact ; pas de `donnees:remplir` ni de changement de `lib/actions/`, `components/nova/*`, `app/equipe/demandes/*`.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Essai normal | Dernière sauvegarde de production | Rapport : N demandes dans la sauvegarde = N restaurées ; tâche verte | — |
| Phrase absente ou fausse | `SAUVEGARDE_PHRASE` vide ou erronée | Rouge avant toute restauration | Message clair |
| Aucune sauvegarde | Aucun artefact disponible | Rouge, « aucune sauvegarde de production » | — |
| Nombres différents | Restauration incomplète | Rouge, nombres affichés | — |
| Référence effacée | Référence présente dans `effacements` et dans la sauvegarde | Demande, historique et notes supprimés ; compteur à 1 | — |
| Appel direct | `rejouer_effacements()` par `anon` ou `authenticated` | Refusé | Droit `EXECUTE` absent |

</frozen-after-approval>

## Code Map

- `.github/workflows/sauvegarde-nocturne.yml` -- modèle (nom d'artefact `sauvegarde-<env>-<date>-<run>-<attempt>`, gpg, contrôles) ; ne pas modifier.
- `supabase/config.toml` -- PostgreSQL 17, base locale de la CLI.
- `supabase/migrations/20261103000003_demandes.sql` -- `historique` : `on delete cascade` vers `demandes`, déclencheur qui n'interdit que `update`.
- `supabase/migrations/20261103000015_notes.sql` -- `notes` : `on delete cascade`.
- `tests/securite/droits-anon.test.ts`, `droits-service-role.test.ts` -- listes de droits attendues.
- `tests/outils/` -- comptes et demandes `TEST-` jetables pour les tests de base.
- `docs/exploitation/restauration.md` -- squelette « À compléter (story 3.4) ».

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261103000027_effacements.sql` -- table et fonction.
- [x] `tests/securite/*` -- listes attendues.
- [x] `.github/workflows/restauration-test.yml` -- tâche de restauration de test.
- [x] `tests/story-3-4/*` -- tâche et fonction.
- [x] `docs/exploitation/restauration.md`, `maintenance.md`, `indisponibilite.md`, `protection-des-donnees.md` -- procédure et marques « À compléter (story 3.4) ».

**Acceptance Criteria:**
- Given 3 demandes fictives déposées en production avant une sauvegarde, when Abraham lance « Restauration de test », then le rapport affiche le nombre de demandes de la sauvegarde et celui de la base restaurée, égaux au nombre de demandes de la production au moment de la sauvegarde.
- Given l'essai terminé, when il ouvre `docs/exploitation/restauration.md`, then il y lit la procédure, la date, la durée et le résultat.
- Given la restauration, when la tâche se termine, then `rejouer_effacements()` a été appelée et son résultat figure dans le rapport.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Relecteur | Remarque | Verdict | Suite |
|---|---|---|---|---|
| 1 | blind, edge | Le registre `effacements` est restauré avec la sauvegarde : les effacements postérieurs sont perdus, le rejeu rend 0 | high | Réel (AD-30 suppose un registre à jour) ; patch : procédure d'export puis réinjection du registre courant avant le rejeu ; note dans la migration. |
| 2 | edge | `${{ runner.temp }}` dans l'env de la tâche : fichier invalide | high | patch. |
| 3 | blind, gap, edge | `echo "x=$(…)"` masque l'échec de psql | medium | patch, avec un message propre pour la fonction absente. |
| 4 | blind | Compteur de références remis à l'heure de la sauvegarde : références réémises | medium | patch (procédure). |
| 5 | blind, edge | Vraie restauration : étapes 5 à 8 confondent nouveau projet et `nova-prod` | medium | patch (procédure). |
| 6 | blind | Rejeu limité à `demandes` (envois, journal) | false | Seules `historique` et `notes` référencent `demandes` (cascade) ; le journal cite des membres, jamais les demandeurs (AD-14). |
| 7 | blind | Comparaison limitée à 3 tables | medium | patch : `historique` et `notes` comparés. |
| 8 | blind, edge | Comptage de la production avant la sauvegarde : écart possible | low | patch (procédure). |
| 9 | blind, edge | Messages d'erreur absents du tableau ; 404 brut | low | patch. |
| 10 | blind, edge | Écart de version du schéma `auth` | maybe-false | patch (documentation du cas 42703). |
| 11 | blind | Durée totale absente | low | patch. |
| 12 | blind | `setup-cli` non épinglé | low | defer (même report que 3.2). |
| 13 | blind | Test fragile sur la base partagée (effacement global) | medium | patch : garde sur le contenu du registre. |
| 14 | blind | Dépendance epic 5 non suivie | medium | defer (deferred-work). |
| 15 | blind | AD-12 non mis à jour | low | patch (une ligne). |
| 16 | blind | Phrase changée : anciennes sauvegardes non testables | low | patch (note). |
| 17 | blind, edge | Story présentée comme livrée sans essai réel | low | Rejeté : carnet et procédure disent « À compléter » ; l'essai suit la fusion. |
| 18 | gap | Logique de la tâche jamais exécutée, tests textuels | medium | defer (script testable) ; l'essai réel est la vérification ; patch partiel : en-têtes `COPY` entre guillemets acceptés. |

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- verts.
- Exécution de « Restauration de test » sur GitHub -- verte, rapport complet.
