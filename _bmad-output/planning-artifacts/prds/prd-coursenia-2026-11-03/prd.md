---
title: PRD — Nova Services, gestion des demandes clients
status: final
created: 2026-11-03
updated: 2026-11-03
---

# PRD : Nova Services — gestion des demandes clients

## 0. À quoi sert ce document

Ce PRD (*Product Requirements Document*, « document des exigences du produit ») décrit **ce que** l'application doit faire et **pour qui**. Il ne dit pas **comment** la programmer : ce sera le rôle de l'UX et de l'architecture (séquence 5). Les notes techniques déjà recueillies sont dans [addendum.md](addendum.md).

Il part du sujet de la formation, [docs/cahier-des-charges.md](../../../../docs/cahier-des-charges.md), des décisions prises avec Abraham le 3 novembre 2026, et de la validation BMAD du même jour ([validation-report.md](validation-report.md)). Chaque exigence porte sa source :

- **[CdC]** : demandé par le cahier des charges ;
- **[Cours]** : conseil des supports de la formation (séquences 8 et 9) ;
- **[Décision]** : choisi par Abraham pendant la préparation ou la validation du PRD ;
- **[Hypothèse validée]** : supposé faute d'information, puis accepté par Abraham le 03/11/2026 (liste au §12) ;
- **[HYPOTHÈSE]** : valeur fixée par défaut pendant la validation, encore modifiable (liste au §12).

Le §13 relie chaque point du cahier des charges aux exigences qui y répondent. Les mots du glossaire (§3) gardent le même sens dans tout le document.

## 1. Vision

Nova Services accompagne des professionnels dans leurs projets numériques. Chaque semaine, ses clients et prospects envoient des demandes par email ou téléphone : questions, problèmes techniques, rendez-vous, démarches administratives. Ces demandes sont recopiées à la main dans plusieurs fichiers, ce qui provoque des oublis, des doublons et un manque de visibilité. [CdC]

L'application réunit toutes les demandes au même endroit. Le client dépose sa demande en ligne en deux minutes et reçoit la preuve qu'elle est enregistrée. Les demandes reçues par téléphone ou email sont saisies par l'équipe dans le même outil. L'équipe retrouve toutes les demandes dans un espace sécurisé, voit tout de suite celles qui attendent une intervention, et suit leur traitement jusqu'au bout, avec un historique de ce qui a été fait.

Le projet est aussi l'occasion pour Nova Services d'expérimenter un développement assisté par l'IA, où chaque élément produit par l'IA est compris, vérifié et testé avant d'être intégré. [CdC]

## 2. Utilisateurs

### 2.1 Qui utilise l'application, et pour quoi faire

