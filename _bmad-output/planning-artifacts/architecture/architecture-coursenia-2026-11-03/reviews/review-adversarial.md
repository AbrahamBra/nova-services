---
title: Revue adverse de l'architecture (spine) — Nova Services
cible: ../architecture.md
contexte: ../../../prds/prd-coursenia-2026-11-03/prd.md
date: 2026-11-03
angle: "Construire deux stories qui respectent chaque AD à la lettre mais ne s'emboîtent pas ; chaque paire = un trou à fermer par un AD nouveau ou durci."
---

# Revue adverse — Nova Services

**Méthode.** Pour chaque trou, on imagine deux stories (unités construites séparément par un agent IA, pour un débutant) qui respectent toutes les AD telles qu'écrites, et qui pourtant produisent un système incompatible ou une fuite de données. Chaque constat propose un AD nouveau ou durci. Le spine n'est pas modifié.

**Bilan :** 3 critiques, 8 hautes, 12 moyennes, 4 basses.

---

## Critiques

### C-1 — Fonctions `SECURITY DEFINER` appelables par tous, sans `search_path`

- **Unités en conflit :** Story « Purge des expirées » (FR-24) écrit `purger_expirees()` en supposant que le contrôle admin est fait par l'action serveur `admin.ts` ; Story « Historique » crée une fonction utilitaire `ecrire_historique(demande_id, type, …)` en `SECURITY DEFINER` pour que les autres fonctions la réutilisent.
- **Le trou :** PostgreSQL donne `EXECUTE` à `PUBLIC` sur toute nouvelle fonction, et Supabase expose toutes les fonctions du schéma `public` via `/rest/v1/rpc/…` avec la clé `anon` (publique par nature, `NEXT_PUBLIC_…`). AD-2 dit « vérifie elle-même le droit » mais n'interdit ni les fonctions utilitaires sans contrôle, ni l'oubli d'un `REVOKE`. Un visiteur appelle `rpc/ecrire_historique` ou `rpc/purger_expirees` directement. Sans `SET search_path`, une fonction `SECURITY DEFINER` peut aussi être détournée par un objet homonyme.
- **Correctif (AD-15 « Surface d'appel de la base ») :**
  1. Toute fonction `SECURITY DEFINER` est déclarée `SET search_path = ''` et qualifie chaque objet (`public.demandes`, `auth.uid()`).
  2. Sa **première instruction** est le contrôle de droit (`if not prive.est_admin() then raise …`), même si l'action serveur l'a déjà fait.
  3. La première migration fait `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated` et `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated` ; chaque fonction métier reçoit un `GRANT EXECUTE` explicite et nominatif.
  4. Les fonctions utilitaires (historique, journal, référence, `est_admin`…) vivent dans un schéma `prive` non exposé par l'API.
  5. Un test automatique (Vitest) liste les fonctions exécutables par `anon` et par `authenticated` et les compare à une liste figée dans le dépôt.

### C-2 — Droits par défaut de Supabase et vues qui contournent RLS

- **Unités en conflit :** Story « Tableau de bord » (FR-19) crée une vue `stats_demandes` ou `demandes_liste` (jointures catégorie + responsable) pour simplifier la page ; Story « Sécurité RLS » a bien activé RLS sur toutes les **tables** (AD-2 satisfait).
- **Le trou :** une vue PostgreSQL s'exécute par défaut avec les droits de son propriétaire et **ignore RLS**. Or Supabase accorde par défaut `SELECT/INSERT/UPDATE/DELETE` à `anon` et `authenticated` sur tout nouvel objet du schéma `public`. Résultat : `GET /rest/v1/demandes_liste` avec la clé publique renvoie toutes les demandes, noms, emails, téléphones. AD-2 parle des tables, pas des vues ni des droits par défaut. Même risque pour une vue matérialisée (pas de RLS possible).
- **Correctif (durcir AD-2) :**
  1. Première migration : `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated` puis `GRANT SELECT` explicite, table par table, uniquement là où une règle RLS `SELECT` existe.
  2. Toute vue est créée `WITH (security_invoker = true)` ; les vues matérialisées sont interdites dans `public`.
  3. Test automatique : avec la clé `anon`, chaque table et vue de `public` renvoie 0 ligne ou une erreur, sauf la liste blanche.

### C-3 — `deposer_demande` appelable directement : anti-spam, piège et IP contournés

- **Unités en conflit :** Story « Formulaire public » (FR-1/FR-2) fait appeler `deposer_demande(…, ip_empreinte)` par l'action serveur avec le client `anon`, conformément au §4.2 (« le visiteur a accès à `deposer_demande` ») ; Story « Anti-spam » (FR-5) compte les envois dans `envois_formulaire` à partir de l'empreinte passée en paramètre, et le champ piège est vérifié par Zod dans l'action.
- **Le trou :** comme la fonction est exécutable par `anon`, n'importe qui l'appelle en direct (`/rpc/deposer_demande`) avec une empreinte différente à chaque appel et sans champ piège : la limite de 5 envois / 10 minutes et le piège sont contournés, et les limites Zod aussi si la base ne les porte pas toutes. FR-5 exige explicitement qu'un « envoi direct, sans passer par la page » soit bloqué. Même problème pour la fonction qui note le résultat de l'email (voir H-8) : appelable par `anon`, elle permet de modifier l'état d'email de n'importe quelle demande.
- **Correctif (AD-16 « Dépôt public par le serveur uniquement ») :** `deposer_demande` et `noter_resultat_email` ne sont exécutables **que** par `service_role`. L'action `deposer` les appelle via un client serveur dédié de `lib/server/` (seul usage de la clé de service hors module admin, documenté). L'action calcule l'empreinte (voir M-6), vérifie le piège et Zod ; la fonction refait les contrôles de longueur, de consentement et de limite. `anon` n'a plus **aucune** fonction exécutable. Test : un appel `rpc/deposer_demande` avec la clé `anon` échoue.

---

## Hautes

### H-1 — Deux propriétaires de la ligne `membres` et de son passage à `actif`

- **Unités en conflit :** Story « Inviter un membre » (FR-8) insère la ligne `membres` depuis le module admin avec la clé de service, après `inviteUserByEmail` ; Story « Choisir un mot de passe » (FR-7/FR-8) ajoute un déclencheur sur `auth.users` qui crée ou met à jour `membres` (état `actif`) quand le mot de passe est posé. Variante : une story crée la ligne par un déclencheur `after insert on auth.users`, avec un nom et un rôle vides.
- **Le trou :** §4.1 dit « le module admin crée … la ligne `membres` », ce qui contredit AD-2/AD-4 (toute écriture passe par une fonction qui écrit aussi le journal). Le passage `invite → actif` n'a pas de propriétaire. En plus, une fonction appelée avec la clé de service voit `auth.uid() = null`, donc `est_admin()` refuse, ou alors la story retire le contrôle « parce que c'est le serveur ». On obtient un doublon de clé, une ligne sans rôle, ou un journal sans auteur.
- **Correctif (AD-17 « Cycle de vie d'un compte ») :**
  - Aucun déclencheur sur `auth.users`.
  - Invitation : l'action `comptes.inviter` vérifie Zod, puis le module admin crée l'utilisateur Auth, puis l'action appelle **avec la session de l'administrateur** `inviter_membre(id, nom, email, role)`, qui vérifie `est_admin()`, insère `membres` en `invite` et écrit le journal. Si la fonction échoue, le module admin supprime l'utilisateur Auth créé.
  - Activation : `activer_mon_compte()`, exécutable par `authenticated`, ne touche que `auth.uid()` et seulement si l'état est `invite`. Elle est appelée par l'action « Choisir un mot de passe ».
  - Règle générale : les fonctions SQL sont **toujours** appelées avec le client de session de l'utilisateur ; le client de service ne sert qu'à `auth.admin.*` (et au cas C-3).
  - Ordre des opérations Auth et base pour désactiver ou réactiver : base d'abord (`desactiver_membre`), Auth ensuite (blocage). Si l'appel Auth échoue, on renvoie le code `AUTH_NON_SYNCHRONISE` et on écrit une ligne de journal. Les droits sont déjà coupés par AD-3.
  - `membres` n'est jamais supprimé (`ON DELETE RESTRICT` depuis `historique`, `notes`, `demandes`). « Annuler une invitation » supprime l'utilisateur Auth et la ligne `membres` seulement si l'état est `invite`.

### H-2 — Valeurs des listes fermées non fixées (statut, priorité, canal, état d'email)

- **Unités en conflit :** Story « Dépôt » écrit `CHECK (statut IN ('Nouvelle','En cours','Traitée'))` et Zod `z.enum(['Nouvelle',…])` ; Story « Filtres » (FR-12) utilise `?statut=en_cours` et compare à `'en_cours'` ; Story « Saisie » écrit le canal `'téléphone'` (avec accent) alors que la base attend `'telephone'`.
- **Le trou :** AD-8 impose que les listes soient des contraintes de la base, mais n'en fixe pas les **valeurs**. Les accents, les majuscules et les espaces divergent entre SQL, Zod, l'URL et l'affichage.
- **Correctif (AD-18 « Vocabulaire du domaine ») :** valeurs stockées en ASCII, minuscules, `snake_case` :
  - `statut` : `nouvelle | en_cours | traitee`
  - `priorite` : `basse | normale | haute`
  - `canal` : `formulaire | telephone | email`
  - `membres.role` : `collaborateur | administrateur` ; `membres.etat` : `invite | actif | desactive`
  - `email_confirmation` : `en_attente | envoye | echec | sans_email`

  En base : `text` + `CHECK`. Côté code : un seul fichier `lib/domaine.ts` avec des tableaux `as const` et leurs libellés français (`{ en_cours: 'En cours' }`). Zod les importe (`z.enum(STATUTS)`), les paramètres d'URL utilisent les mêmes valeurs, et les types sont générés par `supabase gen types`. Les écrans n'affichent que les libellés.

### H-3 — Forme et vocabulaire de l'historique libres

- **Unités en conflit :** Story « Prise en charge » écrit `type='prise_en_charge', ancienne='Nouvelle', nouvelle='En cours'` et met le nom du responsable dans `nouvelle` ; Story « Attribution » écrit `type='ATTRIBUTION', nouvelle=<uuid du membre>` ; Story « Note » copie le texte de la note dans `nouvelle` (donnée personnelle en double) ; Story « Catégorie » n'écrit rien, car la règle 6 ne cite pas la catégorie alors qu'AD-4 liste `changer_categorie`. Le composant d'affichage de l'historique ne peut pas tout rendre.
- **Le trou :** §3 dit seulement « type d'événement, ancienne et nouvelle valeur ». Le format des valeurs (libellé, code ou identifiant), l'auteur « Demandeur » (auteur nul ?) et le canal de la création ne sont pas fixés.
- **Correctif (AD-19 « Contrat de l'historique ») :**
  - `type` est une liste fermée `CHECK` : `creation`, `prise_en_charge`, `attribution`, `liberation`, `changement_statut`, `classement_sans_suite`, `reouverture_sans_responsable`, `retour_nouvelle_desactivation`, `changement_priorite`, `changement_categorie`, `note_ajoutee`.
  - `ancienne_valeur` et `nouvelle_valeur` stockent des **codes** (valeurs d'AD-18) ou des **uuid** (catégorie, membre), jamais un libellé ni un texte libre. Ce sont les écrans qui traduisent.
  - `auteur_id` est nul seulement pour `creation` par formulaire. `canal` est la nouvelle valeur de `creation`.
  - `note_ajoutee` ne recopie pas le texte.
  - Une seule fonction `prive.ecrire_historique(...)` et un seul composant `components/historique.tsx` avec une table de rendu exhaustive (un test vérifie que chaque `type` a un rendu).

### H-4 — Comment une fonction SQL signale une erreur prévue

- **Unités en conflit :** Story « Prise en charge » fait `RAISE EXCEPTION 'DEJA_PRISE'` ; Story « Statut » renvoie `jsonb {ok:false, code:'PASSAGE_INTERDIT'}` sans exception ; Story « Catégories » laisse remonter la violation d'unicité `23505` et l'action affiche « Le serveur ne répond pas » (et l'envoie à Sentry comme erreur imprévue).
- **Le trou :** AD-7 ne couvre que la frontière entre l'action et l'écran. Le contrat entre la base et l'action n'est pas fixé, ni la façon de transmettre le nom affiché dans « Déjà prise en charge par… ». Les codes ne sont pas normés.
- **Correctif (AD-20 « Contrat base → action ») :**
  - Une erreur prévue est **toujours** `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>', DETAIL = '<json facultatif>'`. `<CODE>` est en `MAJUSCULES_SNAKE` et fait partie d'une liste fermée, recopiée dans `lib/erreurs.ts` (`DEJA_PRISE`, `PASSAGE_INTERDIT`, `NOTE_OBLIGATOIRE`, `DERNIERE_CATEGORIE`, `NOM_DEJA_PRIS`, `DERNIER_ADMIN`, `TROP_D_ENVOIS`, `NON_AUTORISE`, `INTROUVABLE`…).
  - Les contraintes d'unicité ou `CHECK` qui peuvent arriver en usage normal sont testées dans la fonction **avant** l'écriture, pour lever un code connu.
  - Un seul utilitaire `lib/server/appeler.ts` appelle la fonction et transforme le résultat : code connu → `{ok:false, code, message}` ; autre cas → `INATTENDUE` + Sentry.
  - En cas de succès, les fonctions renvoient un `jsonb` documenté (par exemple `deposer_demande → {id, reference}`).
  - Un test vérifie que chaque code levé dans `supabase/migrations` existe dans `lib/erreurs.ts`.

### H-5 — Lecture des noms des membres par un collaborateur, et récursion RLS

- **Unités en conflit :** Story « Comptes » (FR-8) pose sur `membres` une règle `SELECT using (est_admin())`, conforme au §4.2 (« comptes : administrateur ») ; Story « Liste des demandes » (FR-11) affiche le responsable via `select('*, responsable:membres(nom)')`. Pour un collaborateur, le nom revient `null` : la liste et l'historique sont vides de noms, alors que les tests faits avec un compte admin passent. Variante : `est_admin()` écrit en `SECURITY INVOKER` lit `membres`, dont la règle appelle `est_admin()` : erreur « infinite recursion detected in policy ».
- **Le trou :** le spine ne dit pas comment un collaborateur lit le nom des autres membres sans lire leurs emails, et ne fixe pas la nature des fonctions de droit d'AD-3.
- **Correctif (durcir AD-3) :** `prive.est_membre_actif()` et `prive.est_admin()` sont `SECURITY DEFINER STABLE SET search_path = ''`, basées sur `auth.uid()`, avec `EXECUTE` pour `authenticated` seulement. Sur `membres` : règle `SELECT using (prive.est_membre_actif())` avec des droits par colonne (`GRANT SELECT (id, nom, etat) ON membres TO authenticated`). L'email et le rôle ne sont lus que par la fonction `lister_comptes()`, réservée aux administrateurs. Chaque test RLS est joué avec trois profils : visiteur, collaborateur, administrateur.

### H-6 — Connexion depuis le navigateur ou par le serveur : blocage et journal impossibles

- **Unités en conflit :** Story « Connexion » (FR-6) suit AD-1 à la lettre : `signInWithPassword` dans le navigateur avec `@supabase/ssr` ; Story « Blocage après 5 échecs » (NFR-9) suit l'hypothèse §10-3 (« sinon on l'applique dans l'action de connexion ») et la Story « Journal » (OPS-2) doit noter les « connexions bloquées ».
- **Le trou :** si la connexion se fait dans le navigateur, aucun code serveur ne voit les échecs. On ne peut donc ni compter les échecs, ni bloquer, ni écrire au journal, et un attaquant appelle Auth directement. Supabase Auth ne propose pas de blocage par compte (seulement des limites par IP), et la limite de durée de session (« time-box ») est réservée à une offre payante (à vérifier). Les deux stories sont incompatibles.
- **Correctif (remplacer la phrase d'AD-1 et l'hypothèse §10-3) :** la connexion passe par une action serveur `comptes.seConnecter` (client serveur `@supabase/ssr` avec cookies) ; le navigateur n'instancie jamais de client Supabase. Une table `tentatives_connexion` (empreinte de l'email, date), écrite par une fonction réservée à `service_role`, permet de bloquer au-delà de 5 échecs en 15 minutes, avec le code `CONNEXION_BLOQUEE` et une ligne de journal `connexion_bloquee`. La limite de 8 heures est vérifiée par le `middleware` à partir de la date de connexion de la session (`auth.sessions` ou `iat` du jeton).

### H-7 — Une seule durée de validité des liens Supabase pour l'invitation (7 jours) et le mot de passe (1 heure)

- **Unités en conflit :** Story « Mot de passe oublié » (FR-7) règle l'expiration des liens Supabase à 3 600 s ; Story « Invitation » (FR-8) la règle à 604 800 s pour tenir 7 jours.
- **Le trou :** dans Supabase Auth, ce réglage est **commun** à tous les liens envoyés par email. La seconde story casse la première, et aucun AD ne dit qui possède ce réglage.
- **Correctif (AD-21 « Liens d'email ») :** la durée de Supabase est fixée à 1 heure (FR-7). L'invitation de 7 jours est portée par l'application : table `invitations` (empreinte du jeton, `membre_id`, `expire_le = now() + 7 jours`, `utilisee_le`), écrite par `inviter_membre` et `renvoyer_invitation`. L'email (Resend) pointe vers `/invitation/[jeton]` ; l'action serveur vérifie le jeton, puis demande au module admin un lien Supabase neuf (`generateLink`) et redirige vers « Choisir un mot de passe ». Tous les réglages Auth sont recopiés dans `docs/exploitation/reglages-supabase.md`, avec les valeurs de dev et de prod.

### H-8 — Qui envoie l'email de confirmation et qui note son résultat

- **Unités en conflit :** Story « Dépôt » envoie l'email dans `lib/actions/demandes.ts` avec son propre modèle et note `envoye` par un `update` direct avec la clé de service ; Story « Saisie » (FR-25) écrit un autre modèle et passe par `saisir_demande(…, email_envoye boolean)` en envoyant l'email **avant** l'enregistrement. Le contact de Nova (FR-3) est lu de deux façons différentes.
- **Le trou :** AD-13 dit « envoyé par l'action serveur après l'enregistrement », mais ne fixe ni le module unique d'envoi, ni la fonction qui note le résultat, ni sa valeur initiale, ni ce qui se passe si le serveur s'arrête entre les deux étapes. AD-2 interdit l'`update` direct, mais aucune fonction n'est listée pour le faire.
- **Correctif (durcir AD-13) :**
  - Un seul module `lib/server/emails.ts` avec `envoyerConfirmation(donnees)`, qui contient le seul modèle.
  - `deposer_demande` et `saisir_demande` renvoient tout ce que l'email demande (référence, objet, email, date de création, nom et email de contact lus dans `parametres`) : aucune lecture supplémentaire.
  - La colonne `email_confirmation` vaut `en_attente` par défaut (`sans_email` si aucun email n'est saisi).
  - Le résultat est noté par `noter_resultat_email(demande_id, resultat)`, exécutable par `service_role` (voie publique) et par les membres actifs (voie de saisie), uniquement depuis l'état `en_attente`. Elle écrit `email_echec` au journal avec la seule référence.
  - L'écran de détail affiche « Email de confirmation non envoyé » pour `echec`, et aussi pour `en_attente` au-delà de 10 minutes.

---

## Moyennes

### M-1 — Propriétaire de `traitee_le` et de `mis_a_jour_le`

- **Unités :** `changer_statut` met `traitee_le = now()` ; `classer_sans_suite` l'oublie ; la réouverture (Traitée → En cours) le remet à `null` dans une story et le garde dans une autre. La purge (FR-24) filtre sur `traitee_le` et ignore donc les demandes classées sans suite, ou bien utilise `coalesce(traitee_le, cree_le)` et efface trop tôt.
- **Correctif (AD-22) :** un seul déclencheur `BEFORE UPDATE` sur `demandes` : `mis_a_jour_le = now()` à chaque modification ; `traitee_le = now()` quand le statut **devient** `traitee`, valeur conservée sinon. Les fonctions n'écrivent jamais ces colonnes. La purge cible `statut = 'traitee' AND traitee_le < now() - durée` (une demande rouverte n'a plus le statut `traitee`, donc elle n'est pas purgée).

### M-2 — Unité de la durée de conservation, et qui lance les purges techniques

- **Unités :** Story « Paramètres » stocke `duree_conservation` en mois (Zod 6 à 60) ; Story « Purge » l'interprète en jours, ou en `interval` texte. Le nettoyage de `envois_formulaire` (1 heure) et la purge du `journal` (1 an) n'ont pas de propriétaire : pas de `pg_cron` prévu, rien dans GitHub Actions.
- **Correctif (AD-23) :** colonne `duree_conservation_mois integer CHECK (BETWEEN 6 AND 60)`, valeur par défaut 24, comparée avec `make_interval(months => …)`. `deposer_demande` supprime les lignes `envois_formulaire` de plus d'une heure à chaque appel. Une fonction `purger_technique()` (journal de plus d'un an, `tentatives_connexion`, `invitations` expirées), réservée à `service_role`, est appelée par la tâche GitHub Actions de chaque nuit.

### M-3 — Fuseau horaire : année de la référence et affichage

- **Unités :** `deposer_demande` calcule l'année avec `extract(year from now())`, en temps universel : une demande déposée le 01/01/2027 à 00:30 (heure de Paris) reçoit `NOVA-2026-…` et la date « 01/01/2027 ». Côté écran, Netlify tourne en temps universel : `toLocaleString('fr-FR')` sans fuseau affiche l'heure UTC dans une story et l'heure de Paris dans une autre (composant client).
- **Correctif (AD-24) :** l'année de la référence est `extract(year from now() at time zone 'Europe/Paris')`. Toute date est formatée par une seule fonction `lib/format.ts` (`Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' })`, format `03/11/2026 à 09:12`), appelée côté serveur. Les calculs de durée (purge, expirations) se font en base avec `now()`.

### M-4 — Plusieurs chemins de lecture pour la liste, la recherche et le tableau de bord

- **Unités :** Story « Liste » lit `demandes` avec `.ilike('nom', …)` ; Story « Recherche » (FR-12, sans tenir compte des accents) crée une fonction `rechercher_demandes()` avec `unaccent` ; Story « Tableau de bord » compte avec une vue ou une requête à part. Le critère FR-19 (« la liste filtrée contient exactement ce nombre ») échoue dès que les filtres divergent, par exemple sur « Non traitées » ou sur les demandes sans responsable dont le compte est désactivé.
- **Correctif (AD-25 « Un seul chemin de lecture des demandes ») :** une vue `demandes_liste` (`security_invoker = true`) qui expose une colonne `recherche` normalisée (fonction `IMMUTABLE` qui enveloppe `unaccent(lower(…))`, avec un index trigramme). Un seul constructeur de requête `lib/lectures/demandes.ts` (`filtresVersRequete(filtres)`) sert à la liste, à la pagination (25 par page), au compteur du menu et à chaque chiffre du tableau de bord (`count: 'exact', head: true`). Les liens du tableau de bord sont fabriqués à partir des mêmes objets de filtre.

### M-5 — Double clic sur « Envoyer » : aucun mécanisme fixé

- **Unités :** Story « Formulaire » désactive le bouton ; Story « Tests » envoie deux requêtes identiques directement au serveur et attend une seule demande (FR-2).
- **Correctif (AD-26) :** le formulaire génère un `cle_envoi uuid` à l'ouverture. La colonne `demandes.cle_envoi` est `UNIQUE`. `deposer_demande` et `saisir_demande` renvoient la demande existante quand la clé est déjà connue, sans nouvelle référence ni nouvel email.

### M-6 — Adresse IP sur Netlify : quel en-tête, quelle empreinte

- **Unités :** une story lit le premier élément de `x-forwarded-for` (que le client peut falsifier) ; une autre lit `x-real-ip`. Une story calcule `sha256(ip)` (réversible par force brute sur l'espace IPv4) ; une autre l'empreinte en base. En local, l'en-tête est absent et tous les envois partagent la même empreinte vide.
- **Correctif (préciser AD-14 et FR-5) :** lire uniquement `x-nf-client-connection-ip` (fourni par Netlify). S'il est absent, utiliser la valeur `inconnue`, qui a sa propre limite. Empreinte = HMAC-SHA256(ip, `ANTISPAM_SECRET`), calculée dans `lib/server/antispam.ts`. Le secret change chaque mois (pas besoin de le garder plus d'une heure).

### M-7 — Données de départ, premier administrateur et tests sur la base partagée

- **Unités :** Story « Catégories » met les 5 catégories de départ dans `seed.sql`, qui n'est pas appliqué en production : la prod n'a aucune catégorie et le formulaire est inutilisable. Aucune story ne crée le **premier** administrateur de prod. Les tests de deux stories, joués sur le même projet de développement (§10-1), désactivent le seul administrateur fictif, renomment « Autre » ou consomment le compteur de références d'un autre test.
- **Correctif (AD-27 « Données de départ et tests ») :**
  - Les catégories de départ et la ligne unique de `parametres` sont insérées **par migration** (`parametres` a une contrainte de ligne unique, par exemple `id boolean PRIMARY KEY DEFAULT true CHECK (id)`).
  - `seed.sql` (dev uniquement) contient des comptes fictifs à uuid fixes (`admin.test@`, `collab.test@`, `desactive.test@`) que les tests ne modifient jamais.
  - Chaque test crée ses propres membres, catégories et demandes, préfixés `test-<story>-<aléa>`, et les supprime après.
  - Les assertions sur la référence vérifient le format et l'unicité, jamais la valeur.
  - Un script documenté `scripts/creer-premier-admin.ts` (clé de service, lancé à la main) crée le premier administrateur de prod.
  - Les tests refusent de démarrer si l'URL Supabase ne contient pas l'identifiant du projet de dev.

### M-8 — Garde-fous administrateur en concurrence, et fonctions de comptes absentes de la liste

- **Unités :** deux administrateurs se rétrogradent l'un l'autre au même moment. Chaque fonction vérifie qu'il « reste au moins un admin actif », voit l'autre, valide, et il ne reste plus aucun administrateur (règle 8). Par ailleurs, `modifier_membre`, `reactiver_membre`, `annuler_invitation`, `ajouter_categorie`, `modifier_parametres`… ne sont pas dans la liste d'AD-4 : une story peut les écrire en `update` direct depuis le module admin.
- **Correctif (durcir AD-4) :** compléter la liste fermée des fonctions (comptes, catégories, paramètres, invitation, activation, résultat d'email). Toute fonction qui change un rôle ou un état prend d'abord `pg_advisory_xact_lock(hashtext('admins'))`, puis vérifie la règle 8.

### M-9 — Emails non normalisés : unicité et effacement RGPD incomplets

- **Unités :** Story « Invitation » vérifie l'unicité avec `membres.email = $1` alors qu'Auth met l'email en minuscules : « Leo@nova.fr » passe à côté du compte désactivé « leo@nova.fr » (FR-8). Story « Effacement » (FR-22) cherche `demandes.email = 'sophie@x.fr'` et oublie « Sophie@X.fr » : l'effacement est partiel.
- **Correctif (AD-8 durci) :** tout schéma Zod d'email applique `.trim().toLowerCase()` ; la base porte `CHECK (email = lower(btrim(email)))` sur `membres.email` et `demandes.email`, plus un index `UNIQUE` sur `membres.email`.

### M-10 — Classement sans suite : note et statut en deux appels

- **Unités :** Story « Statut » implémente le classement sans suite comme `ajouter_note()` puis `changer_statut()` depuis l'action ; Story « Tests serveur » appelle `classer_sans_suite(id)` sans note et attend `NOTE_OBLIGATOIRE`. Si le second appel échoue, la note reste sans changement de statut.
- **Correctif (AD-4 précisé) :** `classer_sans_suite(demande_id, texte_note)` insère la note et change le statut dans la même transaction, et écrit deux lignes d'historique (`note_ajoutee` puis `classement_sans_suite`). `changer_statut` refuse le passage `nouvelle → traitee`.

### M-11 — Lecture publique de `categories` et `parametres` par des règles RLS de table

- **Unités :** Story « Formulaire » ajoute une règle `SELECT` pour `anon` sur `parametres` afin d'afficher le contact et la durée (FR-4). Une story plus tard ajoute à `parametres` une colonne interne (par exemple un email d'alerte) : elle devient publique, car RLS filtre des lignes et pas des colonnes.
- **Correctif (AD-2 précisé) :** aucune règle RLS pour `anon` sur les tables. La page publique lit une fonction `infos_publiques()` qui renvoie `{ categories_actives: [{id, nom}], contact_nom, contact_email, duree_conservation_mois }`, exécutable par `anon` (seule exception de lecture d'AD-15), ou bien par le serveur avec `service_role` si l'on préfère que `anon` ne puisse rien appeler.

### M-12 — Vocabulaire du journal libre, et « connexions bloquées » sans auteur

- **Unités :** Story « Comptes » écrit `type='compte_cree'` ; Story « Catégories » écrit `'Catégorie ajoutée'` ; Story « Purge » écrit `'PURGE'`. Le filtre par type (FR-26) n'a pas de liste stable. Les descriptions mélangent noms affichés et uuid.
- **Correctif (AD-19 étendu au journal) :** `journal.type` est une liste fermée `CHECK` (`compte_cree`, `compte_modifie`, `compte_desactive`, `compte_reactive`, `invitation_renvoyee`, `invitation_annulee`, `parametres_modifies`, `categorie_ajoutee`, `categorie_modifiee`, `effacement_rgpd`, `purge_expirees`, `email_echec`, `connexion_bloquee`, `auth_non_synchronise`). Colonnes `auteur_id`, `cible_membre_id`, `nombre`, `reference` (jamais de nom ni d'email de demandeur). La phrase est fabriquée à l'affichage. Une seule fonction `prive.ecrire_journal(...)`.

---

## Basses

### B-1 — Injection du numéro de version

- **Unités :** Story « Pied de page » importe `package.json` dans un composant client ; Story « Mise en ligne » lit `process.env.npm_package_version`, qui est indéfini à l'exécution sur Netlify. L'étiquette Git et `package.json` peuvent diverger.
- **Correctif (AD-11 précisé) :** `next.config.ts` expose `NEXT_PUBLIC_APP_VERSION` à partir de `package.json` au moment du build. Le pied de page ne lit que cette variable. Un contrôle dans GitHub Actions sur les étiquettes `v*` vérifie que l'étiquette égale `v` + la version de `package.json`.

### B-2 — Sentry : réglages anti-données personnelles non fixés

- **Unités :** l'assistant d'installation Sentry active le rejeu de session ou le traçage, qui capturent des champs de formulaire et des en-têtes (IP). Une autre story ajoute `Sentry.setUser({email})`.
- **Correctif (AD-14 précisé) :** `sendDefaultPii: false`, pas de rejeu de session, `beforeSend` et `beforeBreadcrumb` qui suppriment `request.data`, `cookies` et les en-têtes, et aucun `setUser`. Le seul contexte autorisé est `{ ecran, code, reference }`.

### B-3 — Répartition des actions entre `comptes.ts` et `admin.ts`

- **Unités :** l'invitation est écrite dans `lib/actions/comptes.ts` par une story et dans `lib/actions/admin.ts` par une autre ; la ressemblance avec `lib/server/admin.ts` entretient la confusion.
- **Correctif (§6 précisé) :** `comptes.ts` = connexion, mot de passe, activation de son propre compte ; `admin.ts` = invitation et gestion des membres, catégories, paramètres, effacement, purge ; `demandes.ts` = dépôt, saisie et traitement. Renommer le module de service en `lib/server/supabase-service.ts`.

### B-4 — Unicité des noms de catégorie

- **Unités :** « Autre » et « autre », ou « Problème technique » et « Probleme technique », coexistent si l'unicité porte sur `nom` brut, et la réactivation (FR-20) ne détecte pas le doublon.
- **Correctif :** index `UNIQUE` sur `prive.normaliser(nom)` (minuscules, sans accent, espaces réduits) ; Zod applique `trim`. Le code `NOM_DEJA_PRIS` est levé par la fonction avant l'écriture (AD-20).
