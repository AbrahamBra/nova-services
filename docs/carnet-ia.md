# Carnet d'usage de l'IA

Une ligne par story : ce que l'IA (Claude Code, méthode BMAD) a produit, et ce qu'Abraham a vérifié lui-même avant de valider.

| Story | Ce que l'IA a produit | Ce qu'Abraham a vérifié |
|---|---|---|
| 1.1 — Installer le socle du projet | Projet Next.js 16.4 + shadcn (base Radix) aux couleurs de DESIGN.md et police Inter ; page provisoire « Nova Services » ; migration `20261103000001_verrouillage_droits.sql` (retrait des droits par défaut, schéma `prive`) ; utilitaires `lib/server/appeler.ts`, `lib/domaine.ts`, `lib/erreurs.ts`, `lib/format.ts`, clients Supabase serveur et service ; tests Vitest (format, appel des fonctions, garde-fou d'environnement, droits de `anon`) et Playwright + axe ; tâche GitHub « Tests » avec gitleaks ; `.env.example`. | _À compléter par Abraham : aperçu de la page, `.env.local` rempli, `npm run db:push` et `npm test` verts sur `nova-dev`, liste des fichiers versionnés._ |
