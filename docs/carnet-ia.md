# Carnet d'usage de l'IA

Une ligne par story : ce que l'IA (Claude Code, méthode BMAD) a produit, et ce qu'Abraham a vérifié lui-même avant de valider. Les incidents notables (erreurs de l'IA ou des outils, corrections) sont détaillés sous le tableau.

| Story | Ce que l'IA a produit | Ce qu'Abraham a vérifié |
|---|---|---|
| 1.1 — Installer le socle du projet | Projet Next.js 16.4 + shadcn (base Radix) aux couleurs de DESIGN.md et police Inter ; page provisoire « Nova Services » ; migration `20261103000001_verrouillage_droits.sql` (retrait des droits par défaut, schéma `prive`) ; utilitaires `lib/server/appeler.ts`, `lib/domaine.ts`, `lib/erreurs.ts`, `lib/format.ts`, clients Supabase serveur et service ; tests Vitest (format, appel des fonctions, garde-fou d'environnement, droits de `anon`) et Playwright + axe ; tâche GitHub « Tests » avec gitleaks ; `.env.example` ; script `secrets-github.mjs`. Relecture BMAD par 3 relecteurs : 8 corrections appliquées, 3 points reportés. | Projet Supabase `nova-dev` créé lui-même (Irlande, UE) et clés collées lui-même dans `.env.local`, jamais dans le chat. Page vue dans le navigateur : « Nova Services » en bleu marine, police Inter. Message d'erreur d'hydratation observé, expliqué (extension de navigateur), non lié au code. `.env.example` sans valeurs, `.env.local` exclu de Git. Secrets GitHub envoyés lui-même avec `npm run secrets:github`. Tâche « Tests » verte sur GitHub (après les incidents 1 à 3). |

## Incidents et vérifications notables

### Story 1.1

1. **Région du projet Supabase.** L'architecture prévoyait Paris (`eu-west-3`) ; le projet a été créé en Irlande (`eu-west-1`). L'écart a été repéré en vérifiant les réglages. Décision d'Abraham : garder l'Irlande (Union européenne, RGPD identique) ; l'architecture a été mise à jour.
2. **Recherche de secrets en échec au premier envoi.** L'action GitHub officielle de gitleaks a planté sur le tout premier envoi du dépôt (elle cherche le parent du premier commit, qui n'existe pas). Le journal indiquait pourtant « no leaks found ». Correction : lancer directement le programme gitleaks sur tout l'historique.
3. **Faux positif de la recherche de secrets.** gitleaks a signalé une « clé » dans `_bmad/_config/files-manifest.csv`. Vérification de la ligne : c'était l'empreinte SHA-256 du fichier BMAD `key-screens.md` (le mot « key » a trompé la règle). Exception limitée à ce seul fichier, documentée dans `.gitleaks.toml` ; toutes les autres règles restent actives.
4. **Relecture du code.** Un relecteur affirmait que l'outil `cn` venait d'un paquet npm inconnu. Vérification (`npm view cn`) : c'est le paquet officiel de shadcn ; remarque écartée. Un autre a trouvé que la commande d'envoi des migrations pouvait viser n'importe quelle base : garde-fou ajouté (refus hors développement).
5. **Erreur affichée dans le navigateur.** Un message « hydration » est apparu en mode développement. Les attributs en cause (`bis_skin_checked`, `bis_register`) sont ajoutés par une extension de sécurité du navigateur, pas par l'application ; aucune correction de code.
