# Epic 1 Context: Recevoir les demandes et les voir au même endroit

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Un client ou un prospect de Nova Services dépose sa demande en ligne, sans compte, et reçoit aussitôt une référence `NOVA-AAAA-NNNN` (à l'écran puis par email). L'équipe se connecte à un espace sécurisé, voit toutes les demandes dans une seule liste avec leur statut, et ouvre leur détail. C'est la priorité absolue d'Abraham : à la fin de cet epic, l'application remplace déjà les fichiers recopiés à la main. L'epic pose aussi le socle (projet, dépôt, sécurité de la base, tests) sur lequel tous les epics suivants s'appuient.

## Stories

- Story 1.1 : Installer le socle du projet
- Story 1.2 : Afficher le formulaire de dépôt
- Story 1.3 : Envoyer ma demande et recevoir ma référence
- Story 1.4 : Me connecter à l'espace équipe
- Story 1.5 : Voir toutes les demandes avec leur statut
- Story 1.6 : Ouvrir le détail d'une demande
- Story 1.7 : Recevoir l'email de confirmation
- Story 1.8 : Bloquer les envois en masse
- Story 1.9 : Sécuriser la connexion

## Requirements & Constraints

- **Dépôt public sans compte** : nom, email, objet, catégorie (actives seulement), description obligatoires ; téléphone et société facultatifs. Longueurs max : 150 caractères (nom, société, objet), 5 000 (description). Erreurs sous le champ, saisie jamais perdue.
- **Consentement** : case obligatoire ; phrase d'information dont la durée (2 ans par défaut) et l'email de contact viennent des paramètres.
- **Enregistrement** : canal `formulaire`, statut `nouvelle`, priorité `normale`, sans responsable, ligne d'historique `creation`. Double clic = une seule demande ; deux envois simultanés = deux références distinctes. Numéro remis à 1 chaque année, s'allonge au-delà de 9 999.
- **Confirmation** : affiche seulement référence, objet et contact (jamais nom, email ni description), valable 24 h via un jeton aléatoire ; au-delà : « Cette page n'est plus disponible. ».
- **Email de confirmation** : référence, objet, date, contact, sans description. Un échec ne fait jamais échouer le dépôt ; il est noté sur la demande et au journal.
- **Anti-spam** : 5 envois max en 10 minutes par IP, vérifié côté serveur (même hors page) ; champ piège invisible ; IP gardée au plus 1 h, en empreinte HMAC.
- **Connexion** : email + mot de passe, pas d'inscription libre. Message d'échec qui ne révèle pas si l'email existe (même message pour compte désactivé). Blocage 15 min après 5 échecs ; session fermée après 8 h ; mot de passe ≥ 8 caractères.
- **Droits** : visiteur ne lit rien en base ; collaborateur et administrateur actifs lisent les demandes ; administration réservée aux admins, refusée côté serveur aussi. Comptes `invite` ou `desactive` : aucun accès.
- **Liste** : plus récentes en premier, 25 par page, statut et priorité lisibles par le texte, état vide explicite.
- **Détail** : tout le contenu tel que saisi ; un `<script>` saisi s'affiche comme du texte.
- **Accessibilité** : chaque écran passe le contrôle axe ; parcours de dépôt faisable au clavier seul et sur téléphone.
- **Règles de livraison** : tous les tests verts avant chaque commit ; commit en français ; une ligne au carnet `docs/carnet-ia.md` par story ; données de test préfixées `TEST-`, jamais en production, jamais le compte d'Abraham ; une story qui ajoute une table ou un état complète `supabase/seed.sql`.

## Technical Decisions

- **Stack** : Next.js 16.4 (Cache Components désactivé), React 19, TypeScript, Supabase (supabase-js 2.118, @supabase/ssr 0.12, région Irlande eu-west-1, UE), Tailwind 4.3, shadcn/ui base Radix (composants enveloppés, jamais modifiés), Zod 4.6, Resend 6.37 sans domaine, Vitest 5.1, Playwright 1.64 + axe. Pas de Docker : les tests tournent contre le projet Supabase de **développement**, et refusent de démarrer sur l'URL de production.
- **Serveur d'abord** : aucun client Supabase dans le navigateur. Lectures par pages serveur (session de l'utilisateur, filtrées par RLS) ; écritures et connexion par actions serveur qui revérifient la session (`getClaims()`), valident avec Zod, appellent **une** fonction SQL via `lib/server/appeler.ts` et renvoient `{ ok: true, donnees } | { ok: false, code, message }`, puis `revalidatePath`.
- **Base = frontière de sécurité** : migration qui retire tous les droits par défaut (y compris `ALTER DEFAULT PRIVILEGES`) à `anon`, `authenticated`, `public`. `anon` n'a aucun droit. `authenticated` n'a que `SELECT` sur les colonnes autorisées, sous RLS via `prive.est_membre_actif()`. Vues en `security_invoker = true`. Test automatique : `anon` ne lit aucune table ni vue.
- **Fonctions SQL** : `SECURITY DEFINER`, `SET search_path = ''`, tables qualifiées par leur schéma, contrôle du droit en première instruction. `EXECUTE` retiré à tous puis accordé nominativement ; `deposer_demande`, `noter_resultat_email`, `creer_membre` réservées à `service_role`. Utilitaires (`est_membre_actif`, `est_admin`, `ecrire_historique`, `ecrire_journal`) dans le schéma `prive`. Test comparant les fonctions exécutables par rôle à la liste attendue.
- **Droits** : rôle et état lus à chaque requête dans `membres` (jamais dans les métadonnées Auth). Comptes créés uniquement via `creer_membre`, y compris par les scripts ; aucun déclencheur sur `auth.users`.
- **Erreurs prévues** : `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>'` (ex. `TROP_D_ENVOIS`) ; codes recopiés dans `lib/erreurs.ts` avec les messages, test de concordance. Erreurs imprévues : bandeau « Le serveur ne répond pas » + « Réessayer ».
- **Codes fermés** (CHECK en base, recopiés une seule fois dans `lib/domaine.ts` avec libellés) : statut `nouvelle|en_cours|traitee` ; priorité `basse|normale|haute` ; canal `formulaire|telephone|email` ; rôle `collaborateur|administrateur` ; état membre `invite|actif|desactive` ; état email `en_attente|envoye|echec|non_envoye_demo|sans_email`. Types d'historique (10) et de journal (`compte`, `parametre`, `categorie`, `donnees`, `email`, `connexion`) également fermés ; valeurs stockées en codes ou identifiants, jamais en libellés.
- **Historique et journal** : ajout seulement, écrits uniquement via `prive.ecrire_historique` / `prive.ecrire_journal`. Le journal ne cite jamais un demandeur.
- **Référence** : fabriquée uniquement par la base, à partir de `compteurs_reference` en verrouillant la ligne de l'année (année à l'heure de Paris). Anti-doublon par `cle_envoi` aléatoire unique créée à l'affichage du formulaire.
- **Dépôt** : l'action `deposer` vérifie dans l'ordre champ piège → Zod → limite d'envois (`envois_formulaire`), puis appelle `deposer_demande` avec la clé secrète ; la fonction purge au passage les empreintes de plus d'1 h. IP lue dans `x-nf-client-connection-ip` (repli en local).
- **Emails** : tous via `lib/server/emails.ts` (Resend). Supabase Auth n'envoie aucun email. Mode démonstration (sans domaine, Resend n'envoie qu'à l'adresse d'Abraham) : seules les adresses de `EMAILS_AUTORISES` reçoivent ; pour les autres, rien n'est envoyé et l'état est `non_envoye_demo` (affiché « Email non envoyé (mode démonstration) »). Une liste vide signifie « personne » ; `EMAILS_AUTORISES=*` signifie « toutes les adresses ». Expéditeur lu dans `EMAIL_EXPEDITEUR` (défaut `onboarding@resend.dev`). Le passage en vraie production (domaine vérifié dans Resend, `EMAIL_EXPEDITEUR` sur ce domaine, `EMAILS_AUTORISES=*`) se fait sans changer le code. La fonction SQL renvoie les données de l'email ; l'action envoie **après** l'enregistrement, puis appelle `noter_resultat_email` (`en_attente` → `envoye`, `echec`, `non_envoye_demo` ou `sans_email`).
- **Dates** : `timestamptz` ; un seul déclencheur sur `demandes` gère `mis_a_jour_le` et `traitee_le`. Tout affichage via `lib/format.ts` en `Europe/Paris`, format `03/11/2026 à 09:12`.
- **Emails normalisés** : trim + minuscules par Zod, imposés par `CHECK (email = lower(email))`.
- **Lecture des demandes** : vue `demandes_liste` (nom de catégorie, nom du responsable, colonne de recherche normalisée), lue via `lib/filtres.ts` (tri, pagination, filtres dans l'URL). Pages équipe jamais mises en cache.
- **Gardes** : `proxy.ts` renvoie `/equipe/*` sans session vers `/connexion?retour=…` et déconnecte après 8 h (champ de session donnant l'heure de connexion à confirmer, sinon cookie signé) ; `app/equipe/layout.tsx` vérifie membre actif ; `app/equipe/admin/layout.tsx` vérifie le rôle admin. Retour après connexion seulement si l'adresse commence par `/equipe`. Blocage de connexion via `tentatives_connexion` (empreintes HMAC email et IP), noté au journal.
- **Secrets** : nouvelles clés Supabase (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) ; clé secrète, `RESEND_API_KEY` et `HMAC_SECRET` lus uniquement dans `lib/server/`. Toutes les variables listées sans valeur dans `.env.example` ; `.env.local` exclu de Git ; gitleaks en CI.
- **Structure** : modifications de base uniquement par migrations datées (`supabase/migrations/`). Catégories de départ (Demande d'information, Problème technique, Demande de rendez-vous, Question administrative, Autre) et ligne `parametres` créées par migration. Premier admin via `scripts/premier-admin.ts`.
- **Conventions** : noms métier en français, `snake_case` en base, identifiants `uuid` ; actions dans `lib/actions/demandes.ts` et `lib/actions/comptes.ts` ; schémas Zod dans `lib/schemas/` (partagés écran/action) ; tests rangés par story (`tests/story-1-x/`), sécurité dans `tests/securite/`.

## UX & Interaction Patterns

- **Identité** : bleu marine `#1E3A8A` (survol `#1E40AF`), fond `#F8FAFC`, surfaces blanches bordées `#E2E8F0`, focus `#2563EB`, police unique Inter, coins 6 px (boutons, champs) et 8 px (cartes). Référence en chasse fixe. Un seul bouton principal par écran ; pas de mode sombre.
- **Badges** : statut en pilule (Nouvelle bleu, En cours orange, Traitée vert) ; priorité en rectangle léger (Haute rouge, Normale et Basse gris). Toujours avec le mot.
- **Pages publiques** : colonne centrée de 560 px max, pensée téléphone d'abord ; sur téléphone, bouton d'envoi pleine largeur. Lien discret « Espace équipe » en pied du formulaire.
- **Formulaires** : erreurs sous le champ après envoi (annoncées via `aria-live`), focus sur le premier champ en erreur, mention « (facultatif) », bouton désactivé « Envoi en cours… ». Compteur « 0 / 5 000 » sur la description.
- **Confirmation** : « Votre demande a bien été enregistrée. », référence en grand avec « Copier » (→ « Copié » 2 s), « Un email de confirmation vous a été envoyé. » seulement si envoyé, contact, « Déposer une autre demande ».
- **Espace équipe** : menu latéral bleu marine de 240 px (rubriques existantes seulement, groupe « Administration » pour les admins, nom et rôle + « Se déconnecter » en bas), replié derrière « Menu » sous 1 024 px. Accueil « Bonjour [prénom] » (premier mot du nom).
- **Liste** : tableau complet sur ordinateur ; réduit (référence, objet, statut, priorité, date) sur tablette ; cartes sur téléphone. Ligne entière cliquable, référence en vrai lien. Pagination « 1–25 sur 40 ». 8 lignes squelettes au chargement.
- **Détail** : deux colonnes (une sur téléphone), « ← Retour aux demandes » qui conserve page et filtres, « Reçue le … à … via Formulaire », description avec retours à la ligne, `mailto:`/`tel:`, bandeau si email non parti, historique du plus ancien au plus récent via un composant unique.
- **États communs** : squelettes (jamais d'écran blanc), bandeau « Le serveur ne répond pas. » + « Réessayer », « Vous n'avez pas accès à cette page. » + retour au tableau de bord, « Demande introuvable. » + lien vers la liste.
- **Ton** : vouvoiement, phrases courtes, pas d'emoji ni de point d'exclamation dans les erreurs ; textes exacts tirés d'EXPERIENCE.md.
- **Accessibilité** : focus toujours visible, libellés visibles, zones de 44 × 44 px sur téléphone, ordre de tabulation = ordre visuel, champ piège ignoré par les lecteurs d'écran et hors du parcours clavier.

## Cross-Story Dependencies

- Ordre strict : chaque story ne dépend que des précédentes. 1.1 fournit le verrouillage des droits, `prive`, `appeler.ts`, `domaine.ts`, `erreurs.ts`, `format.ts`, la CI et le carnet IA, utilisés partout.
- 1.2 crée `categories`, `parametres` et `infos_publiques()` → utilisés par 1.3 (formulaire) et 1.7 (contact dans l'email).
- 1.3 crée `demandes`, `compteurs_reference`, `historique`, `prive.ecrire_historique` et l'action `deposer` → étendue par 1.7 (envoi d'email) et 1.8 (piège + limite) ; lue par 1.5 et 1.6.
- 1.4 crée `membres`, `est_membre_actif`/`est_admin`, `creer_membre`, les comptes de test, `proxy.ts` et l'action `connexion` → prérequis de 1.5, 1.6 et étendus par 1.9 (blocage, limite de 8 h).
- 1.5 crée `supabase/seed.sql` (≈ 40 demandes `TEST-`) et `lib/filtres.ts`, que les stories suivantes complètent ; l'epic 2 (recherche, filtres, tableau de bord) réutilise la même vue et le même constructeur de filtres.
- 1.7 crée la table `journal` et `prive.ecrire_journal`, réutilisés par 1.9 (connexion bloquée) et l'epic 5 (consultation du journal).
- 1.8 : l'en-tête IP Netlify n'est vérifié qu'à la mise en ligne (epic 3, story 3.1).
