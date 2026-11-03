# Cahier des charges — Nova Services

Sujet fourni par la formation « Concevoir, développer et déployer des applications avec l'IA ».

## Contexte du projet

Vous rejoignez Nova Services, une entreprise spécialisée dans l'accompagnement et les services numériques auprès de professionnels.

L'entreprise reçoit chaque semaine de nombreuses demandes provenant de ses clients et prospects : demandes d'informations, problèmes techniques, demandes de rendez-vous, questions administratives ou sollicitations nécessitant l'intervention d'un collaborateur.

Aujourd'hui, ces demandes arrivent principalement par email ou téléphone. Elles sont ensuite retranscrites manuellement dans différents fichiers, ce qui entraîne des oublis, des doublons et un manque de visibilité sur leur traitement.

La direction souhaite disposer d'une application simple permettant de centraliser les demandes et de suivre leur traitement.

## Mission

Votre mission est de concevoir, développer et mettre en production cette application en utilisant une approche de développement assistée par l'IA.

Lors de votre première réunion avec la direction, plusieurs besoins sont exprimés.

Les clients doivent disposer d'un moyen simple pour transmettre une demande et savoir qu'elle a bien été enregistrée.

De leur côté, les collaborateurs doivent pouvoir retrouver l'ensemble des demandes, consulter leur contenu, identifier celles qui nécessitent une intervention et suivre leur évolution.

Avant de commencer le développement, vous devrez analyser le besoin, identifier les utilisateurs concernés, définir les principales fonctionnalités et organiser votre projet.

## L'application à développer

Vous devez créer une application web de gestion des demandes clients.

L'application devra proposer les fonctionnalités suivantes :

- permettre à un client ou prospect de déposer une demande ;
- renseigner son nom, ses coordonnées, l'objet, la catégorie et la description de sa demande ;
- enregistrer les demandes dans une base de données ;
- afficher une confirmation après l'envoi d'une demande ;
- permettre aux collaborateurs de se connecter à un espace sécurisé ;
- afficher la liste des demandes reçues ;
- consulter le détail d'une demande ;
- rechercher ou filtrer les demandes ;
- modifier le statut d'une demande ;
- gérer au minimum les statuts Nouvelle, En cours et Traitée ;
- conserver un historique simple du traitement d'une demande ;
- permettre la gestion des comptes utilisateurs ;
- différencier les droits d'un collaborateur et d'un administrateur ;
- permettre à un administrateur de gérer les principaux paramètres nécessaires au fonctionnement de l'application.

Vous pouvez ajouter d'autres fonctionnalités si elles améliorent l'expérience utilisateur ou facilitent le travail des équipes de Nova Services.

## Développer l'application avec l'assistance de l'IA

Nova Services souhaite expérimenter une méthode de développement dans laquelle l'intelligence artificielle accompagne le développeur pendant la réalisation du projet.

Vous pouvez utiliser les outils de développement assisté par l'IA de votre choix pour vous aider à :

- concevoir la structure de l'application ;
- préparer les interfaces ;
- générer certaines parties du code ;
- créer les fonctionnalités ;
- résoudre des erreurs ;
- améliorer le code et les interfaces ;
- produire une partie de la documentation technique.

Les éléments générés avec l'IA devront être compris, vérifiés et testés avant leur intégration dans l'application. Vous restez responsable du fonctionnement de la solution finale.

## Préparer la mise en production

Lorsque la première version de l'application est fonctionnelle, Nova Services souhaite pouvoir l'utiliser dans des conditions réelles.

- Préparer un environnement de production permettant de rendre l'application accessible en ligne.
- Séparer correctement les paramètres propres au développement et à la production.
- Ne pas enregistrer directement dans le code source les identifiants, mots de passe, clés et autres informations sensibles.
- Versionner le projet afin de conserver l'historique des modifications et d'identifier les versions déployées.
- Prévoir une procédure permettant de revenir à une version précédente si une mise à jour provoque un dysfonctionnement.

## Assurer le fonctionnement de l'application

- Mettre en place un dispositif simple permettant de consulter les erreurs et les événements importants de l'application.
- Sauvegarder les données nécessaires au fonctionnement de la plateforme, avec une procédure précisant comment les restaurer en cas de problème.
- Prévoir les principales actions à réaliser en cas d'indisponibilité du service.
- Organiser simplement le support pour distinguer les problèmes traités par un premier niveau d'assistance de ceux nécessitant une intervention technique plus avancée.
- Présenter dans la documentation les principales mesures concernant les accès, la sécurité et la protection des données personnelles.

## Résultat attendu

À la fin du challenge, Nova Services doit disposer d'une application web fonctionnelle, sécurisée et déployée permettant de centraliser et suivre les demandes de ses clients.

La solution devra notamment comprendre :

- une interface de dépôt des demandes ;
- un espace interne authentifié ;
- une gestion des utilisateurs et des droits ;
- une gestion des demandes et de leurs statuts ;
- une base de données ;
- une application versionnée et accessible en ligne ;
- un dispositif de logs et de suivi des erreurs ;
- une stratégie de sauvegarde et de restauration ;
- une procédure de retour à une version précédente ;
- une documentation synthétique concernant le déploiement, la maintenance, le support, la sécurité et la protection des données.
