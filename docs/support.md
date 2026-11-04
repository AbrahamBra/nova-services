# Support en deux niveaux

Quand un membre de l'équipe a un problème avec l'application, il s'adresse d'abord au **niveau 1**. Ce qui dépasse le niveau 1 passe au **niveau 2**.

## Qui fait quoi

- **Niveau 1 — l'administrateur** (un membre de l'équipe avec le rôle Administrateur dans l'application). Il répond aux questions d'usage (« comment je fais pour… »), aide en cas de mot de passe oublié, crée un compte ou débloque un compte.
- **Niveau 2 — le responsable technique** (pour le projet : Abraham). Il traite les pannes, les erreurs de l'application, les pertes de données et les failles de sécurité.

Les coordonnées de l'administrateur et du responsable technique sont dans la liste des contacts interne de Nova Services. Elles ne sont pas écrites ici, car ce dépôt est public.

## Délais

Les délais comptent en heures et jours **ouvrés** (du lundi au vendredi, hors jours fériés, aux heures de bureau). Ce sont des délais de **première réponse** : la personne sait que sa demande est prise en compte.

| Niveau | Type de problème | Délai |
|---|---|---|
| 1 | Tous | Sous 1 jour ouvré |
| 2 | Panne ou faille | Sous 2 heures ouvrées |
| 2 | Erreur sans blocage | Sous 2 jours ouvrés |

**Il n'y a pas d'astreinte.** En dehors des heures ouvrées (soir, week-end, jours fériés), les problèmes sont traités au mieux, sans délai garanti. C'est une limite assumée de ce projet.

## Comment le signaler

- **Niveau 1** : par email ou de vive voix à l'administrateur.
- **Niveau 2** : **par téléphone** pour une panne ou une faille ; par email dans les autres cas.

