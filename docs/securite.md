# Sécurité

## Accès à l'application

- **Deux rôles** : collaborateur et administrateur. Le rôle de chaque personne est lu dans la table `membres` de la base, à chaque action ; il n'est pas stocké dans le navigateur.
- **L'espace équipe (`/equipe`) est protégé** : sans connexion, toute page de `/equipe` renvoie vers la page de connexion. Un compte qui n'est pas actif est refusé. La zone `/equipe/admin` est réservée aux administrateurs.
- **Les droits sont vérifiés là où sont les données** (dans la base et sur le serveur), pas seulement en cachant un bouton. Des tests automatiques essaient les accès interdits à chaque demande de fusion (*pull request*) et à chaque envoi sur `main`.
- **Pas d'inscription libre** : personne ne peut se créer un compte seul. Les inscriptions sont désactivées dans Supabase. Aujourd'hui, les comptes sont créés par le responsable technique avec le script `npm run admin:creer`. L'écran de création de compte par un administrateur : À compléter (story 4.1).
- Un visiteur non connecté peut seulement **déposer** une demande ; il ne peut rien lire.

## Secrets

Un secret est une clé, un mot de passe ou une adresse de connexion qui donne accès à un service. **Aucun secret n'est écrit dans le code ni dans le dépôt Git** (le dépôt est public).

