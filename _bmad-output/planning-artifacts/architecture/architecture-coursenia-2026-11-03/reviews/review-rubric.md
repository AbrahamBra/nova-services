---
title: Revue « rubrique et couverture » — architecture Nova Services
cible: ../architecture.md
sources: [PRD prd-coursenia-2026-11-03, EXPERIENCE.md, DESIGN.md, .memlog.md]
date: 2026-11-03
verdict: À corriger avant de découper les stories (1 critique, 8 hautes)
---

# Revue rubrique et couverture — architecture.md

## Verdict

La colonne vertébrale est **saine et lisible** : le principe « serveur d'abord, sécurité dans la base », les fonctions SQL par action (AD-4), la forme unique des résultats (AD-7) et les migrations additives (AD-10) ferment bien les points de divergence principaux du traitement des demandes. La stack, les coûts et les environnements sont décidés.

En revanche, plusieurs **mécanismes exigés par le PRD n'ont pas de propriétaire** (tâches planifiées de purge, verrouillage après 5 échecs, durée de session, activation des invités, garde-fous administrateur, refaire les effacements après une restauration). Et une faille de conception permet de **contourner la limite anti-spam** en appelant directement la base. Il faut corriger ces points avant d'écrire les stories, sinon deux stories trancheront chacune à sa façon.

| Sévérité | Nombre |
|---|---|
| Critique | 1 |
| Haute | 8 |
| Moyenne | 11 |
| Basse | 8 |

Légende : **critique** = faille de sécurité ou exigence impossible à tenir telle quelle ; **haute** = mécanisme exigé sans propriétaire, ou deux stories divergeront sûrement ; **moyenne** = divergence probable ou règle peu vérifiable ; **basse** = précision ou cohérence de document.

---

## 1. Constats

### C1 — critique — La limite anti-spam et le champ piège se contournent en appelant la base directement