Dans tous les cas, donnez : ce que vous faisiez, ce que vous avez vu (message exact, ou capture d'écran **sans** donnée de client visible), l'heure, et la référence de la demande concernée (`NOVA-AAAA-NNNN`) s'il y en a une. N'envoyez jamais de mot de passe, ni par email ni par téléphone.

## Tableau des problèmes

| Problème | Niveau | Qui | Délai | Comment le signaler |
|---|---|---|---|---|
| Question d'usage (« comment changer le statut ? ») | 1 | Administrateur | 1 jour ouvré | Email ou de vive voix |
| Mot de passe oublié | 1 | Administrateur | 1 jour ouvré | Email ou de vive voix |
| Nouveau collègue : compte à créer | 1 | Administrateur | 1 jour ouvré | Email ou de vive voix |
| Compte bloqué après plusieurs mots de passe faux, ou compte désactivé par erreur | 1 | Administrateur | 1 jour ouvré | Email ou de vive voix |
| Collègue parti : compte à désactiver | 1 | Administrateur | 1 jour ouvré | Email ou de vive voix |
| L'application ne s'ouvre plus du tout | 2 | Responsable technique | 2 heures ouvrées | Téléphone, puis suivre la [fiche d'indisponibilité](exploitation/indisponibilite.md) |
| Message « Le serveur ne répond pas » sur une page, le reste fonctionne | 2 | Responsable technique | 2 jours ouvrés | Email |
| Email de confirmation non parti alors que l'adresse est autorisée | 2 | Responsable technique | 2 jours ouvrés | Email |
| Demandes disparues ou historique incomplet (perte de données) | 2 | Responsable technique | 2 heures ouvrées | Téléphone |
| Un collaborateur voit ou fait une action d'administration (faille) | 2 | Responsable technique | 2 heures ouvrées | Téléphone |
| Un mot de passe ou une clé a été écrit, envoyé ou montré par erreur (fuite) | 2 | Responsable technique | 2 heures ouvrées | Téléphone, puis voir [securite.md](securite.md#si-un-secret-a-fuité) |
| Tâche « Réveil » ou « Sauvegarde nocturne » rouge sur GitHub | 2 | Responsable technique | 2 jours ouvrés | Email |
| Alerte du suivi des erreurs (À compléter (story 3.3)) | 2 | Responsable technique | 2 jours ouvrés, 2 heures ouvrées si l'application est bloquée | Email (l'alerte arrive directement au responsable technique) |

Si l'administrateur ne sait pas résoudre un problème de niveau 1, il le transmet au niveau 2 par email.

Écrans de l'administrateur pour les comptes : création, À compléter (story 4.1) ; désactivation et réactivation, À compléter (story 4.2) ; mot de passe oublié, À compléter (story 4.3) ; blocage après plusieurs échecs, À compléter (story 1.9).

## Trois cas d'exemple

Ces cas sont **fictifs** : ils servent à vérifier que le tableau permet de classer et de traiter un problème. Les prénoms sont ceux des parcours d'exemple du PRD.

### Cas 1 — Mot de passe oublié (niveau 1)

- **Date :** lundi 02/11/2026, 9 h 10.
- **Problème :** Karim, technicien, ne se souvient plus de son mot de passe et ne peut pas se connecter.
- **Classement :** mot de passe oublié → niveau 1, administrateur, sous 1 jour ouvré, signalé de vive voix.
- **Ce qui a été fait :** Claire, administratrice, lui montre le lien « Mot de passe oublié » de la page de connexion (lien livré en story 4.3). Karim reçoit le lien et choisit lui-même un nouveau mot de passe ; Claire ne le voit jamais. Karim est reconnecté à 9 h 25.

### Cas 2 — L'application ne s'ouvre plus (niveau 2, panne)

- **Date :** mardi 03/11/2026, 14 h 00.
- **Problème :** Nadia, à l'accueil, ne peut plus ouvrir l'espace équipe ; le formulaire public ne s'affiche pas non plus. Même constat sur son téléphone.
- **Classement :** l'application ne s'ouvre plus → niveau 2, responsable technique, sous 2 heures ouvrées, signalé par téléphone.
- **Ce qui a été fait :** Nadia appelle Abraham à 14 h 05 et prévient l'équipe ; les appels sont notés sur une feuille. Abraham voit sur Supabase que le projet est en pause (la tâche « Réveil » était suspendue). Il relance le projet, réactive la tâche et la lance à la main : verte. Le site répond à 14 h 40. Nadia saisit ensuite les 2 appels notés. Cause notée : pas de commit depuis 60 jours ; la vérification mensuelle de [maintenance.md](exploitation/maintenance.md#limites-des-offres-gratuites) est rappelée à l'équipe.

### Cas 3 — Un collaborateur accède à l'administration (niveau 2, faille)

- **Date :** mercredi 04/11/2026, 10 h 30.
- **Problème :** Léo, collaborateur, signale qu'en tapant l'adresse d'une page d'administration, il voit la liste des comptes de l'équipe alors qu'il ne devrait pas y avoir accès.
- **Classement :** un collaborateur voit une action d'administration → faille, niveau 2, responsable technique, sous 2 heures ouvrées, signalé par téléphone.
- **Ce qui a été fait :** Abraham rappelle Léo à 10 h 45 et lui demande de ne rien modifier. Il reproduit le problème avec le compte collaborateur de test, retrouve la vérification de rôle manquante, ajoute un test automatique qui doit échouer, corrige, et vérifie que le test passe. Une sauvegarde est lancée, puis la correction est mise en ligne avec une nouvelle version. Le journal de l'application est consulté : aucune modification faite par Léo. Comme Léo a vu les noms et emails de l'équipe, Abraham suit la section [Violation de données personnelles](securite.md#violation-de-données-personnelles) : il évalue le risque et note l'incident dans le registre des violations. L'incident est noté dans le carnet d'usage de l'IA si le code fautif avait été produit par l'IA.
