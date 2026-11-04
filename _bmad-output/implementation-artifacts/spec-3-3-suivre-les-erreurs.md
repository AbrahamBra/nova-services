---
title: 'Story 3.3 — Suivre les erreurs de l''application (Sentry)'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '426638bcc82f4ecf82ecca2e7ff84686d52d4a92'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/node_modules/next/dist/docs/01-app/02-guides/instrumentation.md'
  - '{project-root}/node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** quand une erreur imprévue se produit, personne n'est prévenu : elle ne laisse qu'une ligne dans la console du serveur.

**Approach :** brancher `@sentry/nextjs` 11.10 (organisation Sentry d'Abraham, région UE) côté serveur et côté navigateur, avec la configuration de l'AD-14 rassemblée dans un seul fichier testé. Ajouter une page de test réservée à l'administrateur qui provoque une erreur volontaire. La production n'existant pas encore (story 3.1), l'essai à l'écran se fait sur le serveur de développement ; il sera refait en production en 3.1.

## Boundaries & Constraints

**Always :**
- Options communes dans `lib/sentry/options.ts` (importées par le serveur, l'edge et le navigateur) : `dataCollection: { userInfo: false, cookies: false, httpBodies: [] }`, `sendDefaultPii: false`, aucune intégration Replay, pas de suivi des performances (`tracesSampleRate: 0`), `environment` = `SUPABASE_ENVIRONNEMENT` (ou `NEXT_PUBLIC_…` côté navigateur), `release` = `NEXT_PUBLIC_APP_VERSION` si présente.
- `beforeSend` (et `beforeSendTransaction` par prudence) : retire `event.user`, `request.data`, `request.cookies`, `request.headers` (ils contiennent l'IP : `x-nf-client-connection-ip`, `x-forwarded-for`), `request.query_string`, et coupe tout ce qui suit `?` ou `#` dans `request.url`. `beforeBreadcrumb` coupe aussi les paramètres des adresses des fils d'Ariane (navigation, fetch).
- Aucun appel à `setUser` dans le code (vérifié par le test).
- Sentry ne s'active que si `NEXT_PUBLIC_SENTRY_DSN` est rempli ; sans DSN, l'application et les tests fonctionnent comme avant.
- **Décision d'Abraham (Q1) :** Sentry est actif aussi en développement dès que le DSN est dans `.env.local` ; les erreurs y sont marquées `developpement`. Spec gardée entière (≈ 1 900 tokens) : un seul réglage, non divisible.
- `lib/server/appeler.ts` : une erreur imprévue envoie à Sentry un message avec seulement le nom de la fonction et le code Postgres (jamais les paramètres ni le texte de l'erreur), comme la ligne de console actuelle.
- Page `/equipe/admin/test-erreur` : protégée par `app/equipe/admin/layout.tsx` et revérifiée dans la page et dans son action serveur (AD-1, via `lireProfil`). Un bouton « Provoquer une erreur de test » lance une action qui lève `Error("Erreur de test Sentry (volontaire)")`, capturée automatiquement ; l'écran affiche ensuite « L'erreur de test a été envoyée au suivi des erreurs. » avec un bouton « Réessayer ». Un collaborateur voit « Vous n'avez pas accès à cette page. ».
- Lien vers cette page depuis l'accueil de l'administration (`app/equipe/admin/page.tsx`), pas depuis le menu.
- `.env.example` : ajouter `SENTRY_ORG`, `SENTRY_PROJECT` (sans valeur) à côté de `NEXT_PUBLIC_SENTRY_DSN` et `SENTRY_AUTH_TOKEN`. Envoi des cartes du code source à Sentry seulement si `SENTRY_AUTH_TOKEN` est présent (Netlify, story 3.1) ; jamais en local.
- Abraham crée lui-même le compte, l'organisation (région UE, « Data Storage Location : European Union »), le projet Next.js, l'alerte email « nouvelle erreur », active « Prevent Storing of IP Addresses » et colle le DSN dans `.env.local`. L'IA le guide pas à pas et ne manipule aucune clé.

**Never :**
- Pas de Session Replay, pas de profilage, pas de journaux Sentry (`enableLogs`), pas de tunnel, pas de `setUser`, pas de contexte utilisateur ni de nom, email, téléphone, texte de formulaire ou IP envoyés.
- Pas de modification de `components/nova/menu-equipe.tsx`, `lib/actions/`, `lib/schemas/`, `app/equipe/demandes/`, `tests/securite/`, ni de migration.
- Pas de variables Netlify maintenant (story 3.1).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Erreur de test | Admin, DSN rempli, clic sur le bouton | Erreur visible dans Sentry (< 5 min), environnement `developpement`, sans utilisateur ni IP ; écran de confirmation | — |
| Sans DSN | DSN vide, clic sur le bouton | Même écran ; rien n'est envoyé, aucune exception ailleurs | — |
| Collaborateur | Collaborateur actif sur `/equipe/admin/test-erreur` | « Vous n'avez pas accès à cette page. » | — |
| Action appelée directement | Collaborateur qui déclenche l'action | Refus, aucune erreur envoyée | — |
| Événement avec données | `request.data`, cookies, en-têtes, `?email=…` dans l'adresse | Tout est retiré par `beforeSend` | — |
| Erreur Postgres imprévue | `appeler()` reçoit un code inconnu | Message Sentry « fonction=… code=… » seulement | — |

</frozen-after-approval>

## Code Map

- `lib/session.ts` -- `lireProfil()` (cache par requête) : à réutiliser pour la page et l'action ; ne pas modifier.
- `app/equipe/admin/layout.tsx`, `components/nova/acces-refuse.tsx` -- garde administrateur et message de refus : à réutiliser.
- `app/equipe/admin/page.tsx` -- y ajouter seulement un lien vers la page de test.
- `components/nova/bouton.tsx`, `components/nova/reessayer.tsx` -- boutons existants à réutiliser.
- `lib/server/appeler.ts` -- remplacer le commentaire « story dédiée » par l'envoi à Sentry.
- `next.config.ts` -- envelopper avec `withSentryConfig` ; garder `devIndicators: false` et la règle Turbopack CSS.
- `.env.example` -- section Sentry existante à compléter.
- `tests/outils/comptes.ts` -- comptes `TEST-…` jetables pour l'essai Playwright collaborateur / admin.
- `tests/story-1-4/connexion.spec.ts` -- modèle de test Playwright (connexion, `verifierEnvironnement`, nettoyage).

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- ajouter `@sentry/nextjs` `~11.10.0` -- version imposée par l'architecture.
- [x] `lib/sentry/options.ts` -- options communes + `nettoyerEvenement` / `nettoyerFilAriane` -- un seul endroit, testable.
- [x] `instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation-client.ts` -- `Sentry.init` avec ces options ; `onRequestError` exporté.
- [x] `next.config.ts` -- `withSentryConfig` (silencieux, envoi des cartes seulement avec jeton).
- [x] `lib/server/appeler.ts` -- `captureMessage` sur erreur imprévue.
- [x] `app/equipe/admin/test-erreur/page.tsx`, `actions.ts`, `error.tsx` -- page, action revérifiant le rôle, écran après erreur.
- [x] `app/equipe/admin/page.tsx` -- lien « Page de test du suivi des erreurs ».
- [x] `.env.example` -- `SENTRY_ORG`, `SENTRY_PROJECT`.
- [x] `tests/story-3-3/options-sentry.test.ts` -- options AD-14 et nettoyage (matrice) ; aucun `setUser`/`replayIntegration` dans le code.
- [x] `tests/story-3-3/test-erreur.spec.ts` -- collaborateur refusé, admin voit l'écran de confirmation.

**Acceptance Criteria:**
- Given l'organisation Sentry UE et le DSN dans `.env.local`, when Abraham clique « Provoquer une erreur de test », then l'erreur apparaît dans Sentry en moins de 5 minutes et il reçoit un email d'alerte.
- Given cette erreur dans Sentry, when il l'ouvre, then il n'y voit ni nom, ni email, ni téléphone, ni texte de formulaire, ni adresse IP.
- Given un collaborateur connecté, when il ouvre `/equipe/admin/test-erreur`, then l'accès est refusé.

## Implementation Notes

**Story mise en pause puis reprise le même jour (2026-11-04, décision d'Abraham relayée par la session principale : « on fera plus tard sentry ») :**
- Construit (non commité, dans le dossier de travail de la branche) : `lib/sentry/options.ts`, `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `next.config.ts` (`withSentryConfig`), `lib/server/appeler.ts`, `lib/erreurs.ts`, `app/equipe/admin/test-erreur/` (page, action, formulaire, écran d'erreur), lien dans `app/equipe/admin/page.tsx`, `.env.example`, `tests/story-3-3/`. Lint, typage et `tests/story-3-3/options-sentry.test.ts` verts sans DSN (Sentry désactivé quand `NEXT_PUBLIC_SENTRY_DSN` est vide).
- 2026-11-04 : `tests/story-3-3/test-erreur.spec.ts` vert (4/4) sans DSN, sur le port 3133 (`PORT_E2E`, ajouté à `playwright.config.ts` car le port 3000 est pris par le serveur du dossier principal).
- Reste à faire à la reprise : (1) relire le diff contre les tâches (l'agent de construction s'est arrêté au milieu, sans rapport final) ; (2) Abraham crée le compte Sentry (région UE, projet Next.js, alerte « every new issue », « Prevent Storing of IP Addresses ») et colle le DSN dans `.env.local` ; (3) suite complète des tests ; (4) relecture BMAD (3 relecteurs) ; (5) vérification à l'écran : erreur de test visible dans Sentry < 5 min, email reçu, aucune donnée personnelle ni IP ; (6) commit ; ligne du carnet IA.

- Reprise (2026-11-04) : compte Sentry créé par Abraham (région UE), DSN dans `.env.local`, suite complète verte avec Sentry actif (348 Vitest, 77 Playwright), relecture BMAD faite, vérification à l'écran faite par Abraham.

## Spec Change Log

## Review Triage Log

| # | Relecteur | Remarque | Verdict | Suite |
|---|---|---|---|---|
| 1 | blind, edge | Texte des erreurs, `message`, fils d'Ariane de la console, `extra`, `request.env`, `server_name` non nettoyés | high | Réel : `onRequestError` envoie le message brut ; patch (masquage emails/téléphones, suppressions). |
| 2 | edge | Clés `url.query` / `url.fragment` des fils d'Ariane Node | medium | patch. |
| 3 | edge | Environnement vide → Sentry étiquette « production » | medium | patch : « inconnu ». |
| 4 | gap | Câblage de l'environnement côté navigateur non testé | medium | patch : test. |
| 5 | blind | Types importés de `@sentry/core`, non déclaré | low | patch (import depuis `@sentry/nextjs`). |
| 6 | edge | `captureMessage` pourrait lever dans `appeler()` | low | patch (`try/catch`, une ligne). |
| 7 | blind, edge | Écran d'erreur : affirme l'envoi même sans DSN, ou pour une autre erreur | low | Phrase figée par l'intention ; patch partiel : référence (`digest`) affichée pour retrouver l'événement. |
| 8 | blind, edge | Page blanche si le profil est illisible | false | `app/equipe/layout.tsx` affiche déjà le bandeau d'erreur et ne rend pas la page dans ce cas. |
| 9 | blind | Pas de `flush` sur les fonctions Netlify | maybe-false | defer : à vérifier en production (story 3.1), délai < 5 min. |
| 10 | blind, edge | Nom de version et nettoyage des cartes du code source après envoi ; org/projet vides | medium | defer : ne joue qu'au build Netlify (story 3.1). |
| 11 | blind | Erreur de test comptée deux fois (serveur + navigateur) | maybe-false | Vérification à l'écran : un seul événement attendu ; defer si doublon. |
| 12 | blind | Le test du navigateur pourrait être gêné par la fenêtre d'erreur de Next en dev | false | Test vert 4/4 en dev. |
| 13 | blind | « Prevent Storing of IP Addresses » non documenté | false | Activé par Abraham (organisation) le 04/11/2026 ; noté dans la spec et la doc sécurité. |
| 14 | gap | Autres `console.error` (session, lectures) jamais envoyés à Sentry | medium | defer : hors de la liste de la spec (et `lib/actions/` interdit ici) ; exporter `signaler` et l'utiliser ensuite. |

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert.

**Manual checks (if no CLI):**
- Dans Sentry : l'événement de test, onglets « User », « Request », « Tags » sans donnée personnelle ni IP.
