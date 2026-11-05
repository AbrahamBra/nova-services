# Epic 3 Context: Mettre en ligne et assurer le fonctionnement

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

L'application est accessible en ligne, dans un environnement de production séparé du développement. Les données sont sauvegardées chaque nuit hors de Supabase, les erreurs sont suivies dans Sentry (région UE) sans aucune donnée personnelle, et la restauration comme le retour à une version précédente ont été **réellement** essayés. Une documentation d'exploitation courte permet à quelqu'un d'autre qu'Abraham de savoir quoi faire en cas de panne, de demande de support ou de question de sécurité. C'est la partie « mise en production » du sujet, avec un budget de 0 € (offres gratuites uniquement).

## Stories

- Story 3.1 : Mettre l'application en ligne
- Story 3.2 : Sauvegarder les données chaque nuit
- Story 3.3 : Suivre les erreurs de l'application
- Story 3.4 : Restaurer une sauvegarde (essai réel)
- Story 3.5 : Revenir à la version précédente (essai réel)
- Story 3.6 : Documenter l'exploitation, le support et la sécurité

### Texte intégral des stories 3.2, 3.3 et 3.6

#### Story 3.2 : Sauvegarder les données chaque nuit

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

#### Story 3.3 : Suivre les erreurs de l'application

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

#### Story 3.6 : Documenter l'exploitation, le support et la sécurité

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

## Requirements & Constraints

**Règles communes à toutes les stories :** une story ne dépend que des précédentes ; elle est terminée quand ses critères sont vérifiés à l'écran, que tous les tests passent et qu'elle est commitée avec un message clair en français ; une ligne est ajoutée au carnet d'usage de l'IA (`docs/carnet-ia.md`) ; les tests n'utilisent que des données préfixées `TEST-` et ne visent jamais la production (AD-27).

