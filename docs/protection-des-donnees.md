# Protection des données personnelles

## Ce qui est gardé, pourquoi et combien de temps

| Données | Pourquoi | Durée de conservation | Appliquée automatiquement ? |
|---|---|---|---|
| Demandeurs : nom, email, téléphone, société, contenu de la demande | Traiter la demande | Durée réglée (2 ans par défaut) après le dernier passage à Traitée, puis purge | Pas encore : la purge sera lancée par un administrateur. À compléter (epic 5). |
| Membres de l'équipe : nom, email, rôle | Connexion et traçabilité | Tant que le compte existe ; le nom reste dans les historiques | — |
| Adresse IP des visiteurs (gardée sous forme d'empreinte) | Anti-spam | 1 heure | Pas encore (nettoyage nocturne `purger_technique`). À compléter (story 3.2, partie SQL). |
| Tentatives de connexion (empreintes) | Bloquer les essais répétés de mots de passe | 1 jour | Pas encore (`purger_technique`). À compléter (story 3.2, partie SQL). |
| Journal | Sécurité et suivi | 1 an | Pas encore (`purger_technique`). À compléter (story 3.2, partie SQL). |
| Sauvegardes | Restauration | 30 jours | Oui : GitHub les supprime au bout de 30 jours. |

## Rien d'autre

Rien d'autre n'est collecté : pas de suivi publicitaire, pas d'outil de mesure d'audience. Les adresses IP des visiteurs et les emails des tentatives de connexion ne sont pas gardés tels quels : ils sont transformés en une **empreinte HMAC**, un code calculé avec un secret du serveur, qu'on ne peut pas retransformer en adresse.

## Information des demandeurs

- **Formulaire public** : une phrase sous le formulaire dit à quoi servent les données et combien de temps elles sont gardées ; le demandeur coche une case pour accepter.
- **Demande reçue par téléphone ou email** : le membre de l'équipe qui la saisit informe la personne oralement ou par écrit.

## Droit à l'effacement

Une personne peut demander que ses données soient effacées. L'administrateur retrouve ses demandes par son email et les efface définitivement, avec leur historique et leurs notes. À compléter (epic 5) : écran et procédure exacts.

Les sauvegardes qui contiennent encore ces données disparaissent d'elles-mêmes au bout de 30 jours. Si une sauvegarde plus ancienne que l'effacement est restaurée, l'effacement devra être refait, avec la fonction `rejouer_effacements()` qui sera créée à la story 3.4 (voir [restauration.md](exploitation/restauration.md)). À compléter (story 3.4).

## Données de test

Pendant le développement, on n'utilise que des données **fictives**, préfixées « TEST- ». Elles sont retirées de la production avant l'ouverture au public. Les tests automatiques refusent de tourner sur la base de production.

## Qui traite les données, et où

| Service | Ce qu'il voit ou garde | Où |
|---|---|---|
| Supabase | La base de données : toutes les données du tableau ci-dessus. | Irlande (région `eu-west-1`, Union européenne), développement comme production. |
| Netlify | Héberge le site ; voit passer les adresses IP des visiteurs et le contenu des formulaires envoyés. | Région et base du transfert hors UE : À compléter (story 3.1). |
| Resend | Envoie les emails : voit les adresses email des demandeurs et le texte de l'email de confirmation. | Région et base du transfert hors UE : À compléter (story 3.1). |
| GitHub | Garde les sauvegardes, **chiffrées** et illisibles sans la phrase secrète, pendant 30 jours. Le stockage peut être hors de l'UE. | Base du transfert : À compléter (story 3.1). |
| Sentry | Suivi des erreurs, sans aucune donnée personnelle. | Région UE. À compléter (story 3.3). |

## Emails en mode démonstration

Le projet n'a pas de nom de domaine payant. Le service d'envoi d'emails (Resend) n'écrit donc **qu'à l'adresse d'Abraham** (variable `EMAILS_AUTORISES`). Pour toute autre adresse, la demande est bien enregistrée, mais l'email ne part pas et le détail de la demande l'indique. C'est un choix assumé pour la formation (budget 0 €).

Passage en vraie production : vérifier un nom de domaine chez Resend (environ 10 € par an), sans changer le code.
