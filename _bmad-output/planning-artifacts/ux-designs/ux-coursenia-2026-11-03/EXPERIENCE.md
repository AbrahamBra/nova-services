---
name: Nova Services
status: final
created: 2026-11-03
updated: 2026-11-03
sources:
  - ../../prds/prd-coursenia-2026-11-03/prd.md
---

# Nova Services — Expérience

Ce document décrit **comment l'application se comporte** : écrans, contenu, enchaînements, messages et états. L'apparence est dans [DESIGN.md](DESIGN.md). Les exigences (FR, règles) viennent du [PRD](../../prds/prd-coursenia-2026-11-03/prd.md) ; ce document ne les répète pas, il dit comment elles apparaissent à l'écran.

Les hypothèses prises pendant cette étape sont marquées **[HYPOTHÈSE]** et regroupées à la fin (§11).

## 1. Foundation

- **Application web** responsive : une seule application, sur téléphone et ordinateur. Pas d'application à installer.
- **Boîte à composants** : shadcn/ui sur Next.js + Tailwind ; ce document ne précise que les comportements propres à Nova.
- **Deux espaces** : l'**espace public** (sans connexion, pensé d'abord pour le téléphone) et l'**espace équipe** (connexion obligatoire, pensé d'abord pour l'ordinateur).
- **Langue** : français uniquement.

## 2. Information Architecture

### 2.1 Espace public

