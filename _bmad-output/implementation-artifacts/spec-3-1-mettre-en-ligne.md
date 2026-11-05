---
title: 'Story 3.1 — Mettre l''application en ligne'
type: 'feature'
created: '2026-11-05'
status: 'in-review'
baseline_commit: '8e5318cc5af34ab9b0e73d1a3d90b89b74559c15'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/exploitation/deploiement.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** l'application ne tourne que sur l'ordinateur d'Abraham, avec la base de développement. Personne ne peut l'utiliser pour de vrai.

**Approach :** préparer dans le code tout ce que la mise en ligne demande (réglages Netlify, version affichée, scripts capables de viser la production sans risque, documentation), puis guider Abraham pas à pas pour qu'il crée lui-même le projet Supabase de production (Irlande), le site Netlify, les variables, la protection de `main` et l'étiquette `v1.0.0`. L'IA ne crée aucun compte et ne manipule aucune clé.

## Boundaries & Constraints

**Always :**
- `netlify.toml` : commande de build `npm run verifier && npm run build` (vérifications rapides **sans** base, puis construction), Node 22, branche de production `main` (AD-11). Rien d'autre de secret dans ce fichier.
- Version : `package.json` passe à `1.0.0` ; `next.config.ts` injecte `NEXT_PUBLIC_APP_VERSION` = `v` + version de `package.json` au build (jamais saisie à la main) ; « Version v1.0.0 » en petit et en gris en bas de chaque page interne, dans `app/equipe/layout.tsx` (DESIGN.md, NFR-4).
- Scripts en production : `npm run db:push -- --production`, `npm run admin:creer -- --production` et `npm run secrets:github -- --production` lisent **uniquement** un fichier `.env.scripts-production.local` (exclu de Git par `.env*`), jamais `.env.local`, et refusent de tourner si ce fichier n'indique pas `SUPABASE_ENVIRONNEMENT=production`. Sans `--production`, rien ne change (développement seulement). `comptes:test` et les données d'essai refusent toujours la production.
- `secrets:github -- --production` envoie seulement `PROD_SUPABASE_DB_URL` (pour la sauvegarde nocturne et le réveil de la story 3.2).
- Variables Netlify par contexte (saisies par Abraham) : **Production** → projet Supabase de production, `SUPABASE_ENVIRONNEMENT=production` ; **prévisualisations et branches** → projet de développement, `SUPABASE_ENVIRONNEMENT=developpement`. `HMAC_SECRET` dans **tous** les contextes (valeur différente en production). `NEXT_PUBLIC_SENTRY_DSN` dans tous les contextes. `NETLIFY_NEXT_SKEW_PROTECTION=true`. **Jamais** `IP_DE_TEST_AUTORISEE` sur Netlify.
- Projet Supabase de production : région Irlande (`eu-west-1`), inscriptions libres désactivées, mot de passe de 8 caractères minimum, anciennes clés `anon` / `service_role` désactivées (AD-9). Migrations appliquées, aucune donnée d'essai (`seed.sql` et `supabase/essai/` jamais chargés), premier administrateur créé par Abraham.
- Protection de `main` sur GitHub : fusion seulement si « Lint, typage, Vitest, Playwright » et « Recherche de secrets (gitleaks) » sont verts. Faite par Abraham dans les réglages du dépôt.
- `npm audit --omit=dev` : aucune faille « high » ou « critical ».
- Vérification de l'en-tête `x-nf-client-connection-ip` sur une prévisualisation : 6ᵉ dépôt refusé (anti-spam, story 1.8) ; connexion possible (story 1.9). Faite par Abraham à la main, jamais par un test automatique.
- Tests automatiques : jamais contre la production (garde `verifierEnvironnement` existante, inchangée).
- Documentation : remplir les « À compléter (story 3.1) » de `docs/` (déploiement, sécurité, protection des données) et corriger le README (« région Paris » → Irlande).
- **Décision d'Abraham après relecture (05/11/2026) :** le fichier des clés de production s'appelle `.env.scripts-production.local` (Next.js charge tout seul `.env.production.local` lors d'un `next build` / `next start` local, ce qui aurait mélangé la production à une construction locale). Les scripts ne lisent que ce fichier en `--production`.
- **Décisions d'Abraham (05/11/2026) :** Q1 (a) clés de production dans `.env.scripts-production.local` sur son PC, utilisé seulement pour les migrations, le premier administrateur et le secret GitHub `PROD_SUPABASE_DB_URL` ; Q2 (a) les prévisualisations et branches Netlify utilisent la base de **développement** ; Q3 (a) pas de Resend en production pour l'instant (emails notés « non envoyés », compte créé plus tard sans changer le code). Spec gardée entière.
- La fusion de la branche dans `main` et l'étiquette `v1.0.0` n'ont lieu qu'avec l'accord explicite d'Abraham, coordonnées avec la session principale.

**Never :**
- Aucune migration nouvelle, aucun changement de `lib/actions/demandes.ts`, `components/nova/*`, `app/equipe/demandes/*` (epic 2).
- Aucun test, script de données d'essai ou `comptes:test` contre la production. Aucune clé, mot de passe ou adresse de base dans le dépôt, le chat ou les journaux.
- Pas d'envoi des cartes du code source à Sentry (pas de `SENTRY_AUTH_TOKEN`) dans cette story.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Migrations en production | `db:push -- --production`, `.env.scripts-production.local` correct | Migrations appliquées sur la production | — |
| Fichier de production absent | `--production` sans `.env.scripts-production.local` | Refus, message clair | Arrêt avant toute connexion |
| Mauvais environnement | `.env.scripts-production.local` avec `developpement` | Refus | Arrêt |
| Sans `--production` | `.env.local` de développement | Comportement actuel inchangé | — |
| Comptes de test | `comptes:test -- --production` | Refus | Arrêt |
| Version | Build avec `package.json` 1.0.0 | « Version v1.0.0 » en bas des pages internes | — |

</frozen-after-approval>

## Code Map

- `scripts/db-push.mjs` -- accepte déjà `--production` mais charge `.env.local` : charger `.env.scripts-production.local` à la place dans ce cas.
- `scripts/commun.ts` (`preparerEnvironnement`) -- refuse `--production` (« story 3.1 ») : l'ouvrir pour `premier-admin.ts` seulement ; `comptes-de-test.ts` continue de refuser.
- `scripts/premier-admin.ts`, `scripts/secrets-github.mjs` -- modèles existants (saisie masquée, `gh secret set` sans affichage).
- `lib/server/adresse-ip.ts` -- sur Netlify, seul `x-nf-client-connection-ip` fait foi ; à ne pas modifier.
- `lib/server/empreintes.ts` -- `HMAC_SECRET` obligatoire hors développement.
- `lib/server/emails.ts` -- sans `RESEND_API_KEY` : `cle_absente`, la demande reste enregistrée.
- `next.config.ts` -- bloc `env` existant (Sentry) : y ajouter la version.
- `app/equipe/layout.tsx` -- mise en page de l'espace équipe : pied de page de version.
- `tests/garde-environnement.ts` -- garde des tests, inchangée.
- `docs/exploitation/deploiement.md`, `docs/securite.md`, `docs/protection-des-donnees.md`, `README.md` -- marques « À compléter (story 3.1) ».

## Tasks & Acceptance

**Execution:**
- [x] `netlify.toml` -- build, Node 22.
- [x] `package.json`, `next.config.ts` -- version 1.0.0 injectée au build.
- [x] `app/equipe/layout.tsx` -- « Version v1.0.0 » en bas des pages internes.
- [x] `scripts/charger-environnement.mjs` (nouveau), `scripts/db-push.mjs`, `scripts/commun.ts`, `scripts/premier-admin.ts`, `scripts/secrets-github.mjs` -- mode `--production` fermé par défaut.
- [x] `tests/story-3-1/` -- garde des scripts (matrice), injection de la version, `netlify.toml` (commande de build, aucune variable interdite), pied de page (Playwright).
- [x] `docs/…`, `README.md` -- parties « À compléter (story 3.1) ».
- [x] Guide pas à pas pour Abraham (dans `docs/exploitation/deploiement.md`) : Supabase de production, Netlify, variables par contexte, protection de `main`, étiquette.

**Acceptance Criteria:**
- Given l'adresse Netlify de production, when Abraham l'ouvre, then le formulaire s'affiche en `https://` et il peut y déposer une demande.
- Given une page interne en production, when il regarde en bas, then il lit « Version v1.0.0 », égale à l'étiquette Git.
- Given une demande créée en développement, when il regarde la liste de production, then elle n'y est pas, et aucune donnée `TEST-` n'y figure.
- Given une branche autre que `main` envoyée sur GitHub, when Netlify crée la prévisualisation, then l'anti-spam y fonctionne (6ᵉ envoi refusé).
- Given une fusion vers `main` avec un test rouge, when on essaie de fusionner, then GitHub la refuse.

## Implementation Notes

- La branche contient déjà les stories 3.2, 3.3 et 3.6 (commitées) et est à jour avec `main` (story 2.1). Les tests du navigateur tournent sur le port 3210 (`playwright.config.ts`). Ne jamais lancer de test contre la production ; `.env.scripts-production.local` n'existe pas encore (créé plus tard par Abraham) : les tests des scripts utilisent des fichiers temporaires fictifs.

- 05/11/2026 : base de production prête (migrations appliquées, administrateur créé, secret `PROD_SUPABASE_DB_URL` posé) par Abraham. Code commité avant la mise en ligne ; restent la fusion dans `main`, le site Netlify, l'étiquette `v1.0.0`, la protection de `main` et les vérifications à l'écran.

## Spec Change Log

- 05/11/2026 — relecture (remarque 1) : `.env.production.local` est chargé tout seul par Next.js en mode production ; renommé `.env.scripts-production.local` avec l'accord d'Abraham. État évité : une construction locale embarquant les clés de production. KEEP : lecture du seul fichier de production, refus sans `SUPABASE_ENVIRONNEMENT=production`, `comptes:test` toujours fermé.

## Review Triage Log

| # | Relecteur | Remarque | Verdict | Suite |
|---|---|---|---|---|
| 1 | blind (diff complet) | `.env.production.local` chargé tout seul par `next build`/`next start` | high | Vérifié : une construction locale contenait l'adresse de production (supprimée). intent_gap → Abraham : renommé `.env.scripts-production.local`. |
| 2 | edge, blind | Sans `--production`, des variables du terminal passent la garde | medium | patch : vider les variables du projet avant chargement, lire l'environnement dans le fichier. |
| 3 | edge, blind | En production, seules 5 variables sont vidées (`SUPABASE_*` de la CLI, HMAC…) | medium | patch. |
| 4 | blind | `chargerEnvironnement` autorise la production par défaut | medium | patch : fermé par défaut, ouverture explicite. |
| 5 | blind | `npm run db:push --production` (sans `--`) vise le développement | medium | patch : refus si `npm_config_production`. |
| 6 | edge, blind | `--production=…`, `--prod` ignorés en silence | low | patch : refus. |
| 7 | blind | BOM écrit comme caractère invisible ; pas de test | low | patch : `﻿` et test. |
| 8 | blind | Variables obligatoires vides acceptées en production | medium | patch. |
| 9 | blind | Tests liés à `1.0.0` | medium | patch : forme semver + égalité avec le pied de page. |
| 10 | blind | `package.json` lu via `process.cwd()` ; pied de page vide sans variable | low | patch. |
| 11 | blind | Rien n'empêche une prévisualisation réglée sur la production | medium | patch : garde au build Netlify selon `CONTEXT`. |
| 12 | gap | Correspondance des secrets de `secrets:github` non testée | high | patch : fonction pure testée. |
| 13 | gap | `db:push --production` : URL et arguments non testés | medium | defer (CLI résolue par `require.resolve`). |
| 14 | blind | Guide : Site URL / Redirect URLs de Supabase Auth absents | medium | patch (doc). |
| 15 | blind | Demande de contrôle en production non définie | low | patch (doc). |
| 16 | blind | Protection des données : ligne Sentry périmée, région des fonctions Netlify | medium | patch (doc). |
| 17 | blind | Prévisualisations publiques ; `HMAC_SECRET` absent → anti-spam faussé | medium | patch (doc + vérification de l'étape 4). |
| 18 | blind | Version visible seulement après connexion (retour arrière) | low | patch (doc 3.5). |
| 19 | blind | Pas de contrôle « version = étiquette » en CI | low | defer. |
| 20 | blind | Tests qui lisent le texte (TOML, JSX) | low | Rejeté : couverts aussi par le test du navigateur ; simple à adapter. |
| 21 | blind | Node non épinglé en local | false | `package.json` a déjà `engines.node >=22.18`. |
| 22 | blind | Assistants de test dupliqués | low | Rejeté. |

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- verts (développement seulement).
- `npm audit --omit=dev` -- aucune faille high/critical.

**Manual checks (if no CLI):**
- Par Abraham : les quatre critères d'acceptation ci-dessus, en production et sur une prévisualisation.
