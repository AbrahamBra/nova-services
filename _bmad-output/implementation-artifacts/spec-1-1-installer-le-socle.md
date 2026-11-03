---
title: 'Story 1.1 — Installer le socle du projet'
type: 'chore'
created: '2026-11-03'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-coursenia-2026-11-03/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** le dossier `coursenia` ne contient que la documentation. Il n'y a ni application, ni base branchée, ni tests, ni protection contre les fuites de secrets, alors que le dépôt sera public.

**Approach :** installer le projet Next.js 16.4 et shadcn (base Radix) à la racine de `coursenia`, aux couleurs de DESIGN.md, avec une page provisoire « Nova Services ». Brancher le projet Supabase de développement (Paris) et y appliquer une première migration qui retire tous les droits par défaut et crée le schéma `prive`. Poser les utilitaires communs, les tests (Vitest, Playwright + axe), la tâche GitHub « Tests » avec gitleaks, `.env.example` et le carnet d'usage de l'IA.

## Boundaries & Constraints

**Always :**
- Stack et versions de l'architecture §1 ; Cache Components désactivé.
- Aucun client Supabase dans le navigateur (AD-1). La clé secrète n'est lue que dans `lib/server/` (AD-9).
- `.env.local` jamais versionné ; `.env.example` versionné, sans valeur.
- Les tests refusent de tourner si `SUPABASE_ENVIRONNEMENT` ne vaut pas `developpement` (AD-27).
- Les clés sont saisies **par Abraham** dans `.env.local`, jamais dans le chat.
- Textes en français ; carnet `docs/carnet-ia.md` mis à jour.
- Décision d'Abraham (03/11/2026) : le dépôt GitHub public s'appelle `nova-services`.

**Never :**
- Aucune table métier (catégories, demandes…) : elles arrivent aux stories suivantes.
- Pas de commit, de création de dépôt GitHub ni d'envoi avant la vérification d'Abraham (consigne de la séquence 7).
- Pas de Docker, pas de Supabase local.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Page provisoire | `npm run dev`, ouverture de `/` | « Nova Services » en bleu marine, police Inter | — |
| Droits `anon` | Requête sur les droits du rôle `anon` | Aucun droit sur les tables, vues, séquences et fonctions de `public`, ni sur `prive` | Test rouge |
| Mauvais environnement | `SUPABASE_ENVIRONNEMENT` absent ou différent | Les tests s'arrêtent avec un message clair | Arrêt avant toute connexion |
| Secret dans le code | Clé collée par erreur dans un fichier versionné | gitleaks échoue | Tâche « Tests » rouge |

</frozen-after-approval>

## Code Map

- `_bmad/`, `.claude/`, `_bmad-output/`, `docs/` -- existants, **à ne pas modifier** (sauf ajout de `docs/carnet-ia.md`). Ils seront versionnés : le jury verra la méthode BMAD.
- `docs/cahier-des-charges.md`, `docs/prompts-formation.md` -- existants, conservés.
- Aucun code applicatif n'existe : tout est créé.

## Tasks & Acceptance

