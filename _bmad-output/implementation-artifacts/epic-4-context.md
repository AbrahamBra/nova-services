# Epic 4 Context: Gérer l'équipe

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

L'administrateur gère seul les comptes de l'équipe Nova : il invite un nouveau membre (nom, email, rôle) sans jamais connaître son mot de passe, modifie son nom ou son rôle, le désactive quand il part (ses demandes En cours reviennent en Nouvelle) puis peut le réactiver, et renvoie ou annule une invitation. Chaque membre choisit son mot de passe et peut le renouveler s'il l'oublie. En mode démonstration (sans domaine email), les liens d'invitation et de réinitialisation sont affichés à l'administrateur pour qu'il les copie. C'est ce qui garantit que seules les bonnes personnes accèdent aux demandes, sans inscription libre.

## Stories

- Story 4.1 : Inviter un nouveau membre
- Story 4.2 : Modifier, désactiver ou réactiver un compte
- Story 4.3 : Retrouver l'accès en cas de mot de passe oublié
- Story 4.4 : Renvoyer ou annuler une invitation

## Requirements & Constraints

- **Pas d'inscription libre** : seul un administrateur crée un compte. Pages et actions de comptes réservées aux administrateurs actifs ; un collaborateur ne voit pas « Administration », est refusé sur `/equipe/admin/*` et toute action d'administration appelée sans l'écran est refusée par le serveur.
- **États d'un compte** : `invite` → `actif` (au premier mot de passe) ; `actif` ↔ `desactive`. Un compte invité ou désactivé ne lit et n'écrit rien.
- **Invitation** : lien valable 24 h, à usage unique ; l'administrateur ne voit ni ne saisit jamais le mot de passe. Un email déjà utilisé est refusé avec un message sous le champ ; s'il appartient à un compte désactivé, le message propose « Réactiver ce compte ».
- **Mot de passe** : 8 caractères minimum (réglage Supabase + Zod).
- **Mot de passe oublié** : même message affiché que l'email existe ou non ; lien 24 h à usage unique ; un administrateur peut générer ce lien pour un membre actif. Lien déjà utilisé, expiré ou remplacé : « Ce lien n'est plus valable. » (+ bouton pour en demander un nouveau en cas d'oubli, « Contactez votre administrateur. » pour une invitation). L'expiration à 24 h est prouvée par test automatique, pas à l'écran.
- **Désactivation** (règle 7) : s'applique **dès l'action suivante** du compte, même connecté ; le compte ne peut plus se connecter (même message que mot de passe incorrect) ; ses demandes En cours reviennent en Nouvelle sans responsable, avec une ligne d'historique ; son nom reste visible dans les historiques. L'écran annonce avant confirmation combien de demandes vont revenir en Nouvelle. Changement de rôle effectif au prochain chargement de page.
- **Garde-fous administrateur** (règle 8) : un administrateur ne peut ni se désactiver ni changer son propre rôle ; il reste toujours au moins un administrateur **actif** (pas seulement invité), même en cas d'actions simultanées.
- Une demande ne peut pas être attribuée à un compte désactivé ; une demande rouverte dont le responsable est désactivé revient en Nouvelle sans responsable (vérifié ici, en 4.2).
- **Annuler une invitation** : seulement à l'état `invite`. **Renvoyer** : nouveau lien 24 h, l'ancien devient invalide.
- **Journal** (type `compte`) : création, modification, désactivation, réactivation, ex. « Compte créé : Léo Martin (Collaborateur), par [nom] ». Le journal cite les membres, jamais les demandeurs.

## Technical Decisions

- **Supabase Auth n'envoie aucun email** : liens d'invitation et de réinitialisation générés par l'API d'administration (`generateLink`, clé secrète) dans `lib/server/`. Envoi uniquement via `lib/server/emails.ts` (Resend) si l'adresse est dans `EMAILS_AUTORISES`, sinon le lien est affiché à l'administrateur. Un email non envoyé n'annule jamais l'action. Durée de 24 h des liens à régler et vérifier dans Supabase (hypothèse à confirmer).
- **Invitation** : l'action admin (session revérifiée) crée le compte Auth, puis appelle `creer_membre` (existe depuis l'epic 1, `service_role` uniquement ; l'état `actif` à la création est réservé aux scripts). Si `creer_membre` échoue, l'action **supprime le compte Auth** créé. Aucun déclencheur sur `auth.users` ; une seule façon de créer une ligne `membres`.
- **Activation** : `/auth/confirmer` traite le lien côté serveur puis renvoie vers `/nouveau-mot-de-passe` ; au premier mot de passe, `activer_mon_compte()` passe à `actif`. `NEXT_PUBLIC_SITE_URL` sert à fabriquer les liens.
- **Désactiver / réactiver** : fonction SQL d'abord (`desactiver_membre` remet les demandes En cours en Nouvelle + historique `retour_nouvelle`), **puis** blocage ou déblocage dans Auth. `annuler_invitation` supprime le compte Auth et la ligne `membres` (seule suppression de `membres` permise).
- **Concurrence** : `modifier_membre` et `desactiver_membre` prennent `pg_advisory_xact_lock`, refusent si la cible est l'appelant, et lèvent `DERNIER_ADMIN` s'il ne resterait aucun administrateur actif.
- **Nouvelles fonctions** : `activer_mon_compte`, `lister_comptes` (lecture des comptes réservée aux admins ; un collaborateur ne lit dans `membres` que id, nom, état), `modifier_membre`, `desactiver_membre`, `reactiver_membre`, `annuler_invitation`. Toutes `SECURITY DEFINER`, `SET search_path = ''`, droit vérifié en première instruction via `prive.est_admin()` / `prive.est_membre_actif()`, `EXECUTE` accordé nominativement ; mettre à jour le test des fonctions exécutables par rôle. Journal via `prive.ecrire_journal` uniquement.
- **Droits lus à chaque requête** depuis `membres` (rôle jamais stocké dans les métadonnées Auth) : c'est ce qui rend la désactivation et le changement de rôle immédiats.
- **Erreurs prévues** : `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>'` (`DERNIER_ADMIN`, `DROIT_INSUFFISANT`…), codes et messages recopiés dans `lib/erreurs.ts` (test de concordance).
- **Actions** : invitation, comptes, liens générés par l'admin dans `lib/actions/admin.ts` ; mot de passe oublié, choix du mot de passe, activation dans `lib/actions/comptes.ts`. Revérifier la session (`getClaims()`), valider avec Zod (`lib/schemas/`), passer par `lib/server/appeler.ts`, renvoyer `{ ok: true, donnees } | { ok: false, code, message }`, puis `revalidatePath`. Aucun client Supabase dans le navigateur.
- **Codes fermés** (`lib/domaine.ts`) : `role` `collaborateur|administrateur`, `etat` `invite|actif|desactive`. Emails en minuscules sans espaces (Zod + `CHECK (email = lower(email))`).
- Tests rangés par story (`tests/story-4-x/`), comptes `TEST-` uniquement, jamais contre la production ; tests sur trois profils (visiteur, collaborateur, administrateur). Compléter `supabase/seed.sql` pour rendre visibles les états Invité et Désactivé.

## UX & Interaction Patterns

- **Page Comptes** (`/equipe/admin/comptes`, remplace la page admin provisoire) : tableau Nom · Email · Rôle · État (Invité, Actif, Désactivé) · Actions ; bouton « Inviter un membre » ouvrant une fenêtre (Nom, Email, Rôle). Actions par ligne selon l'état : Modifier (nom, rôle) ; Renvoyer / Annuler l'invitation (Invité) ; Générer un lien de mot de passe (Actif) ; Désactiver / Réactiver. Le compte connecté n'a ni « Désactiver » ni changement de rôle. Vide : « Aucun autre compte. Invitez un premier collaborateur. » ; chargement : lignes squelettes.
- **Fenêtre du lien** (mode démonstration) : après invitation, renvoi ou génération, affiche le lien avec « Copier » et rappelle sa validité de 24 h.
- **Fenêtre de confirmation** (réutilisée de l'epic 2) pour désactiver et annuler une invitation : texte précis (« Léo Martin ne pourra plus se connecter. Ses 2 demandes en cours reviendront en Nouvelle, sans responsable. »), « Annuler » à gauche et sélectionné par défaut, bouton destructeur à droite, focus gardé dans la fenêtre.
- **Pages publiques** (`/mot-de-passe-oublie`, `/nouveau-mot-de-passe`) : colonne centrée, logo, formulaire court. Choix du mot de passe : deux champs (mot de passe, confirmation), règle « 8 caractères minimum » affichée ; titre « Bienvenue chez Nova Services, [prénom] » pour une invitation, « Choisissez un nouveau mot de passe » pour un oubli. Lien « Mot de passe oublié » sur la page de connexion. Après activation, arrivée sur l'espace équipe.
- Formulaires : erreurs sous le champ, focus sur le premier en erreur, saisie conservée, « Envoi en cours… » ; toasts après chaque action, erreurs persistantes. Vouvoiement, pas d'emoji ni de point d'exclamation dans les erreurs ; contrôle d'accessibilité automatique sur chaque écran.

## Cross-Story Dependencies

- S'appuie sur l'epic 1 : table `membres`, `prive.est_membre_actif`, `prive.est_admin`, `mon_profil`, `creer_membre`, scripts `premier-admin.ts` et `comptes-de-test.ts`, action `connexion`, `proxy.ts` et gardes `equipe` / `equipe/admin` (1.4) ; blocage après 5 échecs et session de 8 h (1.9) ; `lib/server/emails.ts` (1.7) ; table `journal`.
- S'appuie sur l'epic 2 : fenêtre de confirmation (2.3), `attribuer` et « Rouvrir » (2.3, 2.7), dont les cas « compte désactivé » sont vérifiés en 4.2 ; compteur « À prendre en charge » (2.8) qui augmente après une désactivation.
- 4.1 crée la page Comptes, `/auth/confirmer`, `/nouveau-mot-de-passe` et la fenêtre du lien, réutilisées par 4.2, 4.3 (version réinitialisation) et 4.4.
- La proposition « Réactiver ce compte » à l'invitation d'un email désactivé dépend de `reactiver_membre` (4.2).
- Les lignes de journal écrites ici seront affichées par la consultation du journal (5.1).