| Où | Ce qu'on y trouve |
|---|---|
| `.env.local` (sur le poste de développement) | Les clés du projet de **développement**. Ce fichier est exclu de Git (règle `.env*` dans `.gitignore`). Le modèle sans valeurs est [`.env.example`](../.env.example). |
| Secrets GitHub (*Settings → Secrets and variables → Actions*) | `DEV_SUPABASE_URL`, `DEV_SUPABASE_PUBLISHABLE_KEY`, `DEV_SUPABASE_SECRET_KEY`, `DEV_SUPABASE_DB_URL` (envoyés par `npm run secrets:github`), `SAUVEGARDE_PHRASE` (phrase de chiffrement des sauvegardes), et `PROD_SUPABASE_DB_URL` à créer à la story 3.1. Une fois enregistrés, ils ne peuvent plus être relus. |
| Variables Netlify | Les clés de **production** (liste dans [deploiement.md](exploitation/deploiement.md#variables-denvironnement)), dont `SENTRY_AUTH_TOKEN`. À compléter (story 3.1). |
| Fichier `Documents\nova-phrase-sauvegardes.txt` d'Abraham et sa copie de secours | La phrase de chiffrement des sauvegardes. Sans elle, aucune sauvegarde ne peut être relue. |

- **Recherche automatique de secrets** : à chaque demande de fusion et à chaque envoi sur `main`, la tâche « Tests » lance gitleaks sur tout l'historique Git. Si elle trouve un secret, la tâche est rouge et on ne fusionne pas.
- Les clés secrètes (Supabase, Resend, HMAC) ne sont lues que par le serveur, jamais par le navigateur.

## Mots de passe

- Chaque personne **saisit elle-même** son mot de passe. Aujourd'hui, le premier administrateur l'a saisi lui-même dans `npm run admin:creer`. Choix du mot de passe à l'invitation et lien « mot de passe oublié » : À compléter (stories 4.1 et 4.3). L'administrateur ne le verra et ne le saisira jamais.
- Un mot de passe n'est **jamais** écrit dans le code, dans un fichier du dépôt, dans un email, ni dans une conversation avec l'IA.
- Les comptes de test du développement ont des mots de passe tirés au hasard par `npm run comptes:test`, écrits seulement dans `.env.local`.

## Suivi des erreurs

À compléter (story 3.3) : Sentry, région UE, sans aucune donnée personnelle ; où consulter les erreurs ; alerte par email.

## Si un secret a fuité

Un secret a fuité dès qu'il a été écrit dans un commit, collé dans un message, montré à l'écran pendant une présentation, ou envoyé à la mauvaise personne. C'est une faille : niveau 2, par téléphone (voir [support.md](support.md)).

1. **Changez le secret à sa source**, tout de suite :
   - clé Supabase : tableau de bord Supabase → *Project Settings → API Keys*, créez une nouvelle clé et supprimez l'ancienne ;
   - mot de passe de la base : Supabase → *Database → Reset database password*. Il fait partie des adresses `SUPABASE_DB_URL`, `DEV_SUPABASE_DB_URL` et `PROD_SUPABASE_DB_URL` : voir l'étape 2 ;
   - clé Resend : tableau de bord Resend, nouvelle clé puis suppression de l'ancienne ;
   - Sentry : nouveau `SENTRY_AUTH_TOKEN` dans Sentry, puis suppression de l'ancien ; pour le DSN (`NEXT_PUBLIC_SENTRY_DSN`), nouvelle clé client du projet et désactivation de l'ancienne ;
   - `HMAC_SECRET` : nouvelle valeur au hasard. **Attention** : les empreintes déjà enregistrées ne correspondent plus. Les compteurs de l'anti-spam et des tentatives de connexion repartent donc de zéro ;
   - phrase de sauvegarde : voir plus bas.
2. **Mettez à jour partout où il est utilisé** :
   - `.env.local` sur chaque poste de développement ;
   - les secrets GitHub : `npm run secrets:github` envoie seulement les quatre secrets `DEV_*`, depuis `.env.local`. `PROD_SUPABASE_DB_URL` se met à jour à la main (*Settings → Secrets and variables → Actions*, ou `gh secret set PROD_SUPABASE_DB_URL`) ;
   - les variables Netlify, puis relancez une mise en ligne pour qu'elles soient prises en compte.
3. **Vérifiez** : la tâche « Tests » et la « Sauvegarde nocturne » lancée à la main sont vertes, le site fonctionne.
4. **Si le secret était dans un commit** : le changer suffit, car l'ancien ne sert plus à rien. Ne cherchez pas à réécrire l'historique Git. Mais gitleaks continuera de le trouver, et « Tests » restera rouge, ce qui bloque toutes les fusions. **Une fois le secret révoqué, et seulement à ce moment-là**, ajoutez ce signalement précis à la liste des exceptions de `.gitleaks.toml`, avec une phrase qui explique pourquoi.
5. **Notez l'incident** : date, secret concerné (son nom, jamais sa valeur), ce qui a été fait.

### Si la phrase de sauvegarde a fuité

Les sauvegardes déjà conservées sont lisibles par quiconque a la phrase : elles contiennent des données personnelles.

1. Supprimez **toutes** les sauvegardes existantes : onglet *Actions* → « Sauvegarde nocturne » → chaque exécution → rubrique *Artifacts* → icône de corbeille sur chaque fichier `sauvegarde-*`.
2. Créez une nouvelle phrase (32 caractères au moins, sur une seule ligne), rangez-la au même endroit que l'ancienne, à sa place, et enregistrez-la sur GitHub dans une fenêtre PowerShell séparée : `gh secret set SAUVEGARDE_PHRASE`.
3. Lancez tout de suite une sauvegarde à la main et vérifiez qu'elle est verte.
4. Suivez aussi la section suivante : c'est une possible violation de données personnelles.

## Violation de données personnelles

Il y a violation quand des données personnelles (demandeurs ou équipe) ont pu être vues, copiées, modifiées ou perdues par erreur ou par une attaque : secret ou sauvegarde qui a fuité, faille d'accès, perte de données. Le RGPD (articles 33 et 34) impose :

1. **Évaluer** : quelles données ont pu être exposées, combien de personnes, pendant combien de temps, et quel risque pour elles.
2. **Prévenir la CNIL sous 72 heures** après la découverte, s'il y a un risque pour les personnes (sur le site de la CNIL, notification de violation).
3. **Prévenir les personnes concernées** si le risque est élevé, en termes simples : ce qui s'est passé, ce qui a été fait, ce qu'elles peuvent faire.
4. **Noter l'incident dans le registre des violations**, même si on ne prévient pas la CNIL : date, faits, données concernées, conséquences, mesures prises. Où se trouve ce registre : À compléter (fin de projet).