**Execution :**
- [x] racine -- générer le projet avec `create-next-app@16.4` (`--yes --no-cache-components`, TypeScript, Tailwind, App Router, npm) dans un dossier temporaire, puis le déplacer à la racine sans écraser les dossiers existants -- create-next-app refuse un dossier non vide
- [x] racine -- `npx shadcn@4.23 init --base radix` -- composants de base
- [x] `app/globals.css`, `app/layout.tsx` -- réglages de couleurs, rayons et police Inter de DESIGN.md ; `lang="fr"` -- UX-DR1
- [x] `app/page.tsx` -- page provisoire « Nova Services » (titre, phrase « Application en construction »), remplacée en 1.2
- [x] `supabase/config.toml`, `supabase/migrations/20261103000001_verrouillage_droits.sql` -- `REVOKE ALL` et `ALTER DEFAULT PRIVILEGES` pour `anon`, `authenticated` et `public` sur le schéma `public` (tables, séquences, fonctions) ; création du schéma `prive` sans aucun droit -- AD-2, AD-15
- [x] `lib/supabase/serveur.ts` -- client serveur `@supabase/ssr` (clé publiable, cookies)
- [x] `lib/server/supabase-service.ts` -- client clé secrète, avec `import 'server-only'`
- [x] `lib/server/appeler.ts` -- appel d'une fonction SQL et traduction en `{ ok, donnees } | { ok, code, message }` -- AD-7, AD-20
- [x] `lib/domaine.ts`, `lib/erreurs.ts`, `lib/format.ts` -- codes fermés et libellés ; codes d'erreur et messages (`ERREUR_INATTENDUE`) ; dates en `Europe/Paris`, format `03/11/2026 à 09:12` -- AD-18, AD-20, AD-24
- [x] `vitest.config.ts`, `tests/garde-environnement.ts` -- configuration et garde-fou de l'environnement
- [x] `tests/story-1-1/format.test.ts`, `tests/story-1-1/appeler.test.ts` -- tests unitaires en français
- [x] `tests/securite/droits-anon.test.ts` -- lit les droits dans le catalogue PostgreSQL via `SUPABASE_DB_URL` (paquet `pg`) : aucun droit pour `anon` ni `authenticated` hors liste attendue (vide pour l'instant)
- [x] `playwright.config.ts`, `tests/story-1-1/page-provisoire.spec.ts` -- la page s'affiche et passe axe
- [x] `.github/workflows/tests.yml` -- installation, lint, typage, Vitest (secrets du projet dev), Playwright, gitleaks
- [x] `.env.example`, `.gitignore` -- toutes les variables de l'architecture sans valeur ; `.env*` ignorés sauf `.env.example`
- [x] `package.json` -- scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `verifier`, `db:push` (`supabase db push --db-url`)
- [x] `docs/carnet-ia.md` -- tableau story / ce que l'IA a produit / ce qu'Abraham a vérifié, première ligne 1.1
- [x] `.claude/launch.json` -- serveur de développement pour l'aperçu

**Acceptance Criteria :**
- Given le projet installé, when Abraham lance l'aperçu, then la page « Nova Services » s'affiche en bleu marine avec Inter.
- Given `.env.local` rempli par Abraham, when `npm run db:push` puis `npm test`, then la migration est appliquée sur `nova-dev` et tous les tests sont verts.
- Given les fichiers prêts, when on liste ce qui serait versionné, then `.env.example` y est et `.env.local` n'y est pas.
- Given `docs/carnet-ia.md`, when Abraham l'ouvre, then il contient la ligne de la story 1.1.
- Given la sauvegarde autorisée par Abraham, when le dépôt est envoyé sur GitHub, then la tâche « Tests » (avec gitleaks) est verte.

## Implementation Notes

- create-next-app 16.4.4 : `--yes --no-cache-components --ts --tailwind --eslint --app --use-npm --disable-git` (pas de Git initialisé). Turbopack + `@tailwindcss/turbopack`, pas de postcss.config. `AGENTS.md` (réécrit par `next dev`) et `README.md` d'origine conservés.
- shadcn 4.23 : `init --base radix --preset nova` (la commande demande un preset) ; composant `button` ajouté. `lib/utils.ts` réexporte `cn` du paquet `cn`.
- `@types/node` passé en ^22 (exigé par Vitest 5.1 ; Node 22 sur Netlify). `vite` ajouté en dépendance de dev pour `loadEnv` dans `vitest.config.ts`.
- Rayons : `--radius-sm/md/lg` fixés à 4/6/8 px. Le `Button` shadcn généré utilise `rounded-lg` (8 px) : à envelopper en 1.2 pour obtenir 6 px (on ne modifie pas le composant).
- Mode sombre neutralisé (bloc `.dark` retiré, variante `dark` liée à une classe jamais posée).
- Migration : `alter default privileges for role postgres` (rôle des migrations) ; les objets créés par `supabase_admin` ne sont pas couverts. `USAGE` sur le schéma `public` laissé à `anon` (aucun objet lisible). `service_role` non touché.
- Migration et requête de `droits-anon` validées hors ligne sur PGlite (PostgreSQL 17) avec les droits par défaut de Supabase simulés : 22 droits avant, 0 après, 0 sur les objets créés ensuite.
- `verifier` = lint + typage (sans base) : Vitest refuse de tourner hors `developpement`, donc ne peut pas faire partie du build Netlify de production.
- `db:push` = `scripts/db-push.mjs` : charge `.env.local` et appelle la CLI sans shell (mot de passe non interprété, jamais affiché).
- Secrets GitHub attendus par `tests.yml` : `DEV_SUPABASE_URL`, `DEV_SUPABASE_PUBLISHABLE_KEY`, `DEV_SUPABASE_SECRET_KEY`, `DEV_SUPABASE_DB_URL`.
- gitleaks non lancé en local : pas de binaire installé, et le paquet npm `gitleaks` est sans rapport avec le vrai outil (ne pas utiliser `npx gitleaks`). Recherche manuelle de motifs de clés : aucun secret.

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| `db-push.mjs` sans contrôle d'environnement | medium | Écrivait sur n'importe quelle base ; corrigé (patch) : refus hors `developpement` sauf `--production`. |
| Échec de lancement de la CLI silencieux | low | Corrigé (patch) : message en français. |
| `@next/env` non déclaré | low | Corrigé (patch) : ajouté en devDependency. |
| La CI ne pousse pas les migrations avant les tests | medium | Corrigé (patch) : étape « Appliquer les migrations (dev) ». |
| Déclenchement en double (push + PR) sur la base partagée | low | Corrigé (patch) : push limité à `main`. |
| `appeler()` ne laisse aucune trace des erreurs imprévues | low | Corrigé (patch) : `console.error` avec fonction et code seulement. |
| `estCodeErreur` réel jamais testé | medium | Corrigé (patch) : `tests/story-1-1/erreurs.test.ts`. |
| README d'origine en anglais et contradictoire | low | Corrigé (patch) : README français. |
| `cn` viendrait d'un paquet non vérifié | false | `npm view cn` : dépôt `shadcn-ui/cn`, paquet officiel de shadcn. |
| `supabase/.temp/cli-latest` versionné | false | Pas encore de dépôt Git ; `/supabase/.temp/` est dans `.gitignore`. |
| Mot de passe de la base visible dans la liste des processus | low | Rejeté : PC personnel à un seul utilisateur ; correction coûteuse. |
| Le garde-fou ne vérifie que l'étiquette d'environnement | low | Rejeté : AD-27 prévoit l'étiquette ; la production n'existe pas encore (revoir en 3.1). |
| `config.toml` : adresses d'authentification | false | Ce fichier ne sert qu'à un Supabase local, non utilisé ; les adresses distantes se règlent dans Supabase (story 1.4). |
| Défauts de droits par schéma sur `prive` sans effet / objets de `supabase_admin` | maybe-false | Le test lit le catalogue réel pour tous les objets, quel que soit le créateur, et passe. |
| Procédures non couvertes | false | Aucune procédure dans `public`. |
| Chaîne ISO sans fuseau dans `format.ts` | low | Rejeté : les dates viennent de la base en `timestamptz`, toujours avec fuseau. |
| Interrupteur du mode démonstration absent | false | `EMAILS_AUTORISES` joue ce rôle (AD-13). |
| Commentaire `.env.example` « Irlande » contre « Paris » dans l'intention | false | Décision d'Abraham du 03/11/2026 : projet en `eu-west-1` (Irlande, UE). |
| Délai de 180 s du serveur Playwright en CI | maybe-false | À observer au premier passage GitHub. |
| PR depuis un fork sans secrets | low | Rejeté : dépôt d'un seul contributeur. |
| Bouton : `rounded-lg` (8 px), survol non conforme, couleurs `--secondary` | medium | Reporté à la story 1.2 (premier bouton à l'écran). |
| Droits par colonne non détectés par le test | medium | Reporté à la story 1.5 (premiers droits par colonne). |
| Garde-fou non vérifié dans la config Vitest et absent de Playwright | medium | Reporté (non vérifié pour Playwright) : sans base pour l'instant. |
| Droit CREATE sur `public` non vérifié par le test | low | Rejeté : vérifié par la migration ; ajout possible plus tard. |

## Verification

**Commands :**
- `npm run lint` -- aucune erreur
- `npm run typecheck` -- aucune erreur
- `npm test` -- tous les tests verts, y compris `droits-anon`
- `npm run test:e2e` -- page provisoire affichée, axe sans violation
- `npx gitleaks detect --no-git` (ou l'action GitHub) -- aucun secret

**Si `.env.local` n'existe pas encore** (Abraham crée son projet Supabase en parallèle) : tout construire, lancer tout ce qui ne demande pas la base, et lister précisément les commandes restantes (`db:push`, tests de sécurité). Ne jamais créer ni deviner de clé ; ne pas initialiser Git, ne rien commiter.

**Manual checks :**
- Aperçu de `/` : couleurs et police conformes à DESIGN.md.
