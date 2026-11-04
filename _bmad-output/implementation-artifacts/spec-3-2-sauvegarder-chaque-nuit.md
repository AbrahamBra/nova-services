---
title: 'Story 3.2 — Sauvegarder les données chaque nuit (sans la partie SQL)'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '426638bcc82f4ecf82ecca2e7ff84686d52d4a92'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** l'offre gratuite de Supabase ne sauvegarde rien et met un projet en pause après 7 jours sans activité. Si la base est abîmée ou endormie, tout est perdu ou inaccessible.

**Approach :** deux tâches GitHub Actions. « Sauvegarde nocturne » exporte chaque nuit la base en trois fichiers, les chiffre avec une phrase secrète et les garde 30 jours (lancement manuel possible). « Réveil » envoie chaque jour une vraie requête à chaque projet Supabase. Pour l'instant elles visent le projet de **développement** ; elles basculent d'elles-mêmes sur la production dès que le secret de production existe (story 3.1).

## Boundaries & Constraints

**Always :**
- `.github/workflows/sauvegarde-nocturne.yml`, nom affiché « Sauvegarde nocturne » : `schedule` chaque nuit (`0 2 * * *`, soit 3 h ou 4 h à Paris) et `workflow_dispatch`. `permissions: contents: read`. Une seule exécution à la fois (`concurrency`).
- Cible : secret `PROD_SUPABASE_DB_URL` s'il est rempli, sinon `DEV_SUPABASE_DB_URL` (existant). Le nom de l'environnement choisi (`production` ou `developpement`) est affiché dans le résumé et dans le nom de l'artefact, jamais l'adresse. Adresse attendue : pooler en **mode session** (port 5432 de `pooler.supabase.com`) ; la tâche échoue avec un message clair sinon.
- Export avec Supabase CLI 3.0 (même version que `package.json`, `supabase/setup-cli`), syntaxe 3.0 `--remote=<url>` (pas `--db-url`) : `roles.sql` (`--role-only`), `structure.sql`, `donnees.sql` (`--data-only --use-copy`). Chaque fichier doit être non vide, sinon échec.
- Chiffrement : une archive `tar.gz` des trois fichiers, chiffrée avec `gpg --symmetric --cipher-algo AES256` et la phrase du secret `SAUVEGARDE_PHRASE`. La phrase passe par un descripteur ou un fichier temporaire, jamais en argument visible. Fichiers en clair supprimés avant l'envoi. Phrase absente : échec immédiat, rien n'est exporté.
- Vérifications dans la tâche (AD-12) : le fichier chiffré se déchiffre avec la bonne phrase et redonne les trois fichiers ; il **refuse** de se déchiffrer avec une mauvaise phrase ; il ne contient en clair ni `CREATE TABLE` ni `COPY`.
- Artefact `sauvegarde-<environnement>-<date AAAA-MM-JJ>-<numéro d'exécution>`, contenant seulement le fichier `.tar.gz.gpg`, `retention-days: 30`. Le dépôt est public : seul le fichier chiffré est publié, et les journaux n'affichent aucune donnée.
- `.github/workflows/reveil.yml`, nom « Réveil » : `schedule` quotidien (`0 6 * * *`) et `workflow_dispatch`. Matrice `developpement` (`DEV_SUPABASE_DB_URL`) / `production` (`PROD_SUPABASE_DB_URL`) : une vraie requête `psql` en lecture seule (`select count(*) from public.demandes`) ; si le secret de production est vide, l'étape le signale (« production non configurée ») et reste verte.
- **Décision d'Abraham (Q1, option a) :** après son accord sur le code, la branche `claude/exploitation-322b65` (jamais `main`) est commitée et envoyée sur GitHub ; les deux tâches ont donc un déclencheur `push` limité aux chemins de leurs propres fichiers, pour une exécution d'essai à chaque modification. Spec gardée entière.
- Abraham crée lui-même le secret `SAUVEGARDE_PHRASE` (`gh secret set SAUVEGARDE_PHRASE` dans une fenêtre PowerShell séparée, saisie masquée) et garde la phrase dans son gestionnaire de mots de passe : sans elle, aucune sauvegarde ne peut être relue.
- Test Vitest `tests/story-3-2/taches-github.test.ts` qui lit les deux fichiers et vérifie les points ci-dessus (déclencheurs, options d'export, chiffrement, 30 jours, artefact limité au fichier chiffré, aucune valeur de secret écrite en dur).
- Spec et carnet : noter que `purger_technique` (AD-23) **n'est pas faite ici** (elle demande une migration, faite par la session principale) ; son appel nocturne sera ajouté à cette tâche ensuite.

**Never :**
- Aucune migration, aucune fonction SQL, aucun `npm run db:push`, aucun changement de `tests.yml`, `lib/`, `app/` ou `supabase/`.
- Pas de restauration (story 3.4), pas de sauvegarde avant mise en ligne automatique (3.1).
- Aucun secret, adresse ou phrase dans le dépôt, les journaux ou le chat.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Nuit normale | Secrets dev + phrase | Vert ; artefact `sauvegarde-developpement-…` 30 jours | — |
| Lancement manuel | « Run workflow » | Même résultat | — |
| Production configurée | `PROD_SUPABASE_DB_URL` rempli | Sauvegarde de la production | — |
| Phrase absente | `SAUVEGARDE_PHRASE` vide | Rouge, message « phrase de chiffrement absente », aucun export | Arrêt avant l'export |
| Mauvaise adresse | Port 6543 ou adresse directe | Rouge, message « pooler en mode session attendu » | Arrêt avant l'export |
| Mauvaise phrase | Déchiffrement avec une autre phrase | Refusé (vérification interne) | La tâche échoue si ça réussit |
| Réveil sans production | Secret prod vide | Dev réveillé, « production non configurée », vert | — |

</frozen-after-approval>

## Code Map

- `.github/workflows/tests.yml` -- modèle (actions `@v4`, `permissions`, `concurrency`, secrets `DEV_…`) ; ne pas modifier.
- `scripts/secrets-github.mjs` -- crée les secrets `DEV_…` dont `DEV_SUPABASE_DB_URL` (pooler, mode session) ; ne pas modifier.
- `supabase/config.toml` -- PostgreSQL 17.
- `.gitleaks.toml` -- recherche de secrets : doit rester verte.
- `tests/story-1-1/*.test.ts` -- style des tests Vitest (français, `describe`/`it`).

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/sauvegarde-nocturne.yml` -- export, chiffrement, vérifications, artefact 30 jours.
- [x] `.github/workflows/reveil.yml` -- requête quotidienne par projet.
- [x] Les deux fichiers -- déclencheur `push` limité à leurs propres chemins (décision Q1).
- [x] `tests/story-3-2/taches-github.test.ts` -- vérifications du contenu des deux tâches.

**Acceptance Criteria:**
- Given la page « Actions », when Abraham lance « Sauvegarde nocturne » à la main, then elle se termine en vert et propose un fichier de sauvegarde conservé 30 jours.
- Given cet artefact téléchargé, when on l'ouvre sans la phrase, then il est illisible.
- Given la page « Actions », when Abraham regarde « Réveil », then le projet de développement a reçu sa requête (la production le sera après la story 3.1).

## Implementation Notes

- Le dossier de travail contient aussi les fichiers non commités de la story 3.3 (en pause) et le réglage `PORT_E2E` de `playwright.config.ts` : ne pas y toucher ; ils ne font pas partie de cette story. Le port 3000 est pris par le serveur du dossier principal : lancer les tests du navigateur avec `PORT_E2E=3133`.
- **`purger_technique` (AD-23) n'est pas faite dans cette story** : elle demande une migration, faite par la session principale. Son appel nocturne sera ajouté ensuite à `sauvegarde-nocturne.yml` (un commentaire en tête du fichier le rappelle).

## Spec Change Log

## Review Triage Log

| # | Relecteur | Remarque | Verdict | Preuve / suite |
|---|---|---|---|---|
| 1 | blind | Pas de procédure de restauration | false | Exclue par l'intention : story 3.4 (restauration réelle). |
| 2 | blind | GitHub suspend les tâches planifiées après 60 jours sans activité | medium | Réel (limite connue, epic-3-context) ; defer : à documenter dans la maintenance (story 3.6). |
| 3 | blind, edge, gap | `grep COPY` sur le chiffré : faux rouges aléatoires quand l'archive grossit | medium | patch : marqueurs longs + contrôle `gpg --list-packets`. |
| 4 | blind | Force de la phrase non vérifiée (dépôt public) | medium | patch : 32 caractères minimum. |
| 5 | blind | Actions épinglées par étiquette et non par empreinte | low | defer : même pratique que `tests.yml` ; à traiter pour tout le dépôt. |
| 6 | blind | `actions/checkout` inutile | low | patch : suppression (correction directe). |
| 7 | blind, edge | `push` sans filtre de branche | low | Voulu (décision Q1, essai sur la branche) ; seuls les collaborateurs du dépôt poussent des branches, et l'artefact est chiffré. Rejeté. |
| 8 | blind, gap | Tests qui lisent le texte, sans exécuter le bash | medium | defer : sortir la garde d'adresse dans un script testé, à faire avec l'ajout de `purger_technique`. |
| 9 | blind | Réveil sans `sslmode`, sans délai de connexion | low | patch : `PGSSLMODE=require`, `PGCONNECT_TIMEOUT=10` (deux variables). |
| 10 | blind | Contenu exact de la sauvegarde (`auth.users` inclus ?) non vérifié | maybe-false | defer : à prouver lors de la restauration réelle (3.4) en comptant les comptes restaurés. |
| 11 | blind | Carnet : colonne de vérification commençant par « À faire » | low | patch : « Non encore vérifié par Abraham ». |
| 12 | edge | Phrase avec saut de ligne tronquée par gpg | low | patch, regroupé avec 4 (même étape, refus explicite). |
| 13 | edge | Relance (« Re-run ») : même nom d'artefact, envoi refusé | medium | patch : `-$GITHUB_RUN_ATTEMPT` dans le nom. |
| 14 | edge | Échec gpg compté comme « mauvaise phrase refusée » quelle qu'en soit la cause | low | Le déchiffrement avec la bonne phrase est vérifié juste après (empreintes identiques) : un fichier corrompu échoue là. Rejeté. |
| 15 | edge | `concurrency` : une exécution en attente peut être remplacée | low | Rare (une exécution par nuit) ; rejeté. |
| 16 | edge | Erreurs de connexion affichant l'hôte et l'identifiant du projet | low | L'identifiant du projet est déjà public (adresse `NEXT_PUBLIC_SUPABASE_URL` envoyée aux navigateurs) ; le mot de passe n'est jamais affiché. Rejeté. |
| 17 | edge | Réveil : adresse non contrôlée | low | Une mauvaise adresse fait échouer la tâche en rouge, visible. Rejeté. |
| 18 | edge | Fins de ligne CRLF sous Windows : expressions `
` du test cassées | high | Réel (`core.autocrlf=true`, pas de `.gitattributes`) ; patch : normalisation à la lecture. |
| 19 | gap | Adresse sans `/postgres` refusée avec un message trompeur | low | Les secrets existants contiennent `/postgres` ; rejeté. |

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert.

**Manual checks (if no CLI):**
- Sur GitHub (si option a) : deux exécutions vertes, artefact chiffré de 30 jours, journaux sans donnée.