- **Où :** AD-2 (« Le visiteur n'a accès qu'à `deposer_demande` »), §4.2, §9 ligne FR-1 à FR-5, AD-14.
- **Problème :** la clé publique Supabase (`anon`) est forcément dans le navigateur (AD-1 : le client navigateur sert à la connexion). Si `deposer_demande` est exécutable par le rôle `anon`, n'importe qui peut l'appeler directement par l'API Supabase, **sans passer par l'action serveur**. Or c'est l'action serveur qui connaît l'adresse IP et le champ piège. Résultat : la limite « 5 envois en 10 minutes » et le piège sont contournés, et l'empreinte d'IP passée en paramètre peut être inventée. Le PRD exige l'inverse (FR-5 : « un envoi direct, sans passer par la page, est aussi bloqué »). Même problème pour la fonction qui notera l'état de l'email de confirmation (voir M2) : appelable par `anon`, elle permettrait de modifier l'état de n'importe quelle demande.
- **Correction proposée :** ajouter une règle à AD-2 : « Aucune fonction n'est exécutable par `anon` (`REVOKE EXECUTE … FROM anon, public`). Le dépôt public est appelé par l'action serveur avec un client serveur dédié (`lib/server/`), qui transmet l'empreinte d'IP calculée côté serveur ; `deposer_demande` vérifie elle-même la limite dans `envois_formulaire` dans la même transaction. » Mettre à jour §2 (le module admin n'est alors plus la seule brique à utiliser la clé de service, ou créer un rôle Postgres dédié au dépôt). Ajouter un test automatique : appel direct de `deposer_demande` avec la clé `anon` → refusé.

### H1 — haute — Verrouillage après 5 échecs, déconnexion après 8 h et journal des connexions bloquées : sans mécanisme réel

- **Où :** §4.1 (« réglages de Supabase Auth, NFR-9 »), §10 hypothèse 3, AD-1.
- **Problème :** l'offre gratuite de Supabase ne propose pas de verrouillage d'un compte après N échecs (seulement des limites de débit par adresse IP), et la limitation de durée de session (« time-box ») est réservée aux offres payantes (à confirmer, mais c'est la documentation connue). Le repli de l'hypothèse 3 (« on les applique dans l'action de connexion ») est **impossible** si la connexion se fait dans le navigateur, comme le dit AD-1. De plus, OPS-2 exige de journaliser les « connexions bloquées » : sans connexion côté serveur, personne ne peut l'écrire. Le message « Trop de tentatives. Réessayez dans 15 minutes » (EXPERIENCE §5) et « compte désactivé : même message que mot de passe incorrect » n'ont pas non plus de propriétaire.
- **Correction proposée :** nouvelle AD « Connexion par action serveur » : la connexion passe par une action serveur (`lib/actions/comptes.ts`, `signInWithPassword` côté serveur avec `@supabase/ssr`) ; une table `tentatives_connexion` (email en minuscules, date) et une fonction `noter_echec_connexion` décident du blocage de 15 minutes et écrivent le journal ; les erreurs Supabase (mauvais mot de passe, compte bloqué) sont traduites en un seul message. Durée de 8 h : vérifiée par le middleware à partir de l'heure de connexion (champ `amr`/horodatage de la session ou cookie signé), qui déconnecte au-delà. AD-1 devient plus simple : **le navigateur n'utilise jamais Supabase**.

### H2 — haute — Liens d'invitation (7 jours) et de mot de passe (1 heure) : un seul réglage Supabase, et activation non définie

- **Où :** §4.1 « Invitation », AD-13 ; PRD FR-7, FR-8 ; EXPERIENCE §9.7, §9.12.
- **Problème :** dans Supabase Auth, la durée de validité des liens envoyés par email est **un seul réglage** pour tous les liens, plafonné à 24 heures (à vérifier dans la console). On ne peut donc pas avoir à la fois 1 heure (FR-7) et 7 jours (FR-8). Par ailleurs : (a) qui fait passer `membres.etat` de `invite` à `actif` « au premier mot de passe choisi » n'est pas dit (déclencheur sur `auth.users` ? action de la page `/nouveau-mot-de-passe` ?) ; (b) « Renvoyer » et « Annuler l'invitation » n'ont ni fonction ni règle (supprime-t-on la ligne `membres` et le compte Auth ?) ; (c) comment l'écran sait qu'une invitation est « expirée » ; (d) la route qui reçoit le lien de l'email (échange du jeton, par ex. `app/auth/confirm/route.ts`) n'apparaît pas dans l'arborescence §7.
- **Correction proposée :** trancher dans le spine, soit (1) **écart assumé** : liens valables 24 h pour les deux, et la PRD est ajustée (FR-8 : « Renvoyer » est le cas normal), soit (2) régler Supabase sur 1 h et gérer l'invitation avec une table `invitations` (jeton aléatoire, expiration 7 jours) et une page qui fixe le mot de passe via le module admin. Dans les deux cas, ajouter : fonction `activer_membre()` appelée par l'action de `/nouveau-mot-de-passe` ; fonction `annuler_invitation` (supprime la ligne `membres` et le compte Auth, journalise) ; route `auth/confirm` dans §7.

### H3 — haute — Les tâches planifiées de purge n'ont pas de propriétaire

- **Où :** §3 (`journal` « purge au-delà d'un an », `envois_formulaire` « effacé au-delà d'une heure »), AD-5, AD-14, §11 (« Détail des fichiers de tâches GitHub Actions »).
- **Problème :** le spine affirme ces deux purges mais ne dit ni **qui** les lance, ni **quand**, ni **quelle fonction** les fait. Une story pourrait purger `envois_formulaire` à chaque dépôt (et alors, sans dépôt, les empreintes restent plus d'une heure, contraire à FR-5 et au §8 du PRD) ; une autre pourrait l'ajouter à la sauvegarde nocturne (24 h au lieu d'1 h). Le journal à 1 an n'a aucune story naturelle.
- **Correction proposée :** ajouter une ligne « Tâches planifiées » au spine : extension `pg_cron` de Supabase (disponible sur l'offre gratuite, à vérifier) avec deux tâches : `purger_envois_formulaire()` toutes les 10 minutes (efface > 1 h) et `purger_journal()` chaque nuit (efface > 1 an). Solution de repli : la tâche GitHub Actions toutes les heures. Ajouter ces deux fonctions au catalogue AD-4 et une exception explicite dans AD-5.

### H4 — haute — La page de confirmation ne peut pas lire la demande, et les références se devinent

- **Où :** AD-2 (« le visiteur n'a accès qu'à … catégories actives et contact »), EXPERIENCE §2.1 `/confirmation/[référence]`, §5, §9.2.
- **Problème :** la page affiche la référence, **l'objet** et le contact (EXPERIENCE §2.1), et doit dire « Cette page n'est plus disponible » si la référence n'existe pas. Mais un visiteur ne peut rien lire (AD-2) : la story devra soit ouvrir une lecture `anon` sur `demandes` (faille), soit inventer autre chose. De plus, les références sont **séquentielles** : en essayant `NOVA-2026-0001`, `0002`… on lirait les objets de toutes les demandes, et un objet peut contenir des données personnelles. Enfin, EXPERIENCE se contredit : §5 affiche « Un email de confirmation vous a été envoyé à … » (avec l'adresse) alors que §2.1 interdit d'afficher les coordonnées.
- **Correction proposée :** décider : l'action de dépôt renvoie la référence et l'objet, et la page de confirmation les lit dans un **cookie temporaire signé** (ou un jeton aléatoire dans l'adresse, `/confirmation/[jeton]`) ; sans cookie valide → « Cette page n'est plus disponible ». Aucune lecture `anon` de `demandes`. Retenir le texte sans adresse email (§9.2) et signaler l'incohérence à l'UX.

### H5 — haute — Qui protège les pages internes n'est pas décidé (middleware, gardes de mise en page)

- **Où :** AD-1, AD-3, §7 ; PRD FR-6, FR-9, FR-10 ; EXPERIENCE §5 « Accès refusé ».
- **Problème :** la RLS protège les données, mais l'écran doit aussi : renvoyer vers `/connexion` puis revenir à la page demandée ; afficher « Vous n'avez pas accès à cette page » à un collaborateur sur `/equipe/admin/*` ; refuser un membre désactivé « dès l'action suivante » au lieu de lui montrer des pages vides. Le spine ne dit pas où ce contrôle vit. Une story le mettra dans `middleware.ts`, une autre dans chaque page, une troisième s'appuiera sur la RLS seule. `@supabase/ssr` exige aussi un middleware pour rafraîchir la session : il n'est pas mentionné.
- **Correction proposée :** nouvelle AD « Gardes d'accès des pages » : `middleware.ts` rafraîchit la session et renvoie vers `/connexion?retour=…` sans session ; `app/equipe/layout.tsx` appelle `est_membre_actif()` (sinon déconnexion + connexion) ; `app/equipe/admin/layout.tsx` appelle `est_admin()` (sinon page « Accès refusé »). Les actions serveur restent protégées par les fonctions SQL (défense en profondeur).

### H6 — haute — Impossible de refaire les effacements RGPD après une restauration

- **Où :** AD-12, AD-14, §3 `journal` ; PRD FR-22, OPS-4.
- **Problème :** OPS-4 exige de « refaire les effacements RGPD postérieurs à la sauvegarde ». Mais le journal ne garde que « 3 demandes effacées par Claire », sans email (AD-14). Après la restauration d'une sauvegarde plus ancienne, **personne ne sait quelles demandes réeffacer**.
- **Correction proposée :** ajouter une table `effacements` (références effacées, date, type : effacement ou purge), sans aucune coordonnée, écrite par `effacer_demandeur` et `purger_expirees`, et une fonction `rejouer_effacements(depuis)` utilisée par la procédure de restauration. Les références seules ne permettent pas d'identifier la personne une fois la demande effacée. Décider sa durée de conservation (par exemple 30 jours + marge, comme les sauvegardes).

### H7 — haute — Restaurer la production dans le projet de développement y met de vraies données personnelles

- **Où :** AD-12 (« La restauration se fait d'abord dans le projet de développement »), §8, §10 hypothèse 1.
- **Problème :** le projet de développement sert aux tests automatiques et aux **prévisualisations Netlify publiques**. Y restaurer la production met des données réelles là où le PRD (§8) n'autorise que des données fictives, écrase les comptes de test (schéma `auth`), et casse les tests. L'offre gratuite ne permet que 2 projets actifs, donc pas de 3e projet permanent.
- **Correction proposée :** écrire la règle : « Essai de restauration : on met en pause le projet dev (ou on en crée un temporaire après avoir mis dev en pause), on restaure, on compte les demandes, puis on supprime le projet temporaire / on remet dev à zéro avec `seed.sql`. Prévisualisations Netlify désactivées pendant l'essai. » Ajouter cette contrainte à §8.

### H8 — haute — Les garde-fous administrateur (règle 8) ne sont portés par aucune règle

- **Où :** AD-3, AD-4, §9 ligne FR-8/FR-9 ; PRD règle 8, FR-9.
- **Problème :** « ne pas désactiver son propre compte, ne pas retirer son propre rôle, toujours au moins un administrateur **actif** » n'apparaît nulle part. Si la story « Comptes » le fait à l'écran seulement, un appel direct le contourne. Et deux administrateurs qui se désactivent l'un l'autre au même instant peuvent laisser zéro administrateur.
- **Correction proposée :** ajouter à AD-4 : « `desactiver_membre` et `modifier_membre` vérifient la règle 8 en verrouillant les lignes administrateurs (`SELECT … FOR UPDATE`) ; codes d'erreur `SOI_MEME` et `DERNIER_ADMIN` dans `lib/erreurs.ts`. » Test automatique de la course.

### M1 — moyenne — Le catalogue des fonctions SQL se termine par « … »

- **Où :** AD-4.
- **Problème :** la liste laisse les stories inventer noms et périmètre. Manquent notamment : `modifier_membre` (nom, rôle), `reactiver_membre`, `activer_membre`, `annuler_invitation`, `ajouter_categorie`, `renommer_categorie`, `changer_etat_categorie`, `modifier_parametres`, `noter_envoi_email`, `purger_journal`, `purger_envois_formulaire`. La réactivation (FR-9) et la proposition « Réactiver ce compte » (FR-8) n'ont pas de règle : un compte réactivé redevient-il `actif` ou `invite` ? qui lève le blocage Auth ?
- **Correction proposée :** remplacer « … » par la liste complète, une ligne par fonction : qui peut l'appeler, ce qu'elle journalise. Pour la réactivation : `reactiver_membre` remet `actif` puis le module admin lève le blocage Auth.

### M2 — moyenne — L'état de l'email de confirmation et son échec au journal : qui écrit ?

- **Où :** §4.3, AD-13, §9 ligne FR-25.
- **Problème :** l'action serveur envoie l'email **après** la fonction SQL ; elle doit ensuite noter `envoye`/`echec` sur la demande et écrire le journal en cas d'échec. Or AD-2 interdit toute écriture directe : il faut une fonction (non citée). Pour le dépôt public, cette fonction ne doit pas être accessible à `anon` (voir C1). La ligne FR-25 de §9 ne cite ni Resend ni AD-13, alors que FR-25 exige l'email si une adresse est saisie.
- **Correction proposée :** fonction `noter_envoi_email(demande_id, etat)` appelée seulement côté serveur ; compléter la ligne FR-25 de §9 avec « Resend, AD-13 ».

### M3 — moyenne — Les chiffres du tableau de bord et la liste filtrée peuvent diverger

- **Où :** §2 « Pages serveur », §9 lignes FR-11/12 et FR-19 ; PRD FR-19 (« la liste filtrée contient exactement ce nombre »).
- **Problème :** la story « tableau de bord » écrira ses comptages, la story « liste » ses filtres. « Non traitées », « Sans responsable », « Priorité Haute non traitées » risquent d'être codés deux fois de façon différente. Idem pour le compteur du menu.
- **Correction proposée :** un seul module `lib/requetes/demandes.ts` (ou une vue SQL) qui traduit les filtres de l'adresse en requête, utilisé pour la liste **et** pour chaque chiffre ; chaque carte du tableau de bord est définie par l'ensemble de filtres de son lien.

### M4 — moyenne — Historique : valeur copiée ou lien ? (renommage de catégorie, noms des membres)

- **Où :** §3 `historique` (« ancienne et nouvelle valeur »), AD-5 ; PRD règle 9, règle 7.
- **Problème :** si l'historique copie le **texte** de la catégorie, un renommage ne s'y voit pas (alors que la règle 9 dit « change son nom partout ») ; s'il garde l'identifiant, l'affichage est à jour. Pas tranché : deux stories écriront deux formats. Même question pour l'auteur (lien vers `membres`, conservé à la désactivation) et pour l'effacement (pas de suppression de membre).
- **Correction proposée :** décider : l'historique garde les **identifiants** (catégorie, responsable, auteur) et des valeurs fermées pour statut/priorité ; l'affichage résout les noms. Le renommage lui-même va au journal (OPS-2), pas dans l'historique des demandes.

### M5 — moyenne — AD-14 (pas de donnée personnelle dans Sentry) n'est pas vérifiable en l'état

- **Où :** AD-14, §1 Sentry ; PRD OPS-1.
- **Problème :** l'assistant d'installation Sentry pour Next.js active souvent l'enregistrement de session (« Replay ») et peut joindre les corps de requête. La règle ne dit pas quels réglages appliquer, ni quelle alerte doit prévenir le responsable technique (OPS-1 : visible en moins de 5 minutes).
- **Correction proposée :** écrire les réglages : `sendDefaultPii: false`, Replay désactivé, `beforeSend` qui retire corps de requête, cookies et en-têtes ; règle d'alerte email « nouvelle erreur » dans Sentry ; test : une erreur volontaire contenant une adresse email n'apparaît pas en clair.

### M6 — moyenne — Tests et intégration continue : stratégie incomplète

- **Où :** §1 Vitest/Playwright, §6 « Tests », §10 hypothèse 1 ; PRD NFR-8, NFR-1.
- **Problème :** non décidé : (a) remise à zéro des données de test sur le projet dev partagé (le développeur, la CI et les prévisualisations écrivent dans la même base) ; (b) comptes de test et leurs mots de passe dans les secrets GitHub ; (c) Playwright vise-t-il `next start` dans la CI ou une prévisualisation Netlify ? (d) **Netlify publie `main` même si les tests GitHub échouent** : rien n'empêche une mise en ligne avec tests en échec (NFR-8) ; (e) les tests de sécurité NFR-1 sont transverses et ne rentrent pas dans « rangés par story ».
- **Correction proposée :** ajouter une ligne « Tests » : chaque test crée ses propres données préfixées (`TEST-…`) et les supprime ; comptes de test créés par `seed.sql` ; Playwright contre `next build && next start` dans la CI ; protection de la branche `main` (fusion par pull request seulement, tests obligatoires) ; dossier `tests/securite/` pour NFR-1.

### M7 — moyenne — Régions de traitement hors Supabase non décidées (Netlify, Resend, Sentry)

- **Où :** §1, §8 ; PRD §8 « Hébergement dans l'UE si l'offre gratuite le permet ».
- **Problème :** seule la base est à Paris. Les fonctions serveur Netlify tournent par défaut aux États-Unis (à vérifier), comme Resend et Sentry par défaut. Les données des demandeurs y transitent. Effet secondaire : chaque page fait plusieurs allers-retours États-Unis ↔ Paris, ce qui menace NFR-7 (2 secondes).
- **Correction proposée :** décider et noter : Sentry organisation en région UE ; Resend domaine en région UE ; région des fonctions Netlify en Europe si l'offre gratuite le permet, sinon l'écrire comme écart accepté dans `docs/` (protection des données).

### M8 — moyenne — Mise à jour des écrans après une action : pas de convention

- **Où :** §2, §11 « Mise en cache et optimisation » ; EXPERIENCE §4 (panneau d'actions « sans recharger la page »), §4 compteur du menu.
- **Problème :** le compteur du menu, la liste et l'historique doivent se mettre à jour après une action. Sans convention, une story rafraîchira la page, une autre la seule ligne, une troisième oubliera le compteur du menu. Reporter « la mise en cache » laisse aussi les réglages de cache de Next.js par défaut, qui peuvent afficher des données périmées.
- **Correction proposée :** convention : toute page `equipe/` est dynamique (pas de cache) ; toute action sur une demande appelle `revalidatePath('/equipe', 'layout')`. Retirer ce point de « laissé pour plus tard » ou préciser que seule l'optimisation est reportée.

### M9 — moyenne — Empreinte de l'adresse IP : comment la calculer

- **Où :** AD-14, §3 `envois_formulaire`.
- **Problème :** une empreinte simple (SHA-256) d'une adresse IPv4 se retrouve en quelques minutes en essayant toutes les adresses : ce n'est pas une protection. L'en-tête qui donne l'IP réelle derrière Netlify n'est pas précisé (les en-têtes `x-forwarded-for` se falsifient).
- **Correction proposée :** empreinte HMAC-SHA-256 avec un secret serveur (`IP_SECRET`, variable d'environnement, jamais `NEXT_PUBLIC_`) ; IP lue dans l'en-tête fourni par Netlify (`x-nf-client-connection-ip`, à vérifier) ; calcul dans `lib/server/`.

### M10 — moyenne — Sauvegarde : stockage, et arrêt silencieux de la tâche planifiée

- **Où :** AD-12, §8, §11 « Détail des fichiers de tâches GitHub Actions ».
- **Problème :** (a) où sont gardées les sauvegardes 30 jours (artefacts GitHub ? une branche ? un stockage externe ?) n'est pas dit : sur un dépôt public, les artefacts sont téléchargeables par d'autres utilisateurs GitHub, donc le chiffrement doit être solide ; (b) GitHub **désactive les tâches planifiées d'un dépôt public après 60 jours sans activité** : sauvegarde arrêtée et projet prod mis en pause ; (c) le projet **dev** se met aussi en pause après 7 jours d'inactivité (tests et prévisualisations cassés).
- **Correction proposée :** préciser : artefacts GitHub avec `retention-days: 30`, chiffrement `gpg --symmetric --cipher-algo AES256`, rien d'affiché dans les journaux de la tâche ; la même tâche fait un appel léger au projet dev ; une alerte email si la tâche échoue ; noter le risque des 60 jours dans la fiche d'exploitation.

### M11 — moyenne — Lecture des paramètres par le visiteur : incomplète et non vérifiable

- **Où :** AD-2 (« contact de `parametres` »), §4.2 ; PRD FR-4, FR-21.
- **Problème :** la mention du formulaire public (FR-4) affiche aussi la **durée de conservation**, que la règle n'autorise pas. Et la RLS filtre des lignes, pas des colonnes : « le contact de `parametres` » ne se traduit pas tel quel en règle RLS.
- **Correction proposée :** le formulaire public est une page serveur qui lit `parametres` côté serveur (aucune lecture `anon`) ; ou une fonction `infos_publiques()` qui renvoie nom, email de contact et durée.

### B1 — basse — Année de la référence : heure de Paris ou temps universel ?

- **Où :** AD-6, §3 dernière ligne. Entre minuit et 1 h (ou 2 h) le 1er janvier, l'année UTC et l'année de Paris diffèrent.
- **Correction :** « l'année de la référence est celle de `now() at time zone 'Europe/Paris'` ».

### B2 — basse — Nombre annoncé et nombre purgé (FR-24)

- **Où :** AD-4 `purger_expirees`. Entre l'affichage et la confirmation, d'autres demandes peuvent expirer ; le critère « le nombre annoncé correspond » peut échouer.
- **Correction :** une seule fonction SQL de critère (`demandes_expirees()`) utilisée pour compter et pour purger ; `purger_expirees(nombre_annonce)` refuse si le nombre a changé.

### B3 — basse — « Dépendances sans faille connue grave » (NFR-9) sans outil

- **Correction :** Dependabot activé sur le dépôt et `npm audit --audit-level=high` dans la CI.

### B4 — basse — Rendre AD-1, AD-9 et l'affichage sans exécution vérifiables par un outil

- **Correction :** `import 'server-only'` en tête de chaque fichier de `lib/server/` et `lib/actions/` ; règle ESLint interdisant `dangerouslySetInnerHTML` et l'import de `@supabase/*` dans les composants `'use client'`.

### B5 — basse — Table de correspondance §9 incomplète

- **Problème :** pas de ligne pour NFR-6 (accessibilité), NFR-7 (rapidité), NFR-9 (sécurité de base), OPS-2 « connexions bloquées », règle 8 ; FR-25 sans AD-13 ; « Confirmation » associée à FR-3 sans mécanisme de lecture (H4).
- **Correction :** compléter la table avec les lignes du tableau de couverture ci-dessous (et, pour NFR-6, un test d'accessibilité automatique avec `@axe-core/playwright`).

### B6 — basse — Adresses de redirection Supabase Auth par environnement

- **Problème :** les liens d'invitation et de mot de passe pointent vers l'« URL du site » réglée dans chaque projet Supabase ; les prévisualisations Netlify ont des adresses variables. Les emails de dev partent aussi par Resend vers des adresses fictives (`example.com`), ce qui génère des rebonds.
- **Correction :** noter les URL autorisées par projet (prod : domaine ; dev : `localhost` + motif des prévisualisations) ; en dev, emails envoyés seulement à l'adresse d'Abraham.

### B7 — basse — Double envoi après une erreur réseau

- **Où :** FR-2 (« un double clic ne crée qu'une seule demande »). Le bouton désactivé couvre le double clic, pas « Réessayer » après une réponse perdue.
- **Correction :** jeton d'unicité généré par le formulaire et contrainte unique en base (facultatif pour le MVP, à décider).

### B8 — basse — Recherche sans accents ni majuscules : mécanisme non fixé

- **Où :** FR-12 (« dupont » trouve « Dupont-Aïdi »), FR-22 (recherche par email).
- **Correction :** extension `unaccent` + `ILIKE` dans une seule fonction de recherche ; emails toujours comparés en minuscules.

---

## 2. Contrôle « bon spine »

| Point de contrôle | Résultat |
|---|---|
| Les vrais points de divergence pour les stories sont fixés | **Partiel.** Bien fixés : écriture (AD-4), résultat (AD-7), validation (AD-8), référence (AD-6), droits (AD-3). Non fixés : connexion (H1), gardes de pages (H5), invitations (H2), requêtes de filtres (M3), format de l'historique (M4), mise à jour des écrans (M8), page de confirmation (H4). |
| Chaque règle d'AD est vérifiable | **Majoritairement.** AD-14 (M5) et AD-1/AD-9 (B4) gagneraient un réglage ou un outil précis. AD-4 n'est pas fermée (« … », M1). |
| Chaque règle empêche réellement la divergence annoncée | **Non pour AD-2** : la règle « le visiteur a accès à `deposer_demande` » ouvre le contournement de FR-5 (C1). AD-12 « restaurer dans dev » crée un nouveau problème (H7). |
| « Laissé pour plus tard » sans risque de divergence | **Deux lignes à risque :** « Mise en cache » (M8, les réglages par défaut influent sur chaque écran) et « Détail des fichiers GitHub Actions » (M10 et H3 : stockage, chiffrement, tâches planifiées sont des décisions de structure, pas des détails). Les autres (FR-23, temps réel, pièces jointes) sont sans risque. |
| Déploiement et environnements | Décidés (§8, AD-9, AD-11). Manque : régions hors Supabase (M7), URL de redirection Auth (B6). |
| Exploitation | Erreurs (Sentry) et retour arrière décidés ; alerte Sentry (M5) et restauration (H6, H7) à préciser. |
| Tests | Outils décidés ; stratégie de données, protection de `main` et cible Playwright non décidées (M6). |
| Purges et tâches planifiées | **Non décidées** (H3) ; seule la sauvegarde nocturne a un propriétaire. |
| Questions ouvertes du PRD §11 | Toutes les quatre tranchées (Resend, Netlify + Supabase Paris, GitHub Actions, Sentry). |

---

## 3. Contradictions entre le spine et le PRD / l'UX

| # | Spine | PRD / UX | Constat |
|---|---|---|---|
| 1 | AD-2 : le visiteur appelle `deposer_demande` | FR-5 : un envoi direct est bloqué | C1 |
| 2 | AD-1 : connexion dans le navigateur ; §4.1 : réglages Supabase | NFR-9, EXPERIENCE §5 (15 min), OPS-2 (connexions bloquées) | H1 |
| 3 | §4.1 : liens Supabase | FR-7 (1 h) et FR-8 (7 jours) | H2 |
| 4 | AD-2 : le visiteur ne lit rien | EXPERIENCE §2.1 : la confirmation affiche l'objet | H4 |
| 5 | AD-12 : restaurer dans dev | PRD §8 : données de test uniquement fictives | H7 |
| 6 | AD-14 : journal sans donnée de demandeur | OPS-4 : refaire les effacements après restauration | H6 |
| 7 | AD-2 : visiteur lit le « contact » | FR-4 : la mention affiche la durée | M11 |
| 8 | §3 : historique « ancienne et nouvelle valeur » | Règle 9 : renommer change le nom partout | M4 |
| 9 | — (UX interne) | EXPERIENCE §5 affiche l'adresse email sur la confirmation, §2.1 l'interdit | H4, à remonter à l'UX |

---

## 4. Tableau de couverture

Statuts : **Couvert** = brique et règle identifiées ; **Partiel** = brique présente mais un mécanisme exigé n'a pas de propriétaire ; **Manquant** = aucune brique ; **Reporté** = volontairement hors MVP.

### 4.1 Exigences fonctionnelles

| Id | Brique / AD dans le spine | Statut | Écart |
|---|---|---|---|
| FR-1 | Action `deposer`, schéma Zod, AD-8 | Couvert | — |
| FR-2 | `deposer_demande`, AD-6 | Couvert | B1 (année), B7 (renvoi) |
| FR-3 | Resend, AD-13 | Partiel | Écriture de l'état et du journal (M2) |
| FR-4 | Colonne date de consentement ; lecture des paramètres | Partiel | Durée non lisible par le visiteur (M11) |
| FR-5 | `envois_formulaire`, AD-14 | Partiel | Contournement (C1), purge 1 h (H3), empreinte (M9), piège sans propriétaire (C1) |
| FR-6 | Supabase Auth, AD-1, §4.1 | Partiel | Verrouillage (H1), gardes de pages (H5) |
| FR-7 | Supabase Auth + Resend | Partiel | Durée du lien (H2), route `auth/confirm` (H2) |
| FR-8 | Module admin, `membres` | Partiel | 7 jours, renvoyer, annuler, activation invite→actif (H2) |
| FR-9 | `desactiver_membre`, blocage Auth | Partiel | Réactivation et modification sans fonction (M1), règle 8 (H8) |
| FR-10 | RLS, `est_admin()` | Partiel | Refus à l'écran des pages admin (H5) |
| FR-11 | Page serveur, RLS | Couvert | — |
| FR-12 | Page serveur | Partiel | Mécanisme de recherche (B8), filtres partagés (M3) |
| FR-13 | Page serveur | Couvert | Rendu sans exécution à outiller (B4) |
| FR-14 | `prendre_en_charge`, `attribuer`, `liberer`, `DEJA_PRISE` | Couvert | — |
| FR-15 | `changer_statut`, `classer_sans_suite` | Couvert | — |
| FR-16 | `changer_priorite` | Couvert | — |
| FR-17 | `ajouter_note`, AD-5 | Couvert | — |
| FR-18 | `historique`, AD-5 | Couvert | Format des valeurs (M4) |
| FR-19 | Page serveur (comptages) | Partiel | Même définition que la liste (M3), rafraîchissement du compteur (M8) |
| FR-20 | « Actions admin, fonctions dédiées » | Partiel | Fonctions non nommées (M1), unicité du nom insensible à la casse |
| FR-21 | `parametres` | Partiel | Fonction non nommée (M1), bornes 6 mois–5 ans en contrainte de base à écrire |
| FR-22 | `effacer_demandeur`, AD-5 | Couvert | Re-effacement après restauration (H6) |
| FR-23 | §11 | Reporté | Conforme au PRD |
| FR-24 | `purger_expirees`, colonne date de dernier passage à Traitée | Couvert | B2 |
| FR-25 | `saisir_demande`, AD-6 | Partiel | Email de confirmation non relié (M2, B5) |
| FR-26 | Table `journal`, AD-5 | Couvert | Purge 1 an (H3) |
| Règle 8 | — | **Manquant** | H8 |

### 4.2 Exigences de qualité

| Id | Brique / AD | Statut | Écart |
|---|---|---|---|
| NFR-1 | AD-2, AD-3 | Partiel | C1 ; tests de sécurité transverses (M6) |
| NFR-2 | AD-9 | Couvert | B4 (`server-only`) |
| NFR-3 | AD-9, §8 | Couvert | — |
| NFR-4 | AD-11 (version en pied de page) | Couvert | — |
| NFR-5 | AD-10, AD-11 | Couvert | — |
| NFR-6 | UX seulement | Partiel | Aucune vérification prévue (B5) |
| NFR-7 | §11 (mesure avec 2 000 demandes) | Partiel | Latence États-Unis ↔ Paris (M7) |
| NFR-8 | Vitest, Playwright, GitHub Actions | Partiel | Protection de `main`, Netlify publie malgré des tests en échec (M6) |
| NFR-9 | §4.1, §10 hypothèse 3 | Partiel | Verrouillage et 8 h (H1), audit des dépendances (B3) |

### 4.3 Exploitation

| Id | Brique / AD | Statut | Écart |
|---|---|---|---|
| OPS-1 | Sentry, AD-7, AD-14 | Partiel | Réglages et alerte (M5), région (M7) |
| OPS-2 | `journal`, AD-5, AD-14 | Partiel | Connexions bloquées (H1), échec d'email (M2), purge 1 an (H3) |
| OPS-3 | AD-12 | Couvert | Stockage et arrêt après 60 jours (M10) |
| OPS-4 | AD-12 | Partiel | Environnement de restauration (H7), re-effacements (H6) |
| OPS-5 | `docs/` | Couvert | — |
| OPS-6 | `docs/` | Couvert | — |
| OPS-7 | `docs/` (dont carnet IA) | Couvert | — |

### 4.4 Écrans d'EXPERIENCE.md §2

| Écran | Adresse | Brique dans le spine | Statut | Écart |
|---|---|---|---|---|
| Déposer une demande | `/` | Action `deposer`, `deposer_demande` | Partiel | C1, M11 |
| Confirmation | `/confirmation/[référence]` | — (aucune lecture possible) | **Manquant** | H4 |
| Connexion | `/connexion` | Supabase Auth | Partiel | H1 |
| Mot de passe oublié | `/mot-de-passe-oublie` | Supabase Auth + Resend | Couvert | — |
| Choisir un mot de passe | `/nouveau-mot-de-passe` | Supabase Auth | Partiel | H2 (activation, route `auth/confirm`, liens) |
| Tableau de bord | `/equipe` | Page serveur | Partiel | M3 |
| Liste des demandes | `/equipe/demandes` | Page serveur, RLS | Couvert | M3, B8 |
| Détail | `/equipe/demandes/[référence]` | Fonctions de traitement | Couvert | M8 |
| Saisie interne | `/equipe/demandes/nouvelle` | `saisir_demande` | Partiel | M2 |
| Comptes | `/equipe/admin/comptes` | Module admin, `desactiver_membre` | Partiel | H2, H8, M1 |
| Catégories | `/equipe/admin/categories` | « fonctions dédiées » | Partiel | M1 |
| Paramètres | `/equipe/admin/parametres` | « fonctions dédiées » | Partiel | M1 |
| Données personnelles | `/equipe/admin/donnees` | `effacer_demandeur`, `purger_expirees` | Couvert | B2 |
| Journal | `/equipe/admin/journal` | Table `journal` | Couvert | — |
| Éléments communs : compteur du menu, pied de page version, page « Accès refusé » | — | Page serveur, AD-11 | Partiel | H5 (accès refusé, retour à la page demandée), M8 (compteur) |

### 4.5 Mécanismes demandés explicitement

| Mécanisme | Propriétaire dans le spine | Statut |
|---|---|---|
| Purge du journal au-delà d'1 an | Affirmée (§3, AD-5), sans déclencheur | Manquant (H3) |
| Purge de `envois_formulaire` au-delà d'1 h | Affirmée (§3, AD-14), sans déclencheur | Manquant (H3) |
| Purge des demandes expirées | Bouton administrateur, `purger_expirees` (conforme au PRD : déclenchement manuel) | Couvert |
| Email de confirmation pour la saisie interne | AD-13 générale, non reliée à FR-25 | Partiel (M2) |
| Réactivation d'un compte | « débloquer » dans le module admin, sans fonction SQL | Partiel (M1) |
| Renommage de catégorie et historique | Non tranché | Partiel (M4) |
| Affichage de la version | AD-11 | Couvert |
| Limite de débit (5 / 10 min) | `envois_formulaire`, sans lieu d'exécution sûr | Partiel (C1) |
| Empreinte de l'IP | AD-14, sans méthode | Partiel (M9) |
| Déconnexion après 8 h | Réglage Supabase supposé | Manquant sur offre gratuite (H1) |
| Verrouillage après 5 échecs | Réglage Supabase supposé | Manquant (H1) |
| Blocage Auth à la désactivation / déblocage à la réactivation | Module admin | Partiel (ordre et échec partiel non décrits ; M1) |
| Alerte Sentry | « alertes par email » (§1) | Partiel (M5) |
| Environnement d'essai de restauration | Projet dev | Contradictoire (H7) |
| Re-effacements RGPD après restauration | — | Manquant (H6) |
| Garde-fous administrateur (règle 8) | — | Manquant (H8) |
| Annulation et renvoi d'invitation, validité 7 jours | — | Manquant (H2) |