| Utilisateur | Ce qu'il veut | Source |
|---|---|---|
| **Demandeur** (client ou prospect de Nova Services) | Transmettre une demande simplement, sans créer de compte, et savoir qu'elle a bien été enregistrée. | [CdC] ; sans compte : [Décision] |
| **Collaborateur** (membre de l'équipe Nova) | Retrouver toutes les demandes, lire leur contenu, repérer celles qui demandent une intervention, les prendre en charge et suivre leur évolution. Saisir les demandes reçues par téléphone ou email. | [CdC] ; saisie : [Décision] |
| **Administrateur** | Tout ce que fait un collaborateur, plus gérer les comptes de l'équipe, les paramètres et les données personnelles. | [CdC] |
| **Responsable technique** | Mettre en ligne, surveiller les erreurs, sauvegarder, restaurer, traiter les incidents de niveau 2. Pour la démonstration : Abraham. | [CdC] ; personne : [Hypothèse validée] |

### 2.2 Qui n'utilise pas l'application (MVP)

- Le demandeur n'a **pas d'espace personnel** : il ne se connecte pas et ne suit pas sa demande en ligne. [Décision]
- Les emails reçus ne sont pas importés automatiquement : un membre de l'équipe les saisit (FR-25). [Décision]

### 2.3 Parcours clés

- **UJ-1. Sophie dépose une demande.**
  Sophie, gérante d'un cabinet d'architectes client de Nova, n'arrive plus à imprimer depuis la mise à jour de ses postes. Elle ouvre la page « Déposer une demande », saisit son nom, son email, son cabinet, choisit la catégorie « Problème technique », écrit un objet et une description, coche la case de consentement et envoie. Un écran lui confirme l'enregistrement avec la référence `NOVA-2026-0042`, et elle reçoit le même numéro par email. **Cas d'erreur :** si elle oublie la description, le formulaire lui montre le champ manquant sans effacer le reste.

- **UJ-2. Karim traite les nouvelles demandes.**
  Karim, technicien chez Nova, se connecte le matin. Le tableau de bord lui indique 3 demandes Nouvelle sans responsable, dont une en priorité Haute. Il clique sur ce chiffre, ouvre la demande de Sophie, la prend en charge (elle passe En cours et lui est attribuée), fixe la priorité à Haute et ajoute une note interne : « Rappelée à 9 h, intervention à distance prévue ». Après l'intervention, il passe la demande à Traitée. L'historique garde chaque étape avec son nom et l'heure. **Cas particulier :** une demande publicitaire est arrivée ; Karim la passe directement à Traitée avec la note « Spam ».

- **UJ-3. Nadia saisit un appel.**
  Nadia, à l'accueil de Nova, reçoit l'appel de M. Lambert, prospect, qui veut un rendez-vous. Dans l'espace interne, elle clique sur « Saisir une demande », choisit le canal « Téléphone », remplit les informations et enregistre. La demande apparaît dans la liste ; l'historique indique « Saisie par Nadia (téléphone) ».

- **UJ-4. Claire, administratrice, gère l'équipe et les données.**
  Claire crée le compte de Léo (nom, email, rôle Collaborateur). Léo reçoit un email d'invitation et choisit son mot de passe. Quand Léo quitte l'entreprise, Claire désactive son compte : l'écran l'avertit que ses 2 demandes en cours vont revenir en Nouvelle, sans responsable. Un ancien client demande l'effacement de ses données : Claire retrouve ses demandes par son email et les efface définitivement.

## 3. Glossaire

- **Demande** — Message déposé par un demandeur ou saisi par l'équipe, avec un objet, une catégorie, une description et les coordonnées du demandeur. Possède une référence, un canal, un statut, une priorité, un historique, et zéro ou un responsable.
- **Demandeur** — Client ou prospect à l'origine d'une demande. N'a pas de compte.
- **Référence** — Numéro unique d'une demande, lisible par un humain (exemple : `NOVA-2026-0042`).
- **Canal** — Origine d'une demande : Formulaire, Téléphone ou Email.
- **Membre de l'équipe** — Personne de Nova Services qui a un compte : collaborateur ou administrateur.
- **Collaborateur** — Rôle de base d'un membre de l'équipe.
- **Administrateur** — Rôle qui ajoute la gestion des comptes, des paramètres et des données personnelles.
- **Responsable technique** — Personne qui assure la mise en ligne, la surveillance, les sauvegardes et le support de niveau 2. N'est pas un rôle dans l'application.
- **Statut** — Étape de traitement : Nouvelle, En cours ou Traitée.
- **Priorité** — Importance fixée par l'équipe : Basse, Normale ou Haute.
- **Catégorie** — Type de demande (exemple : Problème technique). Liste gérée par l'administrateur.
- **Responsable de la demande** — Membre de l'équipe qui a pris en charge la demande ou à qui elle a été attribuée.
- **Prise en charge** — Action qui donne un responsable à une demande Nouvelle et la fait passer En cours.
- **Note interne** — Commentaire de l'équipe sur une demande, jamais visible du demandeur.
- **Historique** — Liste des événements d'une demande : qui, quoi, quand. Non modifiable.
- **Journal** — Liste des événements importants de l'application (comptes, paramètres, suppressions, échecs), consultable par les administrateurs.
- **Paramètres** — Réglages généraux gérés par l'administrateur.
- **Version** — Numéro d'une mise en ligne de l'application (exemple : `v1.2.0`).

## 4. Règles métier importantes

1. **Statuts et passages autorisés.** Une demande naît au statut Nouvelle. [CdC pour les trois statuts ; passages : Décision]

   | Passage | Comment | Effet sur le responsable |
   |---|---|---|
   | Nouvelle → En cours | Uniquement par prise en charge ou attribution | Devient le responsable |
   | En cours → Traitée | Changement de statut | Inchangé |
   | Traitée → En cours | Changement de statut (le problème revient) | Inchangé s'il est actif ; sinon la demande revient en Nouvelle sans responsable |
   | Nouvelle → Traitée | Classement sans suite (spam, doublon) avec note interne obligatoire | Aucun |
   | En cours → Nouvelle | Uniquement par « Libérer » | Retiré |

2. **Prise en charge et attribution.** Un collaborateur prend en charge une demande Nouvelle. Un administrateur peut attribuer une demande Nouvelle, ou réattribuer une demande En cours, à n'importe quel membre actif ; l'effet est le même qu'une prise en charge. [Décision]
3. **Qui agit sur quoi.** Tout membre de l'équipe peut consulter toutes les demandes, changer leur statut selon la règle 1, changer leur priorité et ajouter des notes internes. [CdC ; Hypothèse validée]
4. **Libérer.** Le responsable ou un administrateur peut libérer une demande En cours : elle revient en Nouvelle, sans responsable. [Décision]
5. **Priorité.** Fixée uniquement par l'équipe ; Normale par défaut. Le demandeur ne la choisit pas. [Décision]
6. **Historique.** Chaque création, prise en charge, attribution, libération, changement de statut ou de priorité, et chaque note interne, crée une ligne d'historique. La création indique « Demandeur (formulaire) » ou le nom du membre qui a saisi la demande, avec le canal. Une prise en charge crée une seule ligne (« Prise en charge par Karim : Nouvelle → En cours »). Personne ne peut modifier ni effacer une ligne, **sauf** lors de l'effacement complet d'une demande (FR-22, FR-24), où l'historique et les notes disparaissent avec elle. [CdC : historique simple ; contenu : Décision]
7. **Comptes.** Pas d'inscription libre : seul un administrateur crée un compte. Une désactivation ou un changement de rôle s'applique **dès l'action suivante** du compte concerné, même s'il est connecté. Les demandes En cours d'un compte désactivé reviennent en Nouvelle, sans responsable, avec une ligne d'historique. Le nom d'un compte désactivé reste dans les historiques. [Décision]
8. **Garde-fous administrateur.** Un administrateur ne peut ni désactiver son propre compte ni retirer son propre rôle ; il reste toujours au moins un administrateur à l'état Actif (pas seulement invité). [Hypothèse validée]
9. **Catégories.** Il reste toujours au moins une catégorie active. Une catégorie désactivée disparaît des formulaires mais reste affichée sur les anciennes demandes. Renommer une catégorie change son nom partout, y compris sur les anciennes demandes. [Décision]
10. **Droits contrôlés côté serveur.** Chaque règle d'accès est vérifiée là où sont les données, pas seulement en cachant un bouton. Un visiteur non connecté peut **seulement créer** une demande : il ne peut rien lire, et ne fixe ni le statut, ni la priorité, ni le responsable, ni la référence. [CdC ; Cours, séquence 8]

## 5. Fonctionnalités

Chaque exigence (FR, *Functional Requirement*) est suivie de **critères de réussite observables** : ce qu'on doit pouvoir constater à l'écran ou par un test automatique.

### 5.1 Dépôt et saisie d'une demande

Réalise UJ-1 et UJ-3.

#### FR-1 : Formulaire de dépôt public [CdC]

Un demandeur peut déposer une demande sans compte, en renseignant : nom (obligatoire), email (obligatoire), téléphone (facultatif), société (facultative), objet (obligatoire), catégorie (obligatoire, parmi les catégories actives) et description (obligatoire).

**Critères de réussite :**
- La page est accessible sans connexion, sur ordinateur et sur téléphone.
- La liste des catégories ne montre que les catégories actives.
- Un champ obligatoire vide ou un email mal formé affiche un message près du champ concerné, sans effacer les autres saisies.
- Un texte plus long que la limite est refusé avec un message (nom, société, objet : 150 caractères ; description : 5 000 caractères). [HYPOTHÈSE]

#### FR-2 : Enregistrement et confirmation [CdC]

À l'envoi, la demande est enregistrée dans la base de données avec le canal Formulaire, le statut Nouvelle, la priorité Normale, sans responsable, et une référence unique. Un écran de confirmation affiche la référence. La référence suit le format `NOVA-AAAA-NNNN` : l'année, puis un numéro qui repart à 1 chaque année et s'allonge au-delà de 9 999. [Décision ; format : HYPOTHÈSE]

**Critères de réussite :**
- Après l'envoi, l'écran affiche « Votre demande a bien été enregistrée » et la référence.
- La demande apparaît dans la liste de l'espace interne avec la même référence.
- Si l'enregistrement échoue, un message d'erreur s'affiche ; aucun écran de confirmation n'apparaît et la saisie est conservée.
- Un double clic sur « Envoyer » ne crée qu'une seule demande.
- Deux demandes envoyées au même instant reçoivent deux références différentes (test automatique).

#### FR-3 : Email de confirmation [Décision]

Le demandeur reçoit un email reprenant la référence, l'objet, la date et le contact de Nova Services. L'email ne recopie pas la description (moins de données personnelles en circulation).

**Critères de réussite :**
- L'email arrive à l'adresse saisie avec la bonne référence.
- Si l'email ne part pas, la demande reste enregistrée, le détail affiche « Email de confirmation non envoyé », et l'échec est inscrit au journal (OPS-2).

#### FR-4 : Information et consentement [Décision]

Sous le formulaire public, une phrase simple indique à quoi servent les données et combien de temps elles sont gardées. Une case « J'accepte que mes données soient utilisées pour traiter ma demande » doit être cochée.

**Critères de réussite :**
- Sans la case cochée, l'envoi est refusé avec un message clair.
- La durée affichée correspond à celle réglée dans les paramètres (FR-21).

#### FR-5 : Protection contre les envois en masse [Décision]

Le serveur limite le nombre de demandes envoyées par le formulaire public depuis une même adresse internet (adresse IP). Un champ invisible pour les humains (« piège ») bloque les robots qui remplissent tous les champs. Cette protection ne s'applique pas à la saisie interne (FR-25).

**Critères de réussite :**
- Au-delà de 5 envois en 10 minutes depuis la même adresse, un message « Trop d'envois, réessayez dans quelques minutes » s'affiche et rien n'est enregistré. [Hypothèse validée]
- La limite est vérifiée par le serveur : un envoi direct, sans passer par la page, est aussi bloqué (test automatique).
- L'adresse IP n'est pas conservée plus d'une heure. [Décision]

#### FR-25 : Saisie d'une demande par l'équipe [Décision]

Un membre de l'équipe saisit, depuis l'espace interne, une demande reçue par téléphone ou par email. Il choisit le canal (Téléphone ou Email) et remplit les mêmes champs que le formulaire public ; l'email du demandeur devient facultatif, mais il faut au moins un email ou un téléphone. Il n'y a pas de case de consentement : le membre informe le demandeur oralement ou par écrit. [HYPOTHÈSE : information orale suffisante pour le MVP]

**Critères de réussite :**
- La demande apparaît dans la liste avec le bon canal et une référence.
- L'historique indique « Saisie par Nadia (téléphone) ».
- Si un email est renseigné, l'email de confirmation (FR-3) est envoyé ; sinon, aucun email n'est envoyé.
- Le bouton n'est pas accessible sans connexion.

### 5.2 Espace interne et comptes

Réalise UJ-2 et UJ-4.

#### FR-6 : Connexion sécurisée [CdC]

Un membre de l'équipe se connecte avec son email et son mot de passe. Toutes les pages internes exigent d'être connecté.

**Critères de réussite :**
- Ouvrir directement l'adresse d'une page interne sans être connecté renvoie vers la page de connexion.
- Un mauvais mot de passe affiche un message qui ne dit pas si l'email existe.
- Après « Se déconnecter », recharger une page interne renvoie vers la page de connexion.
- Après plusieurs échecs de suite, les nouvelles tentatives sont bloquées pendant quelques minutes (NFR-9).

#### FR-7 : Mot de passe oublié [Décision]

Depuis la page de connexion, un membre peut recevoir un lien pour choisir un nouveau mot de passe. Le lien est valable 24 heures et ne sert qu'une fois. Un administrateur peut aussi générer ce lien pour un membre et le lui transmettre. [Durée : Décision, contrainte Supabase — architecture AD-13]

**Critères de réussite :**
- Le lien arrive par email et permet de se connecter avec le nouveau mot de passe.
- Le message affiché est le même que l'email existe ou non.
- Un lien déjà utilisé ou expiré affiche un message clair et propose d'en demander un nouveau.

#### FR-8 : Création de compte par invitation [CdC : gestion des comptes ; mode : Décision]

Un administrateur crée un compte (nom, email, rôle). La personne reçoit un email d'invitation, valable 24 heures, et choisit son mot de passe. En mode démonstration (voir §7), le lien est affiché à l'administrateur, qui le copie. L'administrateur peut renvoyer une invitation ou l'annuler. [Durée : Décision, contrainte Supabase — architecture AD-17]

**Critères de réussite :**
- Le nouveau compte apparaît dans la liste des comptes avec l'état « Invité », puis « Actif » après le choix du mot de passe.
- L'administrateur ne voit et ne saisit jamais le mot de passe.
- Un email déjà utilisé, y compris par un compte désactivé, est refusé avec un message qui propose de réactiver le compte existant.
- Une invitation expirée affiche un message clair ; « Renvoyer » crée un nouveau lien valable 24 heures.

#### FR-9 : Modifier ou désactiver un compte [CdC : droits ; Décision]

Un administrateur modifie le nom ou le rôle d'un compte, le désactive ou le réactive. Voir les règles 7 et 8.

**Critères de réussite :**
- Un compte désactivé ne peut plus se connecter, même avec le bon mot de passe.
- Un membre connecté dont le compte est désactivé est refusé dès son action suivante (test automatique).
- Avant de confirmer la désactivation, l'écran indique combien de demandes En cours vont revenir en Nouvelle.
- Le nom d'un compte désactivé reste affiché dans les historiques.
- Les garde-fous de la règle 8 sont respectés.

#### FR-10 : Droits collaborateur / administrateur [CdC]

Les pages et actions d'administration (comptes, paramètres, catégories, journal, effacement et purge de données, attribution et réattribution) sont réservées aux administrateurs.

**Critères de réussite :**
- Un collaborateur ne voit pas le menu Administration.
- Un collaborateur qui tape directement l'adresse d'une page d'administration est refusé.
- Une action d'administration envoyée par un collaborateur, sans passer par l'écran, est refusée par le serveur (test automatique).

### 5.3 Traitement des demandes

Réalise UJ-2.

#### FR-11 : Liste des demandes [CdC]

La liste affiche toutes les demandes, les plus récentes en premier, avec : référence, date, nom du demandeur, objet, catégorie, canal, statut, priorité et responsable.

**Critères de réussite :**
- Une nouvelle demande apparaît en tête de liste.
- Les statuts et priorités se lisent par leur texte, pas seulement par une couleur.
- Avec aucune demande, la liste affiche un message d'état vide explicite.
- Au-delà de 25 demandes, la liste se découpe en pages. [Hypothèse validée]

#### FR-12 : Recherche et filtres [CdC]

Un membre de l'équipe recherche par texte (référence, nom, société, email, objet) et filtre par statut, catégorie, priorité, canal et responsable. Le filtre responsable propose aussi « Sans responsable » et « Mes demandes » ; le filtre statut propose aussi « Non traitées » (Nouvelle et En cours). Les filtres se combinent. La recherche trouve un mot partiel, sans tenir compte des majuscules ni des accents.

**Critères de réussite :**
- Rechercher une référence exacte affiche cette seule demande.
- Rechercher « dupont » trouve « Dupont » et « Dupont-Aïdi ».
- Combiner « Non traitées » et « Haute » n'affiche que les demandes qui ont les deux.
- Sans résultat, un message l'indique, avec un bouton pour effacer les filtres.

#### FR-13 : Détail d'une demande [CdC]

Le détail affiche toutes les informations de la demande, ses coordonnées, son canal, son statut, sa priorité, son responsable, ses notes internes et son historique.

**Critères de réussite :**
- Toutes les informations saisies sont visibles et identiques à la saisie.
- Un texte contenant du code (par exemple `<script>`) s'affiche comme du texte, sans s'exécuter (test automatique).
- Une référence qui n'existe pas affiche un message « Demande introuvable ».

#### FR-14 : Prise en charge, attribution et libération [Décision]

Voir les règles 2 et 4.

**Critères de réussite :**
- Après « Prendre en charge », le nom du membre apparaît comme responsable et la demande passe En cours.
- Si deux membres prennent en charge la même demande en même temps, un seul devient responsable ; l'autre voit « Déjà prise en charge par… ».
- Un administrateur peut attribuer ou réattribuer ; un collaborateur ne voit pas cette action et le serveur la lui refuse.
- Après « Libérer », la demande est Nouvelle, sans responsable, et figure dans le compteur du tableau de bord.

#### FR-15 : Changement de statut [CdC]

Un membre de l'équipe change le statut d'une demande selon les passages autorisés (règle 1).

**Critères de réussite :**
- Seuls les passages autorisés sont proposés ; un passage interdit envoyé directement au serveur est refusé (test automatique).
- Le classement sans suite (Nouvelle → Traitée) exige une note interne.
- Le nouveau statut apparaît aussitôt dans le détail et dans la liste.

#### FR-16 : Priorité [Décision]

Un membre de l'équipe fixe la priorité (Basse, Normale, Haute).

**Critères de réussite :**
- La nouvelle priorité apparaît dans le détail, dans la liste et dans le filtre.

#### FR-17 : Notes internes [Décision]

Un membre de l'équipe ajoute une note interne à une demande. Une note ne peut être ni modifiée ni supprimée, sauf effacement complet de la demande. [Hypothèse validée]

**Critères de réussite :**
- La note s'affiche avec son auteur, sa date et son heure.
- Une note vide est refusée.

#### FR-18 : Historique [CdC]

Chaque événement de la règle 6 crée une ligne d'historique (qui, quoi, quand), affichée dans le détail du plus ancien au plus récent.

**Critères de réussite :**
- Après une prise en charge, une ligne « Prise en charge par Karim : Nouvelle → En cours, le 03/11/2026 à 09:12 » apparaît.
- Aucun écran ni aucune action ne permet de modifier ou d'effacer une ligne, en dehors de FR-22 et FR-24 (test automatique côté serveur).

#### FR-19 : Tableau de bord [Décision]

À l'arrivée dans l'espace interne, un tableau de bord affiche : le nombre de demandes par statut, le nombre de demandes Nouvelle sans responsable et le nombre de demandes de priorité Haute non traitées. Chaque chiffre mène à la liste filtrée correspondante (FR-12). Le menu de l'espace interne affiche en permanence le nombre de demandes Nouvelle sans responsable. Les chiffres sont mis à jour à chaque chargement de page.

**Critères de réussite :**
- Cliquer sur un chiffre ouvre la liste filtrée, qui contient exactement ce nombre de demandes.
- Après une prise en charge, le compteur du menu diminue de 1 au chargement de page suivant.

### 5.4 Administration

Réalise UJ-4.

#### FR-20 : Gestion des catégories [CdC : paramètres ; Décision]

Un administrateur ajoute, renomme, désactive et réactive des catégories. Catégories de départ : Demande d'information, Problème technique, Demande de rendez-vous, Question administrative, Autre. Voir la règle 9.

**Critères de réussite :**
- Une catégorie ajoutée apparaît aussitôt dans les formulaires.
- Une catégorie désactivée disparaît des formulaires mais reste affichée sur les anciennes demandes.
- Désactiver la dernière catégorie active est refusé avec un message.
- Deux catégories ne peuvent pas porter le même nom, y compris lors d'une réactivation.

#### FR-21 : Paramètres généraux [Décision]

Un administrateur règle le nom et l'email de contact affichés aux demandeurs (page de confirmation et email) et la durée de conservation des données, entre 6 mois et 5 ans. [Bornes : HYPOTHÈSE]

**Critères de réussite :**
- Un email de contact mal formé ou une durée hors bornes est refusé avec un message.
- Un changement apparaît aussitôt sur le formulaire public (FR-4) et dans le prochain email de confirmation.
- Chaque changement est inscrit au journal (OPS-2).

#### FR-22 : Effacement des données d'un demandeur [Décision]

Sur demande d'une personne (droit à l'effacement du RGPD), un administrateur recherche son email, voit toutes ses demandes, puis les efface définitivement, avec leur historique et leurs notes, après une confirmation explicite. Les sauvegardes contenant ces données disparaissent d'elles-mêmes au bout de 30 jours (OPS-3) ; si une sauvegarde plus ancienne que l'effacement est restaurée, l'effacement est refait (OPS-4).

