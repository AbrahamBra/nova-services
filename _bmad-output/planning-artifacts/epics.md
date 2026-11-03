---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - prds/prd-coursenia-2026-11-03/prd.md
  - ux-designs/ux-coursenia-2026-11-03/DESIGN.md
  - ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md
  - architecture/architecture-coursenia-2026-11-03/architecture.md
---

# Nova Services — Epics et stories

## Présentation

Ce document découpe le projet en **epics** (grands lots utiles à quelqu'un) et en **stories** (petits morceaux construits et vérifiés en une fois). Il part du [PRD](prds/prd-coursenia-2026-11-03/prd.md), de l'UX ([DESIGN.md](ux-designs/ux-coursenia-2026-11-03/DESIGN.md), [EXPERIENCE.md](ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md)) et de l'[architecture](architecture/architecture-coursenia-2026-11-03/architecture.md), validés le 03/11/2026. Il a été vérifié « prêt pour la construction » ([rapport](readiness-report.md)), puis corrigé avec l'accord d'Abraham.

**Le plus important pour Abraham :** recevoir les demandes et les voir toutes au même endroit, avec leur statut. C'est l'epic 1.

**Les stories sont numérotées dans l'ordre de construction**, du plus utile au moins utile : la story 1.3 est la troisième à construire, la 2.1 vient juste après la 1.9.

**Comment lire une story :**
- **Critères d'acceptation** (2 à 4) : ce qu'Abraham vérifie lui-même **à l'écran**, au format « Étant donné… Quand… Alors… ».
- **Vérifications automatiques** : les règles invisibles à l'écran (droits côté serveur, absence de doublon…), prouvées par des tests.
- **Exigences** : les numéros du PRD, de l'UX et de l'architecture que la story réalise.
- **À créer** : ce que la story ajoute. Une story ne crée que ce dont elle a besoin.

**Règles communes à toutes les stories :**
1. Une story ne dépend que des stories **précédentes**.
2. Elle est terminée quand ses critères sont vérifiés à l'écran, que **tous** les tests du projet passent et qu'elle est enregistrée dans Git avec un message clair (séquence 7).
3. Une ligne est ajoutée au **carnet d'usage de l'IA** (`docs/carnet-ia.md`) : ce que l'IA a produit, ce qu'Abraham a vérifié ou corrigé.
4. Une story qui crée une table ou un état nouveau complète les **données d'essai** (`supabase/seed.sql`, story 1.5), pour que ses critères soient vérifiables.
5. Les tests n'utilisent que des comptes et des données préfixés `TEST-`, jamais le compte d'Abraham, et ne visent jamais la production (AD-27).
6. Chaque écran passe le contrôle automatique d'accessibilité (NFR-6, UX-DR9).

## Inventaire des exigences

### Exigences fonctionnelles (PRD)

- FR-1 : formulaire de dépôt public sans compte
- FR-2 : enregistrement, référence `NOVA-AAAA-NNNN`, écran de confirmation
- FR-3 : email de confirmation (mode démonstration)
- FR-4 : information et consentement
- FR-5 : protection contre les envois en masse
- FR-6 : connexion sécurisée
- FR-7 : mot de passe oublié (lien valable 24 h)
- FR-8 : création de compte par invitation (lien valable 24 h)
- FR-9 : modifier, désactiver, réactiver un compte
- FR-10 : droits collaborateur / administrateur
- FR-11 : liste des demandes
- FR-12 : recherche et filtres
- FR-13 : détail d'une demande
- FR-14 : prise en charge, attribution, libération
- FR-15 : changement de statut, classement sans suite
- FR-16 : priorité
- FR-17 : notes internes
- FR-18 : historique
- FR-19 : tableau de bord et compteur
- FR-20 : catégories
- FR-21 : paramètres généraux
- FR-22 : effacement des données d'un demandeur
- FR-23 : suggestion par l'IA (après le MVP)
- FR-24 : purge des demandes expirées
- FR-25 : saisie d'une demande par l'équipe
- FR-26 : consultation du journal

### Exigences de qualité et d'exploitation (PRD)

- NFR-1 : droits vérifiés côté serveur et dans la base
- NFR-2 : aucun secret dans le code
- NFR-3 : environnements séparés, production en ligne en HTTPS
- NFR-4 : versions identifiables
- NFR-5 : retour arrière testé
- NFR-6 : accessibilité de base
- NFR-7 : liste en moins de 2 s avec 2 000 demandes
- NFR-8 : tests verts avant chaque commit et mise en ligne
- NFR-9 : sécurité de base (mots de passe, blocage, session, longueurs, textes inertes, dépendances)
- OPS-1 : suivi des erreurs
- OPS-2 : journal des événements importants
- OPS-3 : sauvegarde quotidienne
- OPS-4 : restauration réellement testée
- OPS-5 : fiche d'indisponibilité
- OPS-6 : support en deux niveaux
- OPS-7 : documentation synthétique et carnet d'usage de l'IA

### Exigences issues de l'architecture

- **Démarrage (story 1.1) :**
  - `npx create-next-app@16.4 … --yes --no-cache-components`, puis `npx shadcn@4.23 init --base radix` ;
  - dépôt GitHub public, projet Supabase de développement en Irlande (UE), lié au projet local (`supabase link`) ;
  - fichiers `.env.example` et `.env.local` ;
  - tests et recherche de secrets lancés sur GitHub dès le départ.
- **Sécurité de la base :**
  - droits par défaut retirés à `anon`, `authenticated` et `public` (AD-2) ;
  - fonctions SQL verrouillées, chaque droit d'exécution accordé nominativement (AD-15) ;
  - utilitaires dans le schéma `prive`.
- **Chemins uniques :**
  - toute écriture passe par une fonction SQL (AD-4) ;
  - résultats `{ ok, … }` et `lib/server/appeler.ts` (AD-7, AD-20) ;
  - codes et libellés dans `lib/domaine.ts` (AD-18, AD-19) ;
  - dates via `lib/format.ts` (AD-24) ;
  - filtres via `lib/filtres.ts` (AD-25).
- **Variables d'environnement :**
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL` ;
  - `RESEND_API_KEY`, `EMAILS_AUTORISES`, `HMAC_SECRET` ;
  - variables Sentry ; `NEXT_PUBLIC_APP_VERSION` injectée au build.
  - Elles sont toutes listées dans `.env.example`, sans valeur (AD-9).
- **Emails :** Resend sans domaine, mode démonstration ; Supabase Auth n'envoie aucun email (AD-13).
- **Données :**
  - catégories et paramètres créés par migration (AD-27) ;
  - comptes créés via `creer_membre`, y compris par les scripts (AD-17) ;
  - données d'essai `TEST-` en développement uniquement.
- **Exploitation :**
  - Netlify Free (10 mises en ligne par mois au maximum), `main` protégée, étiquettes `vX.Y.Z` (AD-11) ;
  - sauvegarde, réveil, nettoyages et restauration de test dans GitHub Actions (AD-12, AD-23) ;
  - Sentry en région UE, sans données personnelles (AD-14).

### Exigences issues de l'UX

- UX-DR1 : couleurs, polices et formes de DESIGN.md (bleu marine `#1E3A8A`, Inter, coins 6 et 8 px) comme réglages Tailwind et shadcn.
- UX-DR2 : badges de statut (pilules bleu, orange, vert) et de priorité (Haute en rouge), toujours avec le mot.
- UX-DR3 : menu latéral (rubriques existantes seulement, groupe Administration pour les admins, compteur, nom et rôle, déconnexion) ; version en bas des pages internes ; menu replié sous 1 024 px.
- UX-DR4 : états communs : squelettes, bandeau « Le serveur ne répond pas » avec « Réessayer », « accès refusé », « introuvable ».
- UX-DR5 : messages brefs (toasts) après chaque action, erreurs persistantes.
- UX-DR6 : fenêtre de confirmation des actions destructrices (« Annuler » sélectionné par défaut).
- UX-DR7 : formulaires : erreurs sous le champ, focus sur le premier champ en erreur, saisie conservée, « Envoi en cours… ».
- UX-DR8 : liste en tableau sur ordinateur, réduite sur tablette, en cartes sur téléphone ; détail en deux colonnes, une sur téléphone.
- UX-DR9 : accessibilité : focus visible, libellés visibles, erreurs annoncées (`aria-live`), zones de 44 px, focus gardé dans les fenêtres, parcours au clavier.
- UX-DR10 : ton : vouvoiement, messages d'EXPERIENCE.md §3, dates `03/11/2026 à 09:12`.
- UX-DR11 : composant unique d'affichage de l'historique.

### Correspondance exigences → stories

| Exigence | Stories |
|---|---|
| FR-1 | 1.2, 1.3 |
| FR-2 | 1.3 |
| FR-3 | 1.7 |
| FR-4 | 1.2, 1.3 |
| FR-5 | 1.8 |
| FR-6 | 1.4, 1.9 |
| FR-7 | 4.3 |
| FR-8 | 4.1, 4.4 |
| FR-9 | 4.2 |
| FR-10 | 1.4, puis chaque story d'administration |
| FR-11 | 1.5 |
| FR-12 | 2.5 |
| FR-13 | 1.6 |
| FR-14 | 2.1, 2.7 |
| FR-15 | 2.3 |
| FR-16 | 2.4 |
| FR-17 | 2.2 |
| FR-18 | 1.3, 1.6, puis chaque story de traitement |
| FR-19 | 2.8 |
| FR-20 | 5.2 |
| FR-21 | 5.3 |
| FR-22 | 5.4 |
| FR-23 | 6.1 |
| FR-24 | 5.5 |
| FR-25 | 2.6 |
| FR-26 | 5.1 |
| NFR-1 | 1.1, 1.4, puis chaque story (vérifications automatiques) |
| NFR-2, NFR-8 | 1.1, 3.1 |
| NFR-3, NFR-4 | 3.1 |
| NFR-5 | 3.5 |
| NFR-6 | 1.1, puis chaque story avec un écran |
| NFR-7 | 2.5 |
| NFR-9 | 1.3, 1.6, 1.8, 1.9, 3.1 |
| OPS-1 | 3.3 |
| OPS-2 | 1.7, 1.9, puis chaque story qui écrit au journal ; 5.1 |
| OPS-3 | 3.2 |
| OPS-4 | 3.4 |
| OPS-5, OPS-6 | 3.6 |
| OPS-7 | 1.1 (carnet d'usage de l'IA), 3.6 |

| Exigence UX | Stories |
|---|---|
| UX-DR1 | 1.1, 1.2 |
| UX-DR2 | 1.5 |
| UX-DR3 | 1.4, 2.8, 3.1 (version) |
| UX-DR4 | 1.4, 1.5, 1.6 |
| UX-DR5 | 2.1 |
| UX-DR6 | 2.3, 4.2 |
| UX-DR7 | 1.3 |
| UX-DR8 | 1.5, 1.6 |
| UX-DR9 | 1.3, 1.4, puis chaque écran |
| UX-DR10 | 1.2, 1.3 |
| UX-DR11 | 1.6 |

## Liste des epics, par priorité

| Priorité | Epic | Ce qu'on sait faire à la fin | Stories |
|---|---|---|---|
| 1 — indispensable | **1. Recevoir les demandes et les voir au même endroit** | Un client dépose une demande et reçoit sa référence ; l'équipe se connecte en sécurité, voit toutes les demandes avec leur statut et ouvre le détail | 1.1 à 1.9 |
| 2 — indispensable | **2. Traiter les demandes** | Prendre en charge, noter, changer statut et priorité, rechercher, saisir un appel, libérer ou attribuer, tableau de bord | 2.1 à 2.8 |
| 3 — indispensable (sujet) | **3. Mettre en ligne et assurer le fonctionnement** | Application en ligne, sauvegarde, erreurs suivies, restauration et retour arrière essayés, documentation | 3.1 à 3.6 |
| 4 — indispensable (sujet) | **4. Gérer l'équipe** | Inviter, modifier, désactiver, réactiver, mot de passe oublié, renvoyer ou annuler une invitation | 4.1 à 4.4 |
| 5 — important | **5. Administrer les paramètres et les données** | Journal, catégories, paramètres, effacement RGPD, purge | 5.1 à 5.5 |
| 6 — **peut attendre** | **6. Bonus IA** | L'IA propose une catégorie et une priorité | 6.1 |

**Ce qui peut attendre :**
- l'**epic 6** entier ;
- si le temps manque, dans cet ordre : la story **5.5** (purge des expirées, faite à la main en attendant), puis la story **2.8** (tableau de bord : la liste filtrée suffit pour travailler).

Tout le reste répond directement au sujet.

---

## Epic 1 : Recevoir les demandes et les voir au même endroit

Un client ou un prospect dépose sa demande en ligne et reçoit une référence. L'équipe se connecte à un espace sécurisé, voit toutes les demandes avec leur statut et ouvre leur détail. À la fin de cet epic, l'application remplace déjà les fichiers recopiés à la main.

### Story 1.1 : Installer le socle du projet

En tant que **responsable technique de Nova Services**,
je veux **un projet installé, enregistré sur GitHub, testé et protégé dès le premier jour**,
pour **construire chaque fonction sur une base sûre et vérifiable**.

**Critères d'acceptation :**

1. **Étant donné** le projet installé, **quand** je lance `npm run dev` et ouvre `http://localhost:3000`, **alors** une page provisoire « Nova Services » s'affiche en bleu marine, avec la police Inter.
2. **Étant donné** le dépôt GitHub public, **quand** j'ouvre l'onglet « Actions » après le premier envoi, **alors** la tâche « Tests » est verte, ainsi que la recherche de secrets.
3. **Étant donné** le dépôt sur GitHub, **quand** je regarde ses fichiers, **alors** il contient `.env.example` (noms des variables, sans valeur) mais **pas** `.env.local`.
4. **Étant donné** le dossier `docs/`, **quand** j'ouvre `carnet-ia.md`, **alors** il contient une première ligne pour la story 1.1.

**Vérifications automatiques :**
- Le rôle `anon` ne peut lire aucune table ni appeler aucune fonction (AD-2, AD-15).
- La recherche de secrets (gitleaks) ne trouve rien (NFR-2).
- La page provisoire passe le contrôle d'accessibilité (NFR-6).

**Exigences :** NFR-1, NFR-2, NFR-6, NFR-8, OPS-7, UX-DR1, AD-2, AD-9, AD-10, AD-15, AD-27.

**À créer :**
- le projet Next.js et shadcn (base Radix) avec les couleurs et polices de DESIGN.md ;
- le dépôt GitHub (compte d'Abraham) et le projet Supabase de développement en Irlande, UE (créé par Abraham, lié avec `supabase link`) ;
- la migration de verrouillage des droits et le schéma `prive` ;
- les clients Supabase côté serveur, `lib/server/appeler.ts`, `lib/domaine.ts`, `lib/erreurs.ts` et `lib/format.ts` ;
- Vitest et Playwright avec un premier test, la tâche GitHub Actions « Tests » (avec les secrets du projet de développement), gitleaks, `.env.example` et `docs/carnet-ia.md`.

### Story 1.2 : Afficher le formulaire de dépôt

En tant que **client de Nova Services**,
je veux **ouvrir une page claire pour déposer une demande**,
pour **savoir quoi remplir sans avoir à créer de compte**.

**Critères d'acceptation :**

1. **Étant donné** que je ne suis pas connecté, **quand** j'ouvre la page d'accueil, **alors** je vois « Nova Services », le titre « Déposer une demande » et les champs Nom et prénom, Email, Téléphone (facultatif), Société (facultatif), Catégorie, Objet et Description (avec le compteur « 0 / 5 000 »).
2. **Étant donné** la page ouverte, **quand** je déroule « Catégorie », **alors** je vois les 5 catégories de départ.
3. **Étant donné** la page ouverte, **quand** je regarde sous le formulaire, **alors** je lis la phrase sur l'usage des données (« conservées 2 ans ») avec l'email de contact, puis la case de consentement.
4. **Étant donné** un écran de téléphone, **quand** j'ouvre la page, **alors** tout tient sur une colonne, sans défilement horizontal, avec un bouton bleu marine pleine largeur et des champs aux coins arrondis.

**Vérifications automatiques :**
- `infos_publiques()` n'est exécutable que par le serveur (AD-15) ; la page reçoit les catégories et le contact du serveur.
- Accessibilité de la page.

**Exigences :** FR-1 (affichage), FR-4 (mention), UX-DR1, UX-DR10, AD-2, AD-15, AD-27.

**À créer :** les tables `categories` et `parametres` avec leurs données de départ (par migration), la fonction `infos_publiques()` et la page `/`.

### Story 1.3 : Envoyer ma demande et recevoir ma référence

En tant que **client de Nova Services**,
je veux **envoyer ma demande et voir tout de suite qu'elle est enregistrée**,
pour **être sûr qu'elle ne sera pas oubliée**.

**Critères d'acceptation :**

1. **Étant donné** le formulaire bien rempli et la case cochée, **quand** je clique sur « Envoyer ma demande », **alors** le bouton affiche « Envoi en cours… », puis la page « Votre demande a bien été enregistrée. » s'affiche avec une référence `NOVA-2026-…`. Un clic sur « Copier » affiche « Copié ».
2. **Étant donné** une description vide, un email mal écrit et la case non cochée, **quand** j'envoie, **alors** un message s'affiche sous chacun des trois champs, le reste de ma saisie est conservé, et aucune page de confirmation n'apparaît.
3. **Étant donné** la page de confirmation, **quand** je la regarde, **alors** elle n'affiche ni mon nom, ni mon email, ni ma description ; **et** « Déposer une autre demande » me ramène à un formulaire vide.
4. **Étant donné** le clavier seul (touches Tab, Espace, Entrée), **quand** je remplis et envoie le formulaire, **alors** j'arrive à la confirmation sans utiliser la souris, et je vois toujours où est le curseur.

**Vérifications automatiques :**
- La demande est enregistrée avec le canal `formulaire`, le statut `nouvelle`, la priorité `normale`, l'état d'email `en_attente`, sans responsable, et une ligne d'historique `creation`.
- Un double envoi avec la même clé ne crée qu'une demande ; deux envois simultanés reçoivent deux références différentes (AD-6, AD-26).
- `deposer_demande` et `lire_confirmation` ne sont exécutables que par le serveur (AD-15, AD-16).
- Un jeton inconnu ou de plus de 24 h affiche « Cette page n'est plus disponible. ». Une erreur serveur affiche le bandeau « Réessayer », sans perdre la saisie.
- Un texte trop long est refusé ; l'email est enregistré en minuscules (AD-31) ; un texte contenant `<script>` est enregistré tel quel, sans effet.

**Exigences :** FR-1, FR-2, FR-4, FR-18 (création), NFR-9, UX-DR7, UX-DR9, UX-DR10, AD-6, AD-8, AD-16, AD-18, AD-19, AD-22, AD-24, AD-26, AD-31.

**À créer :**
- les tables `demandes`, `compteurs_reference` et `historique`, le déclencheur de dates, et les fonctions `prive.ecrire_historique`, `deposer_demande` et `lire_confirmation` ;
- l'action `deposer` (`lib/actions/demandes.ts`), le schéma Zod du formulaire et la page `/confirmation/[jeton]`.

### Story 1.4 : Me connecter à l'espace équipe

En tant que **membre de l'équipe Nova**,
je veux **me connecter avec mon email et mon mot de passe à un espace réservé**,
pour **accéder aux demandes en toute sécurité**.

**Critères d'acceptation :**

1. **Étant donné** le compte administrateur créé par le script, **quand** je clique sur « Espace équipe » en bas du formulaire puis me connecte, **alors** j'arrive sur une page d'accueil avec « Bonjour [prénom] », le menu latéral (seulement les rubriques qui existent déjà), mon nom et mon rôle en bas du menu.
2. **Étant donné** un mauvais mot de passe, **quand** je me connecte, **alors** je lis « Email ou mot de passe incorrect. ».
3. **Étant donné** que je ne suis pas connecté, **quand** je tape directement l'adresse `/equipe`, **alors** j'arrive sur la page de connexion, puis, une fois connecté, sur `/equipe`.
4. **Étant donné** le collaborateur de test connecté, **quand** je regarde le menu puis tape `/equipe/admin`, **alors** le groupe « Administration » est absent et je lis « Vous n'avez pas accès à cette page. ». Après « Se déconnecter », recharger une page interne me renvoie vers la connexion.

**Vérifications automatiques :**
- Un compte `desactive` ou `invite` est refusé (AD-3).
- Toute adresse `/equipe/*` sans session est renvoyée vers la connexion ; `/equipe/admin/*` est refusée à un collaborateur (AD-28).
- `mon_profil()` renvoie au membre connecté son nom et son rôle, et rien d'autre.
- Le menu se replie derrière « Menu » sous 1 024 px de large.

**Exigences :** FR-6, FR-10, NFR-1, UX-DR3, UX-DR4, UX-DR9, AD-1, AD-3, AD-17, AD-27, AD-28.

**À créer :**
- la table `membres` et les fonctions `prive.est_membre_actif`, `prive.est_admin`, `mon_profil` et `creer_membre` (l'état `actif` à la création est réservé aux scripts) ;
- les scripts `scripts/premier-admin.ts` et `scripts/comptes-de-test.ts` (comptes `TEST-`) ;
- l'action `connexion` (`lib/actions/comptes.ts`), `proxy.ts`, les mises en page `equipe` et `equipe/admin` ;
- les pages `/connexion`, `/equipe` (accueil minimal) et `/equipe/admin` (provisoire), et la page « accès refusé ».

Le prénom affiché est le premier mot du nom.

### Story 1.5 : Voir toutes les demandes avec leur statut

En tant que **membre de l'équipe Nova**,
je veux **voir toutes les demandes reçues dans une seule liste, avec leur statut**,
pour **ne plus en oublier aucune**.

**Critères d'acceptation :**

1. **Étant donné** les données d'essai chargées (`npm run donnees:remplir`), **quand** j'ouvre « Demandes », **alors** je vois un tableau des plus récentes aux plus anciennes : référence, date, demandeur et société, objet, catégorie, canal, statut, priorité et responsable (« — » si aucun).
2. **Étant donné** la liste, **quand** je regarde les statuts et priorités, **alors** chacun est un badge coloré **avec le mot** : Nouvelle en bleu, En cours en orange, Traitée en vert, Haute en rouge.
3. **Étant donné** les 40 demandes d'essai, **quand** j'arrive en bas, **alors** je lis « 1–25 sur 40 » avec Précédent / Suivant. Après `npm run donnees:vider`, la liste affiche le message d'état vide.
4. **Étant donné** un écran de téléphone, **quand** j'ouvre la liste, **alors** chaque demande s'affiche en carte ; sur tablette, le tableau est réduit à la référence, l'objet, le statut, la priorité et la date.

**Vérifications automatiques :**
- Un visiteur non connecté ne peut rien lire de `demandes_liste` ; la vue respecte RLS (`security_invoker`) (AD-2).
- Un collaborateur ne lit dans `membres` que l'identifiant, le nom et l'état.
- Le chargement affiche des squelettes ; une erreur serveur affiche le bandeau « Réessayer » (UX-DR4).
- Les commandes `donnees:remplir` et `donnees:vider` refusent de s'exécuter sur la production.

**Exigences :** FR-11, NFR-1, UX-DR2, UX-DR4, UX-DR8, AD-2, AD-25, AD-27.

**À créer :**
- la vue `demandes_liste`, les règles de lecture RLS des demandes et des membres (colonnes autorisées), la page `/equipe/demandes`, les composants de badges, et la première version de `lib/filtres.ts` (tri, pagination) ;
- `supabase/seed.sql` et les commandes `donnees:remplir` / `donnees:vider`, avec environ 40 demandes `TEST-` :
  - tous les statuts, priorités et canaux, et des responsables parmi les comptes de test ;
  - les demandeurs « Dupont » et « Dupont-Aïdi », et 3 demandes de `jean.dupont@example.com` ;
  - des demandes traitées il y a plus de 2 ans (insérées avec une date ancienne) et une demande rouverte puis traitée récemment ;
  - des états d'email variés.

### Story 1.6 : Ouvrir le détail d'une demande

En tant que **membre de l'équipe Nova**,
je veux **ouvrir une demande pour lire tout son contenu**,
pour **comprendre ce que le client attend**.

**Critères d'acceptation :**

1. **Étant donné** la liste, **quand** je clique sur une ligne, **alors** le détail affiche la référence, l'objet, les badges, « Reçue le … à … via Formulaire », la description avec ses retours à la ligne, et le demandeur (email cliquable, téléphone ou « Non renseigné »).
2. **Étant donné** une demande d'essai dont l'email n'est pas parti, **quand** j'ouvre le détail, **alors** un bandeau indique « Email non envoyé (mode démonstration) » ou « Email de confirmation non envoyé ».
3. **Étant donné** le détail, **quand** je regarde l'historique, **alors** je vois « Demandeur (formulaire) a créé la demande », avec la date et l'heure de Paris.
4. **Étant donné** une adresse de détail qui n'existe pas, **quand** je l'ouvre, **alors** je lis « Demande introuvable. » avec un lien vers la liste ; **et** « ← Retour aux demandes » me ramène à la même page de la liste.

**Vérifications automatiques :**
- Une description contenant `<script>` s'affiche comme du texte, sans s'exécuter (NFR-9).
- Les 10 types d'historique ont leur texte dans `lib/domaine.ts` ; le composant d'historique les utilise (AD-19, UX-DR11).

**Exigences :** FR-13, FR-18 (affichage), NFR-9, UX-DR4, UX-DR8, UX-DR11, AD-19, AD-24.

**À créer :** la page `/equipe/demandes/[référence]`, le composant d'historique et les textes des types d'historique.

### Story 1.7 : Recevoir l'email de confirmation

En tant que **client de Nova Services**,
je veux **recevoir ma référence par email**,
pour **la retrouver même si je ferme la page**.

**Critères d'acceptation :**

1. **Étant donné** une demande déposée avec l'adresse autorisée d'Abraham, **quand** l'envoi est terminé, **alors** la page de confirmation ajoute « Un email de confirmation vous a été envoyé. », et la boîte mail reçoit un email avec la référence, l'objet, la date et le contact, sans la description.
2. **Étant donné** une demande déposée avec une autre adresse, **quand** l'envoi est terminé, **alors** la confirmation s'affiche **sans** cette phrase, et le détail de la demande indique « Email non envoyé (mode démonstration) ».

**Vérifications automatiques :**
- L'état de l'email passe de `en_attente` à `envoye`, `non_envoye_demo` ou `echec` (AD-13).
- Un échec d'envoi est inscrit au journal (type `email`, auteur « Système »), sans l'adresse du demandeur (AD-14, AD-19).
- La clé Resend n'est lue que dans `lib/server/` (AD-9).

**Exigences :** FR-3, OPS-2, AD-13, AD-14, AD-19.

**À créer :** le compte Resend d'Abraham, les variables `RESEND_API_KEY` et `EMAILS_AUTORISES`, `lib/server/emails.ts`, la table `journal`, et les fonctions `prive.ecrire_journal` et `noter_resultat_email`.

### Story 1.8 : Bloquer les envois en masse

En tant que **membre de l'équipe Nova**,
je veux **que le formulaire public refuse les envois en rafale**,
pour **ne pas crouler sous des demandes indésirables**.

**Critères d'acceptation :**

1. **Étant donné** que j'ai envoyé 5 demandes en moins de 10 minutes depuis mon ordinateur, **quand** j'en envoie une sixième, **alors** je lis « Trop d'envois depuis votre connexion. Réessayez dans quelques minutes. » et aucune page de confirmation n'apparaît.
2. **Étant donné** un envoi normal, **quand** je remplis le formulaire, **alors** le champ piège ne se voit pas et ne gêne pas l'envoi, y compris au clavier.

**Vérifications automatiques :**
- Un envoi qui remplit le champ piège n'est pas enregistré.
- La limite est appliquée par le serveur, même pour un envoi qui ne passe pas par la page.
- L'IP n'est stockée que sous forme d'empreinte HMAC (secret `HMAC_SECRET`), effacée au-delà d'une heure (AD-14, AD-23).
- L'IP est lue dans `x-nf-client-connection-ip` sur Netlify, avec une valeur de repli en local. Le bon fonctionnement sur Netlify est vérifié en 3.1.

**Exigences :** FR-5, NFR-9, AD-14, AD-16, AD-23.

**À créer :** la table `envois_formulaire`, l'utilitaire d'empreinte HMAC et la variable `HMAC_SECRET`.

### Story 1.9 : Sécuriser la connexion

En tant que **responsable technique**,
je veux **bloquer les essais de mots de passe en série et limiter la durée des sessions**,
pour **qu'un compte de l'équipe ne puisse pas être forcé ou laissé ouvert**.

**Critères d'acceptation :**

1. **Étant donné** un compte de test, **quand** je me trompe 5 fois de suite de mot de passe, **alors** je lis « Trop de tentatives. Réessayez dans 15 minutes. », et même le bon mot de passe est refusé pendant ce délai.
2. **Étant donné** ce blocage, **quand** je regarde la base de développement avec le script d'inspection, **alors** une ligne de journal « connexion bloquée » existe, avec l'auteur « Système ».

**Vérifications automatiques :**
- Une session de plus de 8 h est fermée par `proxy.ts`, et l'utilisateur est renvoyé vers la connexion (AD-21).
- Un mot de passe de moins de 8 caractères est refusé (réglage Supabase).
- Les tests de blocage n'utilisent que des comptes `TEST-`.

**Exigences :** FR-6, NFR-9, OPS-2, AD-21.

**À créer :** la table `tentatives_connexion`, le compteur dans l'action `connexion`, la limite de 8 h dans `proxy.ts` et le script d'inspection du journal (`npm run journal`).

---

## Epic 2 : Traiter les demandes

L'équipe s'organise autour des demandes : qui s'en occupe, ce qui a été fait, où elles en sont, ce qui est urgent. Elle retrouve n'importe quelle demande en quelques secondes et saisit aussi les demandes reçues par téléphone.

### Story 2.1 : Prendre en charge une demande

En tant que **collaborateur**,
je veux **prendre en charge une demande nouvelle**,
pour **que toute l'équipe sache que je m'en occupe**.

**Critères d'acceptation :**

1. **Étant donné** une demande Nouvelle sans responsable, **quand** je clique sur « Prendre en charge », **alors** le message « Vous êtes responsable de cette demande. » s'affiche en bas de l'écran, mon nom apparaît comme responsable et le badge passe à En cours.
2. **Étant donné** la même action, **quand** je regarde l'historique, **alors** la ligne « Prise en charge par [mon nom] : Nouvelle → En cours » vient de s'ajouter, sans recharger la page.
3. **Étant donné** deux navigateurs ouverts sur la même demande Nouvelle (l'administrateur dans l'un, le collaborateur de test dans l'autre), **quand** l'un prend la demande puis l'autre clique à son tour, **alors** le second lit « Déjà prise en charge par [nom]. ».

**Vérifications automatiques :**
- Deux prises en charge simultanées : une seule réussit, l'autre reçoit `DEJA_PRISE` (AD-4, AD-20).
- Seul un membre actif peut appeler `prendre_en_charge` (AD-15).

**Exigences :** FR-14, FR-18, UX-DR5, AD-4, AD-7, AD-20.

**À créer :** la fonction `prendre_en_charge`, la partie traitement de `lib/actions/demandes.ts`, le panneau d'actions du détail et le composant de messages brefs (toasts).

### Story 2.2 : Ajouter une note interne

En tant que **collaborateur**,
je veux **écrire une note sur une demande, visible seulement par l'équipe**,
pour **garder une trace de ce qui a été fait ou dit**.

**Critères d'acceptation :**

1. **Étant donné** le détail, **quand** j'écris une note et clique sur « Ajouter la note », **alors** elle apparaît avec mon nom, la date et l'heure, et je lis « Note ajoutée. ».
2. **Étant donné** une zone de note vide, **quand** je clique sur « Ajouter la note », **alors** un message me demande d'écrire un texte.
3. **Étant donné** une demande sans note, **quand** j'ouvre le détail, **alors** je lis « Aucune note interne. ».

**Vérifications automatiques :**
- Aucune fonction ne permet de modifier ou de supprimer une note (AD-5).
- L'historique contient « [nom] a ajouté une note interne », sans recopier le texte (AD-19).

**Exigences :** FR-17, FR-18, AD-4, AD-5, AD-19.

**À créer :** la table `notes`, la fonction `ajouter_note`, le bloc Notes du détail, et des notes dans les données d'essai.

### Story 2.3 : Marquer une demande traitée, la rouvrir ou la classer sans suite

En tant que **collaborateur**,
je veux **faire avancer le statut d'une demande**,
pour **montrer où en est son traitement**.

**Critères d'acceptation :**

1. **Étant donné** une demande En cours, **quand** je clique sur « Marquer comme traitée », **alors** le badge passe au vert « Traitée » et l'historique indique « [nom] a changé le statut : En cours → Traitée ».
2. **Étant donné** une demande Traitée, **quand** je clique sur « Rouvrir », **alors** elle repasse En cours avec le même responsable.
3. **Étant donné** une demande Nouvelle (spam ou doublon), **quand** je clique sur « Classer sans suite », **alors** une fenêtre demande une note obligatoire ; sans note elle refuse, et avec la note la demande passe à Traitée, la note apparaît dans les notes internes et l'historique indique « Classée sans suite par [nom] : Nouvelle → Traitée ».
4. **Étant donné** un statut, **quand** je regarde le panneau d'actions, **alors** je ne vois que les changements permis pour ce statut.

**Vérifications automatiques :**
- Un passage interdit envoyé directement au serveur est refusé (`PASSAGE_INTERDIT`).
- `traitee_le` et `mis_a_jour_le` sont mis à jour par le déclencheur (AD-22).

**Exigences :** FR-15, FR-17, FR-18, règle 1, UX-DR6, AD-4, AD-22.

**À créer :** les fonctions `changer_statut` et `classer_sans_suite`, et la fenêtre de confirmation.

### Story 2.4 : Fixer la priorité et corriger la catégorie

En tant que **collaborateur**,
je veux **indiquer la priorité d'une demande et corriger sa catégorie si le client s'est trompé**,
pour **repérer l'urgent et bien classer les demandes**.

**Critères d'acceptation :**

1. **Étant donné** le détail d'une demande, **quand** je choisis « Haute » dans Priorité, **alors** le badge rouge « Haute » apparaît dans le détail et dans la liste.
2. **Étant donné** le détail, **quand** je change la catégorie, **alors** la nouvelle catégorie apparaît dans le détail et dans la liste.
3. **Étant donné** ces deux changements, **quand** je regarde l'historique, **alors** chacun a sa ligne avec l'ancienne et la nouvelle valeur.

**Vérifications automatiques :**
- Seuls les codes `basse`, `normale` et `haute` sont acceptés (AD-18).

**Exigences :** FR-16, FR-18, hypothèse UX n° 3, AD-4, AD-18, AD-19.

**À créer :** les fonctions `changer_priorite` et `changer_categorie`.

### Story 2.5 : Rechercher et filtrer les demandes

En tant que **membre de l'équipe**,
je veux **retrouver une demande par un mot ou un filtre**,
pour **ne pas faire défiler toute la liste**.

**Critères d'acceptation :**

1. **Étant donné** la liste, **quand** je tape une référence complète, **alors** seule cette demande s'affiche ; **et** si je tape « dupont », je trouve « Dupont » et « Dupont-Aïdi ».
2. **Étant donné** la liste, **quand** je choisis « Non traitées » et « Haute », **alors** seules les demandes qui ont les deux s'affichent, et l'adresse de la page contient ces filtres.
3. **Étant donné** aucun résultat, **quand** la liste se met à jour, **alors** je lis « Aucune demande ne correspond à ces filtres. » et un bouton « Effacer les filtres ».
4. **Étant donné** des filtres actifs, **quand** j'ouvre une demande puis reviens, **alors** mes filtres sont toujours là.

**Vérifications automatiques :**
- Avec 2 000 demandes fictives en développement, la liste filtrée s'affiche en moins de 2 secondes (NFR-7).
- Les filtres « Sans responsable », « Mes demandes », Catégorie, Canal et Responsable renvoient les bonnes demandes.

**Exigences :** FR-12, NFR-7, AD-18, AD-25.

**À créer :** la colonne de recherche normalisée, `lib/filtres.ts` complet, la barre de recherche et de filtres, et la commande `donnees:charge` (2 000 demandes).

### Story 2.6 : Saisir une demande reçue par téléphone ou par email

En tant que **membre de l'équipe**,
je veux **enregistrer moi-même une demande reçue par téléphone ou par email**,
pour **que toutes les demandes soient au même endroit, quelle que soit leur origine**.

**Critères d'acceptation :**

1. **Étant donné** « Saisir une demande » (dans le menu et en haut de la liste), **quand** j'ouvre le formulaire, **alors** je vois d'abord le choix du canal (Téléphone ou Email), les mêmes champs que le formulaire public, le rappel « Pensez à informer le demandeur de l'usage de ses données. » et **pas** de case de consentement.
2. **Étant donné** le canal Téléphone, le nom, le téléphone et la demande remplis, **quand** j'enregistre, **alors** je lis « Demande NOVA-2026-… enregistrée. » et son détail s'ouvre, avec le canal Téléphone.
3. **Étant donné** ce détail, **quand** je regarde l'historique, **alors** je lis « Saisie par [mon nom] (téléphone) ».
4. **Étant donné** ni email ni téléphone renseigné, **quand** j'enregistre, **alors** le message « Indiquez au moins un email ou un téléphone. » s'affiche.

**Vérifications automatiques :**
- Pas de limite anti-spam pour cette saisie.
- Sans email, l'état de l'email est `sans_email` ; avec un email, AD-13 s'applique.
- La page et l'action sont refusées sans connexion.

**Exigences :** FR-25, AD-4, AD-6, AD-13, AD-26.

**À créer :** la fonction `saisir_demande`, l'action `saisir` et la page `/equipe/demandes/nouvelle`.

### Story 2.7 : Libérer ou attribuer une demande

En tant que **membre de l'équipe**,
je veux **rendre une demande que je ne peux pas traiter, ou, si je suis administrateur, la confier à quelqu'un**,
pour **qu'aucune demande ne reste bloquée**.

**Critères d'acceptation :**

1. **Étant donné** une demande En cours dont je suis responsable, **quand** je clique sur « Libérer », **alors** elle repasse en Nouvelle, sans responsable.
2. **Étant donné** que je suis administrateur, **quand** je choisis « Attribuer à… » puis le collaborateur de test sur une demande Nouvelle, **alors** il devient responsable et la demande est En cours ; **et** sur une demande En cours, je peux la réattribuer à quelqu'un d'autre.
3. **Étant donné** que je suis administrateur, **quand** j'ouvre une demande En cours dont je ne suis pas responsable, **alors** je vois aussi « Libérer ».
4. **Étant donné** que je suis collaborateur, **quand** j'ouvre une demande, **alors** je ne vois pas « Attribuer à… », ni « Libérer » sur une demande dont je ne suis pas responsable.

**Vérifications automatiques :**
- `attribuer` est refusée à un collaborateur par le serveur (`DROIT_INSUFFISANT`).
- Chaque attribution, réattribution ou libération a sa ligne d'historique.

**Exigences :** FR-14, règles 2 et 4, AD-4, AD-15.

**À créer :** les fonctions `liberer` et `attribuer`, et la fenêtre de choix du membre.

### Story 2.8 : Voir le tableau de bord et le compteur de nouvelles demandes

En tant que **membre de l'équipe**,
je veux **voir dès mon arrivée ce qui attend une intervention**,
pour **commencer par l'essentiel**.

**Critères d'acceptation :**

1. **Étant donné** que je me connecte, **quand** le tableau de bord s'affiche, **alors** je vois 5 chiffres (À prendre en charge, Priorité Haute non traitées, Nouvelle, En cours, Traitée), « Mes demandes en cours » (5 dernières) et le bouton « Saisir une demande ».
2. **Étant donné** le chiffre « À prendre en charge : 3 », **quand** je clique dessus, **alors** la liste filtrée contient exactement 3 demandes.
3. **Étant donné** le menu, **quand** une demande est prise en charge puis que la page se recharge, **alors** le compteur à côté de « Demandes » diminue de 1, et il disparaît à 0.
4. **Étant donné** aucune demande (après `donnees:vider`), **quand** j'ouvre le tableau de bord, **alors** je lis « Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients. » avec le bouton « Copier le lien ».

**Vérifications automatiques :**
- Les compteurs utilisent `lib/filtres.ts`, comme la liste (AD-25).

**Exigences :** FR-19, UX-DR3, AD-25.

**À créer :** le tableau de bord sur la page `/equipe` (qui remplace l'accueil minimal), les cartes chiffrées et le compteur du menu.

---

## Epic 3 : Mettre en ligne et assurer le fonctionnement

L'application est accessible en ligne, dans un environnement de production séparé. Les données sont sauvegardées et les erreurs suivies ; la restauration comme le retour à une version précédente ont été **réellement** essayés. La documentation d'exploitation existe. C'est la partie « mise en production » du sujet.

### Story 3.1 : Mettre l'application en ligne

En tant que **direction de Nova Services**,
je veux **que l'application soit accessible en ligne, séparée de l'environnement de développement**,
pour **pouvoir l'utiliser dans des conditions réelles**.

**Critères d'acceptation :**

1. **Étant donné** l'adresse Netlify de production, **quand** je l'ouvre, **alors** le formulaire s'affiche en `https://`, et je peux y déposer une demande.
2. **Étant donné** une page interne en production, **quand** je regarde en bas, **alors** je lis « Version v1.0.0 », la même que l'étiquette Git de cette mise en ligne.
3. **Étant donné** une demande créée en développement, **quand** je regarde la liste de production, **alors** elle n'y est pas, et aucune donnée `TEST-` n'y figure.
4. **Étant donné** une branche autre que `main`, **quand** je l'envoie sur GitHub, **alors** Netlify crée une adresse de prévisualisation, sur laquelle l'anti-spam fonctionne (6ᵉ envoi refusé).

**Vérifications automatiques :**
- `main` refuse une fusion si un test GitHub échoue (AD-11).
- Le build Netlify lance `npm run verifier` (vérifications rapides **sans** base de données), puis la construction.
- `npm audit` sans faille grave (NFR-9) ; les anciennes clés Supabase sont désactivées (AD-9).

**Exigences :** NFR-3, NFR-4, NFR-8, NFR-9, UX-DR3 (version), AD-9, AD-10, AD-11, AD-14, AD-27.

**À créer :**
- le projet Supabase de production (Irlande, UE) et le site Netlify, créés par Abraham ;
- les variables d'environnement Netlify, les migrations appliquées en production et le premier administrateur (`premier-admin --production`) ;
- la protection de `main`, l'injection de la version, l'étiquette `v1.0.0` et la commande `verifier`.

### Story 3.2 : Sauvegarder les données chaque nuit

En tant que **responsable technique**,
je veux **une sauvegarde automatique et chiffrée chaque nuit**,
pour **ne rien perdre si la base est abîmée**.

**Critères d'acceptation :**

1. **Étant donné** la page « Actions » du dépôt GitHub, **quand** je regarde le lendemain matin, **alors** la tâche « Sauvegarde nocturne » est verte et propose un fichier de sauvegarde conservé 30 jours.
2. **Étant donné** une mise en ligne à venir, **quand** je lance la sauvegarde à la main, **alors** elle se termine en vert.
3. **Étant donné** la même page, **quand** je regarde la tâche « Réveil », **alors** elle a tourné chaque jour pour les deux projets Supabase.

**Vérifications automatiques :**
- Le fichier de sauvegarde est chiffré et illisible sans la phrase secrète (AD-12).
- `purger_technique` tourne chaque nuit : IP de plus d'une heure, tentatives de plus d'un jour, journal de plus d'un an (AD-23).

**Exigences :** OPS-3, AD-12, AD-23.

**À créer :** les tâches GitHub Actions de sauvegarde, de réveil et de nettoyage, les secrets GitHub (connexion par le pooler, phrase de chiffrement) et la fonction `purger_technique`.

### Story 3.3 : Suivre les erreurs de l'application

En tant que **responsable technique**,
je veux **être prévenu quand une erreur se produit en production**,
pour **la corriger avant que l'équipe en souffre**.

**Critères d'acceptation :**

1. **Étant donné** une erreur provoquée volontairement en production (page de test réservée à l'administrateur), **quand** j'ouvre Sentry, **alors** elle y apparaît en moins de 5 minutes, et je reçois un email d'alerte.
2. **Étant donné** cette erreur dans Sentry, **quand** je l'ouvre, **alors** je n'y vois ni nom, ni email, ni téléphone, ni texte de formulaire, ni adresse IP.

**Vérifications automatiques :**
- Un test vérifie les options Sentry : `dataCollection`, pas de Replay, `beforeSend` (AD-14).
- L'organisation Sentry est en région UE ; la page de test est refusée à un collaborateur.

**Exigences :** OPS-1, AD-7, AD-14.

**À créer :** le compte Sentry d'Abraham (région UE), la configuration `@sentry/nextjs`, les variables Sentry dans Netlify et `.env.example`, et la page de test d'erreur.

### Story 3.4 : Restaurer une sauvegarde (essai réel)

En tant que **responsable technique**,
je veux **avoir déjà restauré une sauvegarde au moins une fois**,
pour **savoir que ça marche le jour où on en a besoin**.

**Critères d'acceptation :**

1. **Étant donné** 3 demandes fictives déposées en production avant une sauvegarde, **quand** je lance la tâche « Restauration de test », **alors** son rapport affiche le nombre de demandes avant et après, et le projet de développement en contient le même nombre que la production.
2. **Étant donné** l'essai terminé, **quand** j'ouvre `docs/exploitation/restauration.md`, **alors** j'y lis la procédure, la date de l'essai, sa durée et son résultat.
3. **Étant donné** la fin de l'essai, **quand** je lance `donnees:remplir` sur le développement, **alors** il retrouve ses données d'essai.

**Vérifications automatiques :**
- `rejouer_effacements()` est appelée après la restauration (AD-30).

**Exigences :** OPS-4, AD-12, AD-30.

**À créer :** la tâche de restauration de test, la table `effacements`, la fonction `rejouer_effacements` et la procédure écrite. L'essai sera refait une fois après la story 5.4, pour vérifier le rejeu des effacements.

### Story 3.5 : Revenir à la version précédente (essai réel)

En tant que **responsable technique**,
je veux **avoir déjà annulé une mise en ligne au moins une fois**,
pour **réparer vite si une mise à jour provoque un problème**.

**Critères d'acceptation :**

1. **Étant donné** une version `v1.0.1` en ligne, **quand** je suis la procédure de retour arrière (« Publish deploy » sur la version précédente), **alors** le bas des pages affiche à nouveau « Version v1.0.0 » et je peux déposer une demande.
2. **Étant donné** l'essai terminé, **quand** j'ouvre `docs/exploitation/retour-arriere.md`, **alors** j'y lis la procédure, avec la date et le résultat de l'essai.

**Vérifications automatiques :** aucune (essai manuel documenté).

**Exigences :** NFR-5, AD-10, AD-11.

**À créer :** la procédure écrite et la fiche de mise en ligne ou de retour.

### Story 3.6 : Documenter l'exploitation, le support et la sécurité

En tant que **direction de Nova Services**,
je veux **des fiches courtes pour les pannes, le support et la sécurité**,
pour **que quelqu'un d'autre qu'Abraham sache quoi faire**.

**Critères d'acceptation :**

1. **Étant donné** le dossier `docs/`, **quand** je l'ouvre, **alors** j'y trouve : déploiement, maintenance, fiche d'indisponibilité, support en deux niveaux (tableau problème → niveau → qui → délai → comment le signaler), sécurité, protection des données, et le carnet d'usage de l'IA, à jour.
2. **Étant donné** la fiche d'indisponibilité, **quand** je lis son exercice, **alors** une panne simulée y est racontée, avec sa date et son résultat.
3. **Étant donné** la fiche de support, **quand** je la lis, **alors** 3 cas fictifs y sont classés en niveau 1 ou 2.

**Vérifications automatiques :** aucune (documentation).

**Exigences :** OPS-5, OPS-6, OPS-7, §8 du PRD.

**À créer :** les documents de `docs/`. Ils sont relus et complétés à la fin du projet.

---

## Epic 4 : Gérer l'équipe

L'administrateur gère seul les comptes de l'équipe : il invite, modifie, désactive ou réactive. Chaque membre choisit son mot de passe et peut le renouveler. En mode démonstration, les liens sont affichés à l'administrateur pour qu'il les copie.

### Story 4.1 : Inviter un nouveau membre

En tant qu'**administratrice**,
je veux **inviter un collègue en saisissant son nom, son email et son rôle**,
pour **qu'il accède à l'espace équipe sans que je connaisse son mot de passe**.

**Critères d'acceptation :**

1. **Étant donné** la page Comptes, **quand** j'invite « Léo Martin », son email et le rôle Collaborateur, **alors** Léo apparaît dans la liste avec l'état « Invité », et une fenêtre m'affiche son lien d'invitation (valable 24 h) avec « Copier ».
2. **Étant donné** ce lien ouvert dans un autre navigateur, **quand** Léo choisit un mot de passe de 8 caractères ou plus, **alors** il arrive sur l'espace équipe, et son état passe à « Actif » dans la liste.
3. **Étant donné** un email déjà utilisé, **quand** j'invite, **alors** un message l'indique sous le champ.

**Vérifications automatiques :**
- Si la création de la ligne `membres` échoue, le compte Auth créé est supprimé (AD-17).
- La création est inscrite au journal (« Compte créé : Léo Martin (Collaborateur), par [nom] »).
- Un collaborateur ne peut ni ouvrir la page Comptes ni appeler l'action d'invitation ; un mot de passe de moins de 8 caractères est refusé.

**Exigences :** FR-8, FR-10, OPS-2, AD-13, AD-17, AD-31.

**À créer :**
- les fonctions `activer_mon_compte` et `lister_comptes`, et l'action d'invitation (`lib/actions/admin.ts`) ;
- la page `/equipe/admin/comptes`, qui remplace la page admin provisoire ;
- la page `/auth/confirmer`, qui vérifie le lien puis renvoie vers `/nouveau-mot-de-passe` (choix du mot de passe) ;
- la variable `NEXT_PUBLIC_SITE_URL`.

### Story 4.2 : Modifier, désactiver ou réactiver un compte

En tant qu'**administratrice**,
je veux **changer le nom ou le rôle d'un membre, ou couper son accès quand il part**,
pour **que seules les bonnes personnes aient accès aux demandes**.

**Critères d'acceptation :**

1. **Étant donné** un membre, **quand** je modifie son nom ou passe son rôle à Administrateur, **alors** la liste l'affiche aussitôt, et il voit le groupe « Administration » à son prochain chargement de page.
2. **Étant donné** Léo, responsable de 2 demandes En cours, **quand** je clique sur « Désactiver », **alors** la fenêtre annonce « Ses 2 demandes en cours reviendront en Nouvelle, sans responsable. » ; après confirmation, Léo est « Désactivé ».
3. **Étant donné** Léo désactivé, **quand** il essaie de se connecter, **alors** il est refusé, et son nom reste visible dans les historiques ; **et** sur mon propre compte, je ne vois ni « Désactiver » ni changement de rôle.
4. **Étant donné** Léo désactivé, **quand** je clique sur « Réactiver », ou sur « Réactiver ce compte » proposé quand j'invite son email, **alors** il peut à nouveau se connecter.

**Vérifications automatiques :**
- Un membre connecté qu'on désactive est refusé dès son action suivante (AD-3).
- Il reste toujours au moins un administrateur actif, même si deux administrateurs agissent en même temps (`DERNIER_ADMIN`, AD-29).
- On ne peut pas attribuer une demande à un compte désactivé ; une demande rouverte dont le responsable est désactivé revient en Nouvelle sans responsable.
- Chaque changement est inscrit au journal (type `compte`).

**Exigences :** FR-9, FR-14, règles 7 et 8, UX-DR6, AD-17, AD-29.

**À créer :** les fonctions `modifier_membre`, `desactiver_membre` et `reactiver_membre`, et le blocage et déblocage dans Auth.

### Story 4.3 : Retrouver l'accès en cas de mot de passe oublié

En tant que **membre de l'équipe**,
je veux **pouvoir choisir un nouveau mot de passe si j'ai oublié le mien**,
pour **ne pas rester bloqué**.

**Critères d'acceptation :**

1. **Étant donné** la page de connexion, **quand** je clique sur « Mot de passe oublié » et saisis un email, **alors** je lis le même message, que l'email existe ou non.
2. **Étant donné** l'adresse autorisée d'Abraham, **quand** il fait cette demande, **alors** il reçoit un email avec un lien valable 24 h, qui lui permet de choisir un nouveau mot de passe et de se connecter.
3. **Étant donné** que je suis administratrice, **quand** je clique sur « Générer un lien de mot de passe » pour un membre actif, **alors** le lien m'est affiché avec « Copier ».
4. **Étant donné** un lien déjà utilisé, **quand** je l'ouvre à nouveau, **alors** je lis « Ce lien n'est plus valable. » avec un bouton pour en demander un nouveau.

**Vérifications automatiques :**
- Un lien de plus de 24 h est refusé (test automatique) ; la génération de lien est refusée à un collaborateur.

**Exigences :** FR-7, AD-13, AD-17.

**À créer :** la page `/mot-de-passe-oublie`, la version « réinitialisation » de `/nouveau-mot-de-passe`, et les actions correspondantes.

### Story 4.4 : Renvoyer ou annuler une invitation

En tant qu'**administratrice**,
je veux **renvoyer une invitation dont le lien n'est plus valable, ou annuler une invitation faite par erreur**,
pour **garder une liste de comptes propre**.

**Critères d'acceptation :**

1. **Étant donné** un membre « Invité », **quand** je clique sur « Renvoyer l'invitation », **alors** un nouveau lien valable 24 h m'est affiché.
2. **Étant donné** l'ancien lien (remplacé), **quand** Léo l'ouvre, **alors** il lit « Ce lien n'est plus valable. Contactez votre administrateur. ».
3. **Étant donné** un membre « Invité », **quand** je clique sur « Annuler l'invitation » et confirme, **alors** il disparaît de la liste.

**Vérifications automatiques :**
- L'annulation est refusée pour un compte Actif ou Désactivé (AD-17) ; une invitation de plus de 24 h est refusée (test automatique).

**Exigences :** FR-8, UX-DR6, AD-17.

**À créer :** la fonction `annuler_invitation` et les deux actions correspondantes.

---

## Epic 5 : Administrer les paramètres et les données

L'administrateur consulte le journal des événements importants, règle ce qui fait fonctionner l'application (catégories, contact, durée de conservation) et respecte les droits des personnes sur leurs données.

### Story 5.1 : Consulter le journal des événements

En tant qu'**administratrice**,
je veux **voir la liste des événements importants**,
pour **savoir qui a fait quoi sur les comptes, les réglages et les données**.

**Critères d'acceptation :**

1. **Étant donné** la page Journal, **quand** je l'ouvre, **alors** je vois les événements du plus récent au plus ancien : date, type, description, auteur (« Système » pour un échec d'email ou un blocage de connexion).
2. **Étant donné** le filtre « Compte », **quand** je le choisis, **alors** seuls les événements de comptes s'affichent, dont « Compte créé : Léo Martin… ».
3. **Étant donné** que je suis collaborateur, **quand** je tape l'adresse du journal, **alors** l'accès est refusé.

**Vérifications automatiques :**
- Aucune ligne du journal ne contient de donnée de demandeur (AD-14) ; 50 lignes par page.

**Exigences :** FR-26, OPS-2, AD-5, AD-19.

**À créer :** la page `/equipe/admin/journal`.

### Story 5.2 : Gérer les catégories

En tant qu'**administratrice**,
je veux **ajouter, renommer, désactiver ou réactiver des catégories**,
pour **adapter le formulaire aux demandes réelles**.

**Critères d'acceptation :**

1. **Étant donné** la page Catégories (nom, état, nombre de demandes), **quand** j'ajoute « Formation », **alors** elle apparaît aussitôt dans le formulaire public.
2. **Étant donné** une catégorie, **quand** je la renomme, **alors** le nouveau nom apparaît partout, y compris sur les anciennes demandes.
3. **Étant donné** une catégorie utilisée, **quand** je la désactive, **alors** elle disparaît du formulaire et du choix de catégorie du détail, mais reste affichée sur les anciennes demandes. Désactiver la dernière catégorie active affiche « Il doit rester au moins une catégorie active. ».
4. **Étant donné** « Formation » existante, **quand** j'ajoute, renomme ou réactive une catégorie en « formation » ou « Formatión », **alors** je lis que ce nom est déjà pris.

**Vérifications automatiques :**
- Une catégorie désactivée est refusée par `changer_categorie` ; chaque changement est inscrit au journal (type `categorie`).

**Exigences :** FR-20, règle 9, AD-4.

**À créer :** les fonctions `ajouter_categorie`, `renommer_categorie`, `activer_categorie` et `desactiver_categorie`, et la page `/equipe/admin/categories`.

### Story 5.3 : Modifier les paramètres généraux

En tant qu'**administratrice**,
je veux **régler le nom et l'email de contact affichés, ainsi que la durée de conservation**,
pour **que les clients aient les bonnes informations**.

**Critères d'acceptation :**

1. **Étant donné** la page Paramètres, **quand** je change l'email de contact, **alors** le formulaire public et la page de confirmation affichent le nouveau.
2. **Étant donné** la durée de conservation, **quand** je choisis 3 ans, **alors** l'aperçu et le formulaire public affichent « 3 ans ».
3. **Étant donné** un email mal écrit, **quand** j'enregistre, **alors** un message l'indique sous le champ.

**Vérifications automatiques :**
- Durée limitée à 6–60 mois ; chaque changement est inscrit au journal (type `parametre`).

**Exigences :** FR-21, AD-23.

**À créer :** la fonction `modifier_parametres` et la page `/equipe/admin/parametres`.

### Story 5.4 : Effacer les données d'une personne

En tant qu'**administratrice**,
je veux **effacer toutes les demandes d'une personne qui le demande**,
pour **respecter son droit à l'effacement (RGPD)**.

**Critères d'acceptation :**

1. **Étant donné** la page Données personnelles, **quand** je recherche `Jean.Dupont@example.com`, **alors** je vois ses 3 demandes d'essai, et l'email n'apparaît pas dans l'adresse de la page.
2. **Étant donné** ces demandes, **quand** je clique sur « Effacer ces 3 demandes » et confirme, **alors** elles n'apparaissent plus ni dans la liste ni dans la recherche.
3. **Étant donné** le journal, **quand** je l'ouvre, **alors** une ligne indique « 3 demandes effacées (droit à l'effacement) par [mon nom] », sans l'email effacé.

**Vérifications automatiques :**
- Les références effacées sont ajoutées à `effacements` (AD-30) ; l'action est refusée à un collaborateur.

**Exigences :** FR-22, AD-5, AD-30, AD-31.

**À créer :** la fonction `effacer_demandeur` et la page `/equipe/admin/donnees` (bloc effacement, recherche envoyée sans apparaître dans l'adresse).

### Story 5.5 : Supprimer les demandes expirées

En tant qu'**administratrice**,
je veux **supprimer en une fois les demandes traitées depuis plus longtemps que la durée de conservation**,
pour **ne pas garder de données plus longtemps que promis**.

**Critères d'acceptation :**

1. **Étant donné** les demandes d'essai traitées il y a plus de 2 ans, **quand** j'ouvre Données personnelles, **alors** je lis « N demandes sont traitées depuis plus de 2 ans. ».
2. **Étant donné** ce nombre, **quand** je clique sur « Supprimer les demandes expirées » et confirme, **alors** ces N demandes disparaissent ; la demande rouverte puis traitée récemment reste.
3. **Étant donné** aucune demande expirée, **quand** j'ouvre la page, **alors** le bouton est désactivé avec « Aucune demande expirée. ».

**Vérifications automatiques :**
- Une demande jamais traitée n'est jamais purgée ; la purge est inscrite au journal avec le nombre de demandes.

**Exigences :** FR-24, AD-23.

**À créer :** la fonction `purger_expirees` et le bloc purge de la page Données personnelles.

---

## Epic 6 : Bonus IA (peut attendre)

Une IA propose une catégorie et une priorité pour chaque nouvelle demande ; l'équipe décide. On ne commence cet epic qu'une fois les epics 1 à 5 en ligne.

### Story 6.1 : Recevoir une suggestion de catégorie et de priorité

En tant que **collaborateur**,
je veux **qu'une IA me propose une catégorie et une priorité pour une nouvelle demande**,
pour **trier plus vite, en gardant la décision**.

**Critères d'acceptation :**

1. **Étant donné** une nouvelle demande, **quand** j'ouvre son détail, **alors** je vois une suggestion marquée « proposée par l'IA », avec « Accepter » et « Corriger ».
2. **Étant donné** la suggestion, **quand** je l'accepte, **alors** la catégorie et la priorité changent et l'historique l'indique.
3. **Étant donné** l'IA indisponible, **quand** j'ouvre le détail, **alors** aucune suggestion n'apparaît et je peux traiter la demande normalement.

**Vérifications automatiques :**
- Seuls l'objet et la description sont envoyés à l'IA, jamais les coordonnées (§8 du PRD).

**Exigences :** FR-23.

**À créer :** d'abord une courte étude, qui choisit le fournisseur d'IA, vérifie où il traite les données et ajoute les nouveaux types d'historique ; ensuite seulement, la construction.
