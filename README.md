# Nova Services

Application de gestion des demandes clients de Nova Services : les clients déposent leur demande en ligne, sans compte, et l'équipe les suit dans un espace sécurisé. Projet de formation, avec des données fictives.

Stack : Next.js 16, React 19, TypeScript, Supabase (région Paris), Tailwind CSS, shadcn/ui, Vitest, Playwright.

La méthode et les documents de conception (PRD, UX, architecture, epics) sont dans [`_bmad-output/planning-artifacts/`](_bmad-output/planning-artifacts/).

## Installation

1. Copier `.env.example` en `.env.local`, puis y saisir les valeurs du projet Supabase de **développement** (avec `SUPABASE_ENVIRONNEMENT=developpement`).
2. Installer les dépendances : `npm install`
3. Appliquer les migrations sur la base de développement : `npm run db:push`
4. Lancer les tests : `npm test`
5. Lancer les tests des parcours et de l'accessibilité : `npm run test:e2e`
6. Démarrer l'application : `npm run dev`, puis ouvrir http://localhost:3000

`.env.local` contient les clés : il n'est **jamais** versionné.

## Données d'essai (développement seulement)

- `npm run donnees:remplir` : charge environ 40 demandes d'essai (objet « TEST-… »), en remplaçant les précédentes. Chaque remplissage consomme de vrais numéros de référence : des trous dans la numérotation sont normaux.
- `npm run donnees:vider` : supprime les demandes dont l'objet ou le nom commence par « TEST- », avec leur historique. Il supprime aussi celles créées par des tests en cours : ne pas le lancer pendant les tests.

Les deux commandes refusent de tourner si `SUPABASE_ENVIRONNEMENT` ne vaut pas `developpement`. Les comptes de test (`npm run comptes:test`) doivent exister.