**Critères de réussite :**
- Après confirmation, aucune demande de cet email n'apparaît ni dans la liste ni dans la recherche.
- Un collaborateur n'a pas accès à cette action (FR-10).
- Le journal indique « 3 demandes effacées (droit à l'effacement) par Claire », sans recopier les données effacées.

#### FR-24 : Purge des demandes expirées [Décision]

Un administrateur lance « Supprimer les demandes expirées » : l'écran indique combien de demandes sont Traitées depuis plus longtemps que la durée de conservation, puis les efface définitivement après confirmation. Une demande jamais traitée n'est jamais purgée. Pour une demande rouverte puis traitée à nouveau, la durée part du dernier passage à Traitée.

**Critères de réussite :**
- Le nombre annoncé correspond aux demandes réellement effacées.
- Une demande Traitée depuis moins longtemps que la durée reste présente.
- La purge est inscrite au journal avec le nombre de demandes effacées.

#### FR-26 : Consultation du journal [CdC : événements importants]

Un administrateur consulte le journal (OPS-2), du plus récent au plus ancien, avec un filtre par type d'événement.

**Critères de réussite :**
- Après la création d'un compte, une ligne « Compte créé : Léo (Collaborateur), par Claire » apparaît.
- Un collaborateur n'a pas accès au journal.

### 5.5 Après le MVP

#### FR-23 : Suggestion par l'IA [Décision — peut attendre]

À l'arrivée d'une demande, une IA propose une catégorie et une priorité. Un membre de l'équipe accepte ou corrige ; rien n'est appliqué sans validation humaine. À construire seulement quand le MVP est en ligne, et après avoir vérifié où l'IA traite les données (§8).

**Critères de réussite :**
- La suggestion est visible et marquée « proposée par l'IA » dans le détail.
- Accepter ou corriger crée une ligne d'historique.
- Si l'IA ne répond pas, la demande est traitée normalement, sans suggestion.

## 6. Exigences de qualité (pour toute l'application)

| Id | Exigence | Comment le vérifier | Source |
|---|---|---|---|
| NFR-1 | **Sécurité des accès** : toutes les règles d'accès (règle 10) sont vérifiées côté serveur et dans la base. | Des tests automatiques essaient chaque accès interdit : visiteur qui lit ou modifie une demande, collaborateur qui fait une action d'administration, compte désactivé. Tous doivent échouer. | [CdC] |
| NFR-2 | **Secrets** : aucun identifiant, mot de passe ni clé dans le code source ou dans le dépôt Git ; ils sont stockés chez l'hébergeur. | Une recherche automatique de secrets dans le dépôt ne trouve rien ; le fichier des réglages locaux est exclu de Git. | [CdC] |
| NFR-3 | **Environnements séparés et mise en ligne** : un environnement de développement et un de production, avec des bases et des réglages distincts. La production est accessible en ligne, en HTTPS. | Une demande créée en développement n'apparaît pas en production ; l'adresse de production s'ouvre en `https://`. | [CdC] |
| NFR-4 | **Versions** : le projet est versionné avec Git ; chaque mise en ligne porte un numéro de version (étiquette Git `vX.Y.Z`). | Le numéro de version est affiché en bas des pages internes et correspond à une étiquette du dépôt. | [CdC] ; affichage : [Décision] |
| NFR-5 | **Retour arrière** : une procédure écrite permet de remettre en ligne la version précédente. Une sauvegarde de la base est faite juste avant chaque mise en ligne, et les changements de structure de la base restent compatibles avec la version précédente. | La procédure a été exécutée pour de vrai au moins une fois : après le retour, le numéro de version affiché est l'ancien et l'application fonctionne. | [CdC] |
| NFR-6 | **Accessibilité de base** : utilisable au clavier, sur téléphone et ordinateur, messages d'erreur compréhensibles, information jamais portée par la seule couleur. | Parcours UJ-1 réalisé au clavier seul et sur un écran de téléphone. | [Hypothèse validée] |
| NFR-7 | **Rapidité** : la liste s'affiche en moins de 2 secondes avec 2 000 demandes fictives. | Mesure dans l'environnement de développement, avec 2 000 demandes générées. | [Hypothèse validée] |
| NFR-8 | **Développement assisté par l'IA** : chaque élément généré est relu, compris et testé ; tous les tests passent avant chaque commit (enregistrement Git) et chaque mise en ligne. | Le carnet d'usage de l'IA (OPS-7) et l'historique Git le montrent ; aucun commit sur la branche principale avec des tests en échec. | [CdC] ; [Cours] |
| NFR-9 | **Sécurité de base** : HTTPS partout ; mot de passe de 8 caractères minimum ; blocage temporaire après 5 échecs de connexion de suite ; déconnexion automatique après 8 heures ; longueurs maximales des champs ; textes saisis affichés sans jamais s'exécuter ; dépendances sans faille connue grave. | Tests automatiques sur chaque point ; audit de sécurité de la séquence 8 sans point « grave » restant. | [Décision] ; valeurs : [HYPOTHÈSE] ; [Cours] |

## 7. Exploitation et support

| Id | Exigence | Comment le vérifier | Source |
|---|---|---|---|
| OPS-1 | **Suivi des erreurs** : les erreurs de l'application sont enregistrées automatiquement, sans mot de passe ni donnée personnelle, et consultables par le responsable technique (outil choisi dans l'architecture). | Une erreur provoquée volontairement en production apparaît dans l'outil en moins de 5 minutes. | [CdC] |
| OPS-2 | **Journal des événements importants** : création, modification, désactivation et réactivation de comptes ; changements de paramètres et de catégories ; effacements et purges ; échecs d'envoi d'email ; connexions bloquées. Conservé 1 an, sans donnée personnelle des demandeurs. Consultable par les administrateurs (FR-26). | Chaque type d'événement produit une ligne visible dans le journal. | [CdC] ; contenu et durée : [HYPOTHÈSE] |
| OPS-3 | **Sauvegarde** : la base de données (demandes, historiques, notes, catégories, paramètres et comptes) est sauvegardée automatiquement chaque jour, plus juste avant chaque mise en ligne. Une copie est gardée hors de l'hébergeur. Les sauvegardes sont conservées 30 jours. | La liste des sauvegardes montre une sauvegarde par jour et une avant chaque version. | [CdC] ; fréquence : [Hypothèse validée] ; le reste : [Décision] |
| OPS-4 | **Restauration** : une procédure écrite explique comment restaurer une sauvegarde, y compris refaire les effacements RGPD postérieurs à la sauvegarde. | La restauration a été réalisée pour de vrai au moins une fois sur un environnement séparé : on y retrouve le même nombre de demandes que dans la sauvegarde. Date et durée sont notées. | [CdC] |
| OPS-5 | **Indisponibilité** : une fiche décrit les premières actions si l'application ne répond plus : vérifier, prévenir l'équipe, recevoir les demandes par téléphone et email puis les saisir avec FR-25, revenir à la version précédente ou restaurer. | Un exercice de panne simulée a été déroulé une fois avec la fiche ; le résultat est noté. | [CdC] |
| OPS-6 | **Support en deux niveaux** : un tableau « problème → niveau → qui → délai → comment le signaler ». Niveau 1, l'administrateur : questions d'usage, mot de passe oublié, compte à créer ou débloquer. Niveau 2, le responsable technique : panne, erreur, perte de données, faille. | Le tableau existe dans la documentation ; 3 cas fictifs ont été classés et traités avec lui. | [CdC] ; répartition : [Hypothèse validée] |
| OPS-7 | **Documentation synthétique** : déploiement (mise en ligne, réglages, versions), maintenance (sauvegarde, restauration, retour arrière, mises à jour), support (OPS-6), sécurité (accès, secrets, mots de passe), protection des données (§8), et un **carnet d'usage de l'IA** (ce que l'IA a produit, ce qui a été vérifié et corrigé). | Chaque document existe et un membre extérieur au projet sait suivre la procédure de mise en ligne. | [CdC] |

**Mode démonstration des emails (budget 0 €).** FR-3, FR-7 et FR-8 dépendent de l'envoi d'emails. Sans nom de domaine payant, le service d'envoi (Resend) n'écrit qu'à l'adresse d'Abraham. Pendant la formation, les emails ne partent donc que vers les adresses autorisées. Pour les autres, la demande reste enregistrée et le détail affiche « Email non envoyé (mode démonstration) ». Les liens d'invitation et de réinitialisation sont affichés à l'administrateur, qui les copie. Passage en vraie production : vérifier un domaine (~10 € par an), sans changer le code. [Décision du 03/11/2026 — architecture AD-13]

## 8. Données personnelles

| Données | Pourquoi | Durée de conservation |
|---|---|---|
| Demandeurs : nom, email, téléphone, société, contenu de la demande | Traiter la demande | Durée réglée (2 ans par défaut) après le dernier passage à Traitée, puis purge (FR-24) |
| Membres de l'équipe : nom, email, rôle | Connexion et traçabilité | Tant que le compte existe ; le nom reste dans les historiques |
| Adresse IP des visiteurs | Anti-spam (FR-5) | 1 heure |
| Journal | Sécurité et suivi | 1 an |
| Sauvegardes | Restauration | 30 jours |

- **Rien d'autre n'est collecté.** Pas de suivi publicitaire. [Décision]
- **Information** : phrase sous le formulaire public (FR-4) ; information orale pour la saisie par l'équipe (FR-25).
- **Droit à l'effacement** : FR-22.
- **Données de test** : uniquement fictives, et retirées de la production avant l'ouverture. [Cours, séquence 9]
- **Hébergement** : dans l'Union européenne si l'offre gratuite le permet. [Hypothèse validée, à décider dans l'architecture]
- **IA (FR-23)** : avant de l'activer, vérifier où le fournisseur traite les données, et n'envoyer que l'objet et la description, jamais les coordonnées.

## 9. Périmètre du MVP

### 9.1 Dans le MVP

FR-1 à FR-22, FR-24 à FR-26, NFR-1 à NFR-9, OPS-1 à OPS-7.

**Ordre recommandé pour les epics :** le parcours principal (dépôt, liste, détail, statuts) et la sécurité d'abord ; puis l'exploitation (mise en ligne, versions, sauvegarde, erreurs) ; enfin les compléments (tableau de bord, purge, journal).

### 9.2 Peut attendre

| Élément | Pourquoi plus tard |
|---|---|
| Suggestion par l'IA (FR-23) | Non demandée par le sujet ; donne une dimension IA au produit une fois le MVP en ligne. |
| Email au demandeur quand sa demande passe à Traitée | Utile, mais la confirmation à l'enregistrement répond déjà au sujet. |
| Emails à l'équipe pour les nouvelles demandes | Le compteur du menu et le tableau de bord suffisent pour le MVP. [Décision] |
| Espace de suivi en ligne pour le demandeur | Exigerait des comptes clients : beaucoup plus de travail et de risques. |
| Échanges de messages avec le demandeur | Le sujet ne le demande pas ; les échanges continuent par email ou téléphone. |
| Pièces jointes | Stockage et contrôles de sécurité supplémentaires. |
| Statistiques avancées, export Excel | Le tableau de bord simple suffit pour le MVP. |

### 9.3 Hors projet

Application mobile à installer, import automatique des emails, téléphonie, facturation.

## 10. Indicateurs de réussite du projet

| Id | Indicateur | Comment le mesurer | Valide |
|---|---|---|---|
| SM-1 | Un demandeur dépose une demande complète en moins de 2 minutes. | 3 testeurs du groupe pilote (séquence 9), chronométrés de l'ouverture de la page à l'écran de confirmation ; au moins 2 sur 3 sous 2 minutes. | FR-1, FR-2 |
| SM-2 | 100 % des demandes déposées pendant les essais apparaissent dans la liste avec leur référence. | Comparer les références notées par les testeurs à la liste. | FR-2, FR-11 |
| SM-3 | Un membre de l'équipe retrouve une demande précise en moins de 30 secondes. | 3 testeurs, avec 50 demandes fictives, à partir du nom d'un demandeur. | FR-12 |
| SM-4 | Aucun accès interdit ne réussit. | Tous les tests automatiques de NFR-1 passent. | FR-6, FR-10, NFR-1 |
| SM-5 | La restauration et le retour arrière ont été réalisés pour de vrai. | Procès-verbaux datés d'OPS-4 et de NFR-5. | OPS-4, NFR-5 |
| SM-6 | Plus d'oubli : aucune demande Nouvelle ne reste sans responsable plus de 2 jours ouvrés pendant le pilote. | Compteur du tableau de bord relevé chaque jour du pilote. | FR-19 |

**À ne pas chercher à maximiser :**
- **SM-C1** : le nombre de fonctions. Ajouter des fonctions non demandées alourdit le projet et la soutenance ; mieux vaut moins de fonctions, toutes testées.

## 11. Questions ouvertes (tranchées par l'architecture du 03/11/2026)

Les réponses sont dans l'architecture : emails en mode démonstration via Resend (AD-13), Netlify et Supabase à Paris (AD-9, AD-11), sauvegardes par GitHub Actions (AD-12), Sentry en région UE (AD-14).

1. Quel service envoie les emails, et son offre gratuite suffit-elle ? (voir le risque au §7)
2. Où sont hébergées la base et l'application, et dans quelle région ?
3. Les sauvegardes quotidiennes et la copie hors hébergeur sont-elles possibles avec l'offre gratuite, ou faut-il un script planifié ?
4. Quel outil de suivi des erreurs (OPS-1) ?

## 12. Hypothèses

### 12.1 Hypothèses validées par Abraham le 03/11/2026

1. Les demandes reçues par téléphone ou email sont saisies par l'équipe (remplacée par FR-25, plus sûre que le formulaire public).
2. Une prise en charge fait passer la demande En cours (règles 1 et 2).
3. Tout membre de l'équipe peut agir sur toutes les demandes (règle 3).
4. Seul un administrateur attribue et réattribue (règle 2).
5. Garde-fous administrateur (règle 8).
6. Anti-spam : 5 envois en 10 minutes (FR-5).
7. 25 demandes par page (FR-11).
8. Notes internes non modifiables (FR-17).
9. Accessibilité de base et rapidité (NFR-6, NFR-7).
10. Contenu du journal et sauvegarde quotidienne (OPS-2, OPS-3).
11. Conservation de 2 ans après le traitement (§8).
12. Hébergement dans l'Union européenne si possible (§8).

### 12.2 Valeurs fixées par défaut pendant la validation, encore modifiables

13. Longueurs maximales des champs (FR-1).
14. Format de la référence `NOVA-AAAA-NNNN` (FR-2).
15. Information orale suffisante pour la saisie par l'équipe (FR-25).
16. Liens de mot de passe et d'invitation valables 24 heures (FR-7, FR-8), validé le 03/11/2026.
17. Durée de conservation réglable entre 6 mois et 5 ans (FR-21).
18. Blocage après 5 échecs de connexion et déconnexion après 8 heures (NFR-9).
19. Journal conservé 1 an (OPS-2).

## 13. Correspondance cahier des charges → exigences

| Point du cahier des charges | Exigences |
|---|---|
| Déposer une demande (client ou prospect) | FR-1, FR-25 |
| Nom, coordonnées, objet, catégorie, description | FR-1 |
| Enregistrer en base de données | FR-2 |
| Confirmation après l'envoi | FR-2, FR-3 |
| Connexion des collaborateurs à un espace sécurisé | FR-6, FR-7, NFR-9 |
| Liste des demandes | FR-11 |
| Détail d'une demande | FR-13 |
| Rechercher ou filtrer | FR-12 |
| Modifier le statut | FR-15 |
| Statuts Nouvelle, En cours, Traitée | Règle 1, FR-15 |
| Historique simple | Règle 6, FR-18 |
| Gestion des comptes utilisateurs | FR-8, FR-9 |
| Droits collaborateur / administrateur | Règle 10, FR-10, NFR-1 |
| Paramètres gérés par l'administrateur | FR-20, FR-21 |
| Identifier les demandes qui nécessitent une intervention | FR-16, FR-19 |
| IA : éléments compris, vérifiés, testés | NFR-8, OPS-7 (carnet d'usage de l'IA) |
| Environnement de production en ligne | NFR-3 |
| Séparer développement et production | NFR-3 |
| Pas de secrets dans le code | NFR-2 |
| Projet versionné, versions identifiables | NFR-4 |
| Retour à une version précédente | NFR-5 |
| Consulter les erreurs et événements importants | OPS-1, OPS-2, FR-26 |
| Sauvegarde et restauration | OPS-3, OPS-4 |
| Actions en cas d'indisponibilité | OPS-5 |
| Support niveau 1 / niveau 2 | OPS-6 |
| Documentation : accès, sécurité, données personnelles | OPS-7, §8 |