| Écran | Adresse | Accès depuis | Rôle | PRD |
|---|---|---|---|---|
| Déposer une demande | `/` | Lien donné par Nova (site, signature d'email) | Formulaire public | FR-1, FR-4, FR-5 |
| Confirmation | `/confirmation/[jeton]` (jeton aléatoire, valable 24 h) | Après l'envoi | Preuve d'enregistrement | FR-2, FR-3 |
| Connexion | `/connexion` | Lien discret « Espace équipe » en bas du formulaire | Accès de l'équipe | FR-6 |
| Mot de passe oublié | `/mot-de-passe-oublie` | Lien sur Connexion | Recevoir un lien | FR-7 |
| Choisir un mot de passe | `/nouveau-mot-de-passe` | Lien reçu par email (invitation ou oubli) | Activer le compte ou changer le mot de passe | FR-7, FR-8 |

**[HYPOTHÈSE]** La page de confirmation n'affiche que la référence, l'objet et le contact, jamais les coordonnées : quelqu'un qui devinerait l'adresse ne verrait aucune donnée personnelle.

### 2.2 Espace équipe

Menu latéral, dans cet ordre :

| Menu | Écran | Adresse | Qui | PRD |
|---|---|---|---|---|
| Tableau de bord | Tableau de bord | `/equipe` | Tous | FR-19 |
| Demandes (avec compteur) | Liste des demandes | `/equipe/demandes` | Tous | FR-11, FR-12 |
| — | Détail d'une demande | `/equipe/demandes/[référence]` | Tous | FR-13 à FR-18 |
| Saisir une demande | Saisie interne | `/equipe/demandes/nouvelle` | Tous | FR-25 |
| **Administration** (titre de groupe, admins seulement) | | | | |
| Comptes | Liste et fiche des comptes | `/equipe/admin/comptes` | Admin | FR-8, FR-9 |
| Catégories | Liste des catégories | `/equipe/admin/categories` | Admin | FR-20 |
| Paramètres | Paramètres généraux | `/equipe/admin/parametres` | Admin | FR-21 |
| Données personnelles | Effacement et purge | `/equipe/admin/donnees` | Admin | FR-22, FR-24 |
| Journal | Journal des événements | `/equipe/admin/journal` | Admin | FR-26 |

En bas du menu : le nom du membre connecté, son rôle et le bouton « Se déconnecter ». En bas de chaque page interne : la version (« Version v1.0.0 », NFR-4).

Sous 1 024 px de large, le menu se replie derrière un bouton « Menu » en haut à gauche ; le compteur de nouvelles demandes reste visible à côté de ce bouton.

→ Maquettes : [formulaire public](mockups/key-formulaire-public.html), [liste des demandes](mockups/key-liste-demandes.html), [détail d'une demande](mockups/key-detail-demande.html). En cas de différence, ce document fait foi.

## 3. Voice and Tone

Vouvoiement partout, phrases courtes, pas d'emoji, pas de point d'exclamation dans les messages d'erreur.

| À faire | À éviter |
|---|---|
| « Votre demande a bien été enregistrée. » | « Succès ! 🎉 » |
| « Indiquez votre adresse email. » | « Champ requis » |
| « Cette adresse email ne semble pas valide. » | « Format invalide » |
| « Aucune demande ne correspond à ces filtres. » | « 0 résultat » |
| « Déjà prise en charge par Karim Benali. » | « Conflit de mise à jour » |
| « Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant. » | « Erreur 500 » |
| Boutons : un verbe d'action (« Envoyer ma demande », « Prendre en charge ») | « OK », « Valider » sans complément |

Les dates s'écrivent `03/11/2026 à 09:12`. Les noms des membres s'affichent avec prénom et nom.

## 4. Component Patterns

Comportements ; l'apparence est dans DESIGN.md.Components.

| Composant | Où | Comportement |
|---|---|---|
| Formulaire | Dépôt, saisie, comptes, paramètres | Les erreurs s'affichent sous le champ concerné après l'envoi, puis disparaissent dès qu'on corrige. Le premier champ en erreur reçoit le focus. Les saisies ne sont jamais effacées par une erreur. Les champs facultatifs portent la mention « (facultatif) ». |
| Bouton d'envoi | Tous les formulaires | Pendant l'envoi : désactivé, texte « Envoi en cours… » ; un second clic est sans effet (FR-2). |
| Tableau des demandes | Liste | Une ligne cliquable par demande (toute la ligne ouvre le détail). 25 lignes par page. Sur téléphone, chaque ligne devient une carte : référence, objet, badges, nom et date. |
| Barre de recherche et filtres | Liste | Recherche lancée après 300 ms sans frappe ou à l'appui sur Entrée. Filtres en listes déroulantes : Statut (dont « Non traitées »), Priorité, Catégorie, Canal, Responsable (dont « Sans responsable » et « Mes demandes »). Un bouton « Effacer les filtres » apparaît dès qu'un filtre est actif. Les filtres sont gardés dans l'adresse de la page, pour qu'un retour arrière les conserve. |
| Badges | Liste, détail, tableau de bord | Statut et priorité toujours en toutes lettres. |
| Panneau d'actions | Détail | Colonne de droite (en dessous sur téléphone) : seules les actions permises pour ce statut et ce rôle apparaissent (règle 1 du PRD). Chaque action donne un retour immédiat (toast) et ajoute sa ligne à l'historique sans recharger la page. |
| Fenêtre de confirmation | Désactiver, effacer, purger, classer sans suite | Dit précisément ce qui va se passer (« 3 demandes de jean.dupont@example.com vont être effacées définitivement »). Bouton destructeur à droite, « Annuler » à gauche et sélectionné par défaut. |
| Toast | Après une action | Message court en bas à droite (en haut sur téléphone), disparaît après 5 secondes ; les erreurs restent jusqu'à fermeture. |
| Compteur de nouvelles demandes | Menu | Nombre de demandes Nouvelle sans responsable ; masqué à 0. Mis à jour à chaque chargement de page. |

## 5. State Patterns

États communs à tous les écrans :

| État | Comportement |
|---|---|
| **Chargement** | Squelettes gris (`Skeleton`) à la forme du contenu attendu ; jamais d'écran blanc. Au-delà de 10 secondes : message d'erreur réseau. |
| **Erreur réseau ou serveur** | Bandeau rouge clair en haut du contenu : « Le serveur ne répond pas. » + bouton « Réessayer ». Les saisies en cours sont conservées. |
| **Accès refusé** | Page « Vous n'avez pas accès à cette page. » + bouton « Retour au tableau de bord ». Sans connexion : renvoi vers Connexion, puis retour à la page demandée après connexion. |
| **Introuvable** | « Demande introuvable. Elle a peut-être été effacée. » + lien vers la liste. |

États par écran :

| Écran | Vide | Chargement | Erreur | Complet |
|---|---|---|---|---|
| Formulaire public | Formulaire vierge ; catégories chargées | Squelette des champs pendant le chargement des catégories | Erreurs sous les champs ; erreur serveur en bandeau, saisie conservée ; trop d'envois : « Trop d'envois depuis votre connexion. Réessayez dans quelques minutes. » | Passage à l'écran de confirmation |
| Confirmation | — | — | Référence introuvable : message neutre « Cette page n'est plus disponible. » | « Votre demande a bien été enregistrée. », référence en grand avec « Copier », « Un email de confirmation vous a été envoyé. » (sans afficher l'adresse), contact de Nova, bouton « Déposer une autre demande » |
| Connexion | Champs vides | Bouton « Connexion… » | « Email ou mot de passe incorrect. » ; après 5 échecs : « Trop de tentatives. Réessayez dans 15 minutes. » ; compte désactivé : même message que mot de passe incorrect | Arrivée sur le tableau de bord (ou la page demandée) |
| Tableau de bord | Aucune demande : « Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients. » + bouton « Copier le lien » | Squelettes des 5 cartes chiffrées | Bandeau réseau | 5 cartes chiffrées cliquables |
| Liste des demandes | Sans demande : même message que le tableau de bord. Avec filtres sans résultat : « Aucune demande ne correspond à ces filtres. » + « Effacer les filtres » | 8 lignes squelettes | Bandeau réseau | Tableau paginé |
| Détail | Pas de note : « Aucune note interne. » | Squelette des blocs | Introuvable ; action refusée : toast rouge avec la raison (« Déjà prise en charge par… », « Ce changement de statut n'est pas autorisé. ») | Toutes les sections remplies |
| Saisie interne | Formulaire vierge, canal non choisi | Comme le formulaire public | Comme le formulaire public, sans limite d'envois | Toast « Demande NOVA-2026-0043 enregistrée. » et ouverture de son détail |
| Comptes | « Aucun autre compte. Invitez un premier collaborateur. » | Lignes squelettes | Email déjà utilisé : message sous le champ avec lien « Réactiver ce compte » si désactivé | Liste avec état (Invité, Actif, Désactivé) |
| Catégories | — (au moins une catégorie existe toujours) | Lignes squelettes | Nom en double ; désactiver la dernière active : « Il doit rester au moins une catégorie active. » | Liste avec état actif / désactivé |
| Paramètres | — | Squelettes | Email ou durée hors bornes : sous le champ | Toast « Paramètres enregistrés. » |
| Données personnelles | Recherche sans résultat : « Aucune demande avec cet email. » ; purge : « Aucune demande expirée. » | Squelettes | Bandeau réseau | Liste des demandes trouvées ; nombre de demandes expirées |
| Journal | « Aucun événement. » | Lignes squelettes | Bandeau réseau | Liste paginée, plus récent en premier |

## 6. Interaction Primitives

- **Clavier** : tout est utilisable au clavier (Tab, Entrée, Échap ferme une fenêtre). Ordre de tabulation = ordre visuel.
- **Clic sur une ligne** du tableau = ouvrir le détail ; la référence est aussi un vrai lien (ouvrable dans un nouvel onglet).
- **Retour** : le bouton « ← Retour aux demandes » du détail revient à la liste avec les mêmes filtres et la même page.
- **Mises à jour** : pas de rafraîchissement automatique en direct ; les chiffres et la liste se mettent à jour au chargement de la page. **[HYPOTHÈSE]**
- **Copier** : le bouton « Copier » de la référence affiche « Copié » pendant 2 secondes.

## 7. Accessibility Floor

- Contraste AA garanti par les couleurs de DESIGN.md ; focus clavier toujours visible.
- Chaque champ a un libellé visible (pas seulement un texte d'exemple dans le champ).
- Les messages d'erreur sont lus par les lecteurs d'écran (zone `aria-live`).
- Statuts et priorités jamais portés par la seule couleur.
- Zones cliquables d'au moins 44 × 44 px sur téléphone.
- Les fenêtres de confirmation gardent le focus à l'intérieur et le rendent au bouton d'origine à la fermeture.

## 8. Responsive & Platform

| Largeur | Espace public | Espace équipe |
|---|---|---|
| Téléphone (< 640 px) | Une colonne, champs pleine largeur, bouton d'envoi pleine largeur | Menu replié ; liste en cartes ; détail en une colonne, actions sous le résumé |
| Tablette (640–1 023 px) | Colonne centrée | Menu replié ; liste en tableau réduit (référence, objet, statut, priorité, date) |
| Ordinateur (≥ 1 024 px) | Colonne centrée de 560 px | Menu latéral ouvert ; tableau complet ; détail en deux colonnes |

## 9. Écrans : contenu détaillé

### 9.1 Déposer une demande (`/`) — maquette [formulaire public](mockups/key-formulaire-public.html)

- En-tête : « Nova Services ».
- Titre : « Déposer une demande ». Sous-titre : « Notre équipe vous répond au plus vite. Les champs sans mention sont obligatoires. »
- Bloc « Vos coordonnées » : Nom et prénom ; Email ; Téléphone (facultatif) ; Société (facultatif).
- Bloc « Votre demande » : Catégorie (liste des catégories actives) ; Objet ; Description (zone de texte, compteur « 0 / 5 000 »).
- Champ piège invisible (FR-5), ignoré par les lecteurs d'écran.
- Mention : « Vos informations servent uniquement à traiter votre demande. Elles sont conservées 2 ans après son traitement, puis supprimées. Pour les faire effacer, écrivez à contact@nova-services.example. » (durée et email tirés des paramètres).
- Case : « J'accepte que mes données soient utilisées pour traiter ma demande. »
- Bouton principal : « Envoyer ma demande ».
- Pied de page : lien discret « Espace équipe ».

### 9.2 Confirmation (`/confirmation/[jeton]`)

Icône de coche, « Votre demande a bien été enregistrée. », « Votre référence : **NOVA-2026-0042** » avec « Copier », « Conservez-la pour tout échange avec notre équipe. », « Un email de confirmation vous a été envoyé. », contact de Nova, bouton secondaire « Déposer une autre demande ». (Montré dans la maquette du formulaire public.)

### 9.3 Tableau de bord (`/equipe`)

Titre « Bonjour Karim ». Cinq cartes chiffrées cliquables, chacune ouvrant la liste filtrée :
1. **À prendre en charge** (Nouvelle, sans responsable) — mise en avant ;
2. **Priorité Haute non traitées** ;
3. **Nouvelle** ;
4. **En cours** ;
5. **Traitée**.

Dessous : « Mes demandes en cours » (5 dernières, lien « Tout voir »). Bouton principal en haut à droite : « Saisir une demande ».

### 9.4 Liste des demandes (`/equipe/demandes`) — maquette [liste des demandes](mockups/key-liste-demandes.html)

- Titre « Demandes » + nombre total ; bouton principal « Saisir une demande ».
- Barre : recherche « Rechercher une référence, un nom, une société, un email, un objet… » ; filtres Statut, Priorité, Catégorie, Canal, Responsable ; « Effacer les filtres ».
- Colonnes : Référence · Date · Demandeur (nom et société) · Objet · Catégorie · Canal · Statut · Priorité · Responsable (« — » si aucun).
- Pagination en bas : « 1–25 sur 132 », Précédent / Suivant.

### 9.5 Détail d'une demande (`/equipe/demandes/[référence]`) — maquette [détail](mockups/key-detail-demande.html)

- Lien « ← Retour aux demandes ».
- En-tête : référence, objet, badges statut et priorité, « Reçue le 03/11/2026 à 08:47 via Formulaire ».
- Colonne principale :
  - **Description** (texte tel que saisi, retours à la ligne conservés) ;
  - **Demandeur** : nom, société, email (lien `mailto:`), téléphone (lien `tel:`) ;
  - si l'email de confirmation n'est pas parti : bandeau « Email de confirmation non envoyé » (ou « Email non envoyé (mode démonstration) ») ;
  - **Notes internes** : liste (auteur, date) + zone « Ajouter une note » + bouton « Ajouter la note » ;
  - **Historique** : lignes du plus ancien au plus récent.
- Colonne d'actions :
  - **Responsable** : nom ou « Aucun » ; « Prendre en charge » (si Nouvelle) ; « Attribuer à… » (admin) ; « Libérer » (responsable ou admin, si En cours) ;
  - **Statut** : boutons des seuls passages permis (« Marquer comme traitée », « Rouvrir », « Classer sans suite » qui ouvre une fenêtre avec note obligatoire) ;
  - **Priorité** : liste Basse / Normale / Haute ;
  - **Catégorie** : affichée ; modifiable par l'équipe. **[HYPOTHÈSE]**

### 9.6 Saisir une demande (`/equipe/demandes/nouvelle`)

Mêmes champs que le formulaire public, plus **Canal** (Téléphone ou Email, obligatoire) en premier. Email facultatif, avec la règle « Indiquez au moins un email ou un téléphone ». Pas de case de consentement ; rappel : « Pensez à informer le demandeur de l'usage de ses données. » Bouton « Enregistrer la demande ».

### 9.7 Comptes (`/equipe/admin/comptes`)

Tableau : Nom · Email · Rôle · État (Invité, Actif, Désactivé) · Actions. Bouton « Inviter un membre » ouvrant une fenêtre (Nom, Email, Rôle). Actions par ligne : Modifier (nom, rôle), Renvoyer l'invitation / Annuler l'invitation (si Invité), Générer un lien de mot de passe (si Actif), Désactiver / Réactiver. En mode démonstration, après une invitation ou une génération de lien, une fenêtre affiche le lien avec « Copier » et rappelle qu'il est valable 24 h. Le compte connecté n'a ni « Désactiver » ni changement de rôle.

### 9.8 Catégories (`/equipe/admin/categories`)

Liste : Nom · État · nombre de demandes · Actions (Renommer, Désactiver / Réactiver). Bouton « Ajouter une catégorie ».

### 9.9 Paramètres (`/equipe/admin/parametres`)

Formulaire : Nom affiché (« Nova Services ») ; Email de contact ; Durée de conservation (liste de 6 mois à 5 ans). Aperçu de la phrase affichée aux demandeurs. Bouton « Enregistrer les paramètres ».

### 9.10 Données personnelles (`/equipe/admin/donnees`)

Deux blocs :
- **Effacer les données d'une personne** : champ email + « Rechercher » ; liste des demandes trouvées ; bouton destructeur « Effacer ces N demandes ».
- **Supprimer les demandes expirées** : « N demandes sont traitées depuis plus de 2 ans. » ; bouton destructeur « Supprimer les demandes expirées » (désactivé à 0).

### 9.11 Journal (`/equipe/admin/journal`)

Tableau : Date · Type (Compte, Paramètre, Catégorie, Données, Email, Connexion) · Description · Par. Filtre par type. 50 lignes par page. **[HYPOTHÈSE]**

### 9.12 Connexion, mot de passe oublié, choisir un mot de passe

Colonne centrée, logo, un formulaire court. Choisir un mot de passe : deux champs (mot de passe, confirmation) et la règle affichée « 8 caractères minimum ». Pour une invitation, le titre est « Bienvenue chez Nova Services, Léo » ; pour un oubli, « Choisissez un nouveau mot de passe ». Lien expiré : « Ce lien n'est plus valable. » + bouton pour en demander un nouveau (oubli) ou « Contactez votre administrateur » (invitation).

## 10. Key Flows

### Flow 1 — Sophie dépose une demande depuis son téléphone (UJ-1)

1. Sophie ouvre le lien du formulaire depuis l'email de Nova, sur son téléphone, entre deux rendez-vous.
2. Elle remplit ses coordonnées, choisit « Problème technique », écrit l'objet « Impression impossible depuis la mise à jour » et sa description.
3. Elle oublie la case de consentement et appuie sur « Envoyer ma demande » : le message apparaît sous la case, le reste est intact.
4. Elle coche et renvoie. Le bouton affiche « Envoi en cours… ».
5. **Moment clé** : l'écran affiche « Votre demande a bien été enregistrée. » et la référence **NOVA-2026-0042**. Elle appuie sur « Copier ».
6. Une minute plus tard, l'email de confirmation arrive avec la même référence.

### Flow 2 — Karim traite la demande de Sophie (UJ-2)

1. Karim se connecte à 9 h. Le tableau de bord affiche « À prendre en charge : 3 » et « Priorité Haute non traitées : 0 ».
2. Il clique sur « À prendre en charge » : la liste s'ouvre, filtrée.
3. Il ouvre NOVA-2026-0042, lit la description, clique sur « Prendre en charge » : toast « Vous êtes responsable de cette demande. », badge En cours, ligne d'historique ajoutée.
4. Il passe la priorité à Haute et ajoute la note « Rappelée à 9 h, intervention à distance prévue ».
5. **Moment clé** : à 11 h, après l'intervention, il clique sur « Marquer comme traitée » ; le badge passe au vert et l'historique raconte toute l'histoire.
6. De retour dans la liste, ses filtres sont toujours là ; le compteur du menu est passé de 3 à 2.

### Flow 3 — Nadia saisit un appel (UJ-3)

1. Le téléphone sonne : M. Lambert, prospect, veut un rendez-vous.
2. Nadia clique sur « Saisir une demande », choisit « Téléphone », catégorie « Demande de rendez-vous », remplit nom et téléphone (pas d'email).
3. **Moment clé** : « Enregistrer la demande » ouvre le détail de NOVA-2026-0043, avec la ligne « Saisie par Nadia Morel (téléphone) ». Elle lit la référence à M. Lambert.

### Flow 4 — Claire gère un départ et un effacement (UJ-4)

1. Dans Comptes, Claire clique sur « Désactiver » pour Léo.
2. La fenêtre indique : « Léo Martin ne pourra plus se connecter. Ses 2 demandes en cours reviendront en Nouvelle, sans responsable. »
3. **Moment clé** : elle confirme ; Léo passe à l'état Désactivé et le compteur « À prendre en charge » augmente de 2.
4. Plus tard, dans Données personnelles, elle recherche jean.dupont@example.com, voit 3 demandes, clique sur « Effacer ces 3 demandes » et confirme ; le journal indique « 3 demandes effacées (droit à l'effacement) par Claire Roux ».

## 11. Hypothèses prises pendant l'UX

1. La page de confirmation n'affiche ni coordonnées ni description (§2.1).
2. Pas de rafraîchissement automatique : les chiffres se mettent à jour au chargement de la page (§6).
3. L'équipe peut corriger la catégorie d'une demande depuis le détail, avec une ligne d'historique (§9.5) — ce point complète le PRD.
4. Le journal affiche 50 lignes par page (§9.11).
5. Après 5 échecs de connexion, le blocage dure 15 minutes (§5, précise NFR-9).
6. L'adresse du formulaire public est la page d'accueil du site (`/`) (§2.1).
7. L'adresse email de contact de démonstration est `contact@nova-services.example` (domaine réservé aux exemples, donc fictif).