**Exigences d'exploitation :**
- **Suivi des erreurs (OPS-1)** : erreurs enregistrées automatiquement, sans mot de passe ni donnée personnelle, consultables par le responsable technique. Vérification : une erreur provoquée volontairement en production apparaît dans l'outil en moins de 5 minutes.
- **Sauvegarde (OPS-3)** : la base (demandes, historiques, notes, catégories, paramètres et comptes) est sauvegardée automatiquement chaque jour, plus juste avant chaque mise en ligne. Une copie est gardée hors de l'hébergeur. Conservation 30 jours. Vérification : la liste des sauvegardes montre une sauvegarde par jour et une avant chaque version.
- **Restauration (OPS-4)** : procédure écrite, y compris refaire les effacements RGPD postérieurs à la sauvegarde ; réalisée pour de vrai au moins une fois sur un environnement séparé (même nombre de demandes), date et durée notées.
- **Indisponibilité (OPS-5)** : fiche des premières actions si l'application ne répond plus : vérifier, prévenir l'équipe, recevoir les demandes par téléphone et email puis les saisir avec FR-25 (saisie interne), revenir à la version précédente ou restaurer. Un exercice de panne simulée a été déroulé une fois avec la fiche ; résultat noté.
- **Support en deux niveaux (OPS-6)** : tableau « problème → niveau → qui → délai → comment le signaler ». Niveau 1, l'administrateur : questions d'usage, mot de passe oublié, compte à créer ou débloquer. Niveau 2, le responsable technique : panne, erreur, perte de données, faille. 3 cas fictifs classés et traités avec lui.
- **Documentation synthétique (OPS-7)** : déploiement (mise en ligne, réglages, versions), maintenance (sauvegarde, restauration, retour arrière, mises à jour), support (OPS-6), sécurité (accès, secrets, mots de passe), protection des données, et carnet d'usage de l'IA (ce que l'IA a produit, ce qui a été vérifié et corrigé). Un membre extérieur au projet sait suivre la procédure de mise en ligne.
- **Secrets (NFR-2)** : aucun identifiant, mot de passe ni clé dans le code ou le dépôt Git ; stockés chez l'hébergeur ; la recherche automatique de secrets ne trouve rien ; `.env.local` exclu de Git.
- **Environnements séparés (NFR-3)** : dev et prod avec bases et réglages distincts ; production en HTTPS.
- **Mode démonstration des emails** : sans domaine payant, Resend n'écrit qu'à l'adresse d'Abraham ; c'est assumé, affiché et à documenter (passage en vraie production : vérifier un domaine, ~10 €/an, sans changer le code).

**Protection des données (contenu de la fiche « protection des données ») :**

| Données | Pourquoi | Durée de conservation |
|---|---|---|
| Demandeurs : nom, email, téléphone, société, contenu de la demande | Traiter la demande | Durée réglée (2 ans par défaut) après le dernier passage à Traitée, puis purge |
| Membres de l'équipe : nom, email, rôle | Connexion et traçabilité | Tant que le compte existe ; le nom reste dans les historiques |
| Adresse IP des visiteurs | Anti-spam | 1 heure |
| Journal | Sécurité et suivi | 1 an |
| Sauvegardes | Restauration | 30 jours |

Rien d'autre n'est collecté (pas de suivi publicitaire) ; information sous le formulaire public et orale pour la saisie interne ; droit à l'effacement via l'écran d'administration ; données de test uniquement fictives et retirées de la production avant l'ouverture ; hébergement dans l'UE. Les sauvegardes contenant des données effacées disparaissent d'elles-mêmes au bout de 30 jours ; si une sauvegarde plus ancienne que l'effacement est restaurée, l'effacement est refait.

## Technical Decisions

**Stack d'exploitation (0 €) :** Netlify Free (Node 22), deux projets Supabase Free en Irlande (`eu-west-1`), Sentry Developer (région UE, `@sentry/nextjs` 11.10, 5 000 erreurs/mois, 1 utilisateur), GitHub + Actions (dépôt public). Pas de Docker sur le PC : pas de Supabase local ; exports et restaurations se font dans GitHub Actions. Fichiers de tâches dans `.github/workflows/` (tests, sauvegarde et nettoyage nocturnes, réveil, restauration de test) ; documentation dans `docs/` (exploitation, support, sécurité, carnet d'usage de l'IA).

**Limites des offres gratuites à connaître (et à documenter) :**
- Netlify : 300 crédits par mois (15 par mise en ligne). **Au-delà, le site est coupé** jusqu'au mois suivant. Parade : AD-11 ; plan B : offre payante.
- Supabase : 500 Mo par projet ; pause après 7 jours sans activité (évitée par la tâche de réveil) ; pas de sauvegarde (remplacée par AD-12).
- GitHub Actions : les tâches planifiées sont suspendues après 60 jours sans activité sur le dépôt (garder des commits réguliers).

**Variables d'environnement :** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `EMAILS_AUTORISES`, `HMAC_SECRET`, les variables Sentry, et `NEXT_PUBLIC_APP_VERSION` injectée au build. Elles sont **toutes listées dans `.env.example`, sans valeur** (AD-9). Les secrets des tâches GitHub (connexion à la production par le pooler, phrase de chiffrement) sont des **secrets GitHub**, jamais dans le dépôt.

### Règles d'architecture (texte d'origine)

**AD-9 — Secrets et environnements séparés [ADOPTÉ]**
- Deux projets Supabase (dev, prod), région Irlande (`eu-west-1`, Union européenne).
- On utilise les **nouvelles clés** Supabase : `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY`. Les anciennes clés `anon` et `service_role` sont désactivées.
- Les clés sont dans `.env.local` (exclu de Git) en développement et dans les variables Netlify en production.
- Les clés secrètes, Resend et le secret HMAC ne sont lus que dans `lib/server/`.
- Une recherche automatique de secrets tourne à chaque envoi de code.

**AD-11 — Versions, mise en ligne et retour arrière [ADOPTÉ]**
- `main` est la production et elle est protégée : on n'y fusionne que si les tests GitHub sont verts. La commande de build Netlify relance aussi les tests rapides (`npm run verifier && next build`).
- Chaque mise en ligne reçoit une étiquette `vX.Y.Z`, égale à la version de `package.json`, injectée au build dans `NEXT_PUBLIC_APP_VERSION` et affichée en bas de page. Une sauvegarde est lancée juste avant.
- **Crédits Netlify Free** : 300 par mois, 15 par mise en ligne en production. On groupe donc les mises en ligne (10 par mois au maximum) et on vérifie les crédits chaque semaine. Plan B : l'offre payante de Netlify.
- Retour arrière : « Publish deploy » sur la version précédente, possible pendant 30 jours sur l'offre Free. `NETLIFY_NEXT_SKEW_PROTECTION=true`.

**AD-12 — Sauvegardes et restauration hors de Supabase [ADOPTÉ]**
- **Chaque nuit**, une tâche GitHub Actions se connecte à la production par le **pooler en mode session** et exporte trois fichiers : rôles, structure, et données y compris les comptes (`--data-only --use-copy`). Elle les chiffre avec une phrase secrète (secret GitHub) et les garde 30 jours.
- La même tâche peut être lancée à la main avant une mise en ligne.
- La **restauration de test** se fait dans GitHub Actions vers le projet de développement, puis on y appelle `rejouer_effacements()`. Le projet dev est remis à ses données fictives après l'essai.
- Une tâche quotidienne interroge les deux projets pour éviter leur mise en pause.

**AD-14 — Pas de donnée personnelle dans les outils de suivi**
- L'organisation Sentry est créée dans la **région UE**.
- Configuration obligatoire : `dataCollection: { userInfo: false, cookies: false, httpBodies: [] }`, pas de *Session Replay*, `beforeSend` qui retire `request.data` et les paramètres d'URL, pas de `setUser`, alerte par email sur une nouvelle erreur. Un test vérifie ces options.
- Le journal cite les membres, jamais les demandeurs.
- Les IP et emails des tentatives sont enregistrés en **empreintes HMAC**, avec un secret serveur. L'IP est lue uniquement dans l'en-tête Netlify `x-nf-client-connection-ip`.

**AD-7 — Une seule forme de résultat (lien avec Sentry)** : les actions serveur renvoient `{ ok: true, donnees } | { ok: false, code, message }` via `lib/server/appeler.ts` ; aucune exception ne remonte jusqu'à l'écran. Les erreurs imprévues vont dans Sentry, sans donnée personnelle ; l'écran affiche « Le serveur ne répond pas… » avec « Réessayer ».

**AD-15 — Fonctions SQL verrouillées (pour `purger_technique`)**
- Chaque fonction `SECURITY DEFINER` déclare `SET search_path = ''`, nomme ses tables avec leur schéma et vérifie le droit **en première instruction**.
- `EXECUTE` est retiré à tous, puis accordé fonction par fonction : à `authenticated` pour les fonctions de l'espace équipe, à `service_role` seulement pour `deposer_demande`, `noter_resultat_email`, `creer_membre`, `purger_technique` et `rejouer_effacements`.
- Les utilitaires (`est_admin`, `ecrire_historique`, `ecrire_journal`…) sont dans le schéma `prive`, non exposé.
- Un test liste les fonctions exécutables par chaque rôle et le compare à la liste attendue.

**AD-23 — Conservation et nettoyages**
- Durée de conservation : `duree_conservation_mois` (6 à 60), comparée à `traitee_le`.
- `purger_expirees` est lancée par un administrateur.
- `purger_technique` est lancée chaque nuit par GitHub Actions. Elle efface les empreintes d'IP de plus d'une heure, les tentatives de connexion de plus d'un jour et le journal de plus d'un an.
- `deposer_demande` efface aussi au passage les empreintes de plus d'une heure.

**AD-5 (extrait)** : seules suppressions permises dans `historique`, `notes`, `journal` : l'effacement complet d'une demande (`effacer_demandeur`, `purger_expirees`) et la purge du journal au-delà d'un an (`purger_technique`).

**AD-10 — Migrations** : toute modification de structure (dont `purger_technique`) est un fichier daté dans `supabase/migrations/`, appliqué en dev puis en prod avec `supabase db push`. On ajoute d'abord, on retire à la version suivante.

**AD-27 (extrait)** : les tests refusent de démarrer si l'adresse Supabase est celle de la production ; les données créées par les tests portent le préfixe `TEST-` et sont effacées à la fin.

**AD-28 (pour la page de test d'erreur)** : `proxy.ts` renvoie vers `/connexion?retour=…` toute adresse `/equipe/*` sans session ; `app/equipe/layout.tsx` vérifie le membre actif ; `app/equipe/admin/layout.tsx` vérifie le rôle administrateur ; les actions revérifient elles-mêmes (AD-1). La page de test d'erreur, réservée à l'administrateur, doit donc vivre sous `/equipe/admin/`.

**AD-30 — Registre des effacements** : `effacer_demandeur` inscrit les références effacées dans `effacements` (sans autre donnée). Après toute restauration, `rejouer_effacements()` efface à nouveau ces références (à décrire dans la maintenance).

**Conventions :** commits en français, au présent (« Ajoute … (story 3.2) ») ; tests rangés par story (`tests/story-3-2/…`), noms en français ; messages en vouvoiement.

## Cross-Story Dependencies

- 3.1 précède tout : projet Supabase de production, site Netlify, variables Netlify, protection de `main`, version `v1.0.0`. La sauvegarde (3.2) et Sentry (3.3) visent la production créée en 3.1.
- 3.2 fournit les sauvegardes que 3.4 restaure ; 3.4 crée `effacements` et `rejouer_effacements` (l'essai est refait après la story 5.4).
- 3.3 s'appuie sur `lib/server/appeler.ts` (AD-7) et sur les gardes admin de la story 1.4.
- 3.6 reprend les procédures écrites en 3.4 (`docs/exploitation/restauration.md`) et 3.5 (`docs/exploitation/retour-arriere.md`) et le carnet d'usage de l'IA créé en 1.1 ; la fiche d'indisponibilité renvoie à la saisie interne (story 2.6), au retour arrière (3.5) et à la restauration (3.4). Les documents sont relus et complétés à la fin du projet.
