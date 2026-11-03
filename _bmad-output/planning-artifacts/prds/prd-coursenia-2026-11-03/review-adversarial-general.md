---
title: Revue adversariale — PRD Nova Services
date: 2026-11-03
cible: prd.md (draft du 2026-11-03)
références: docs/cahier-des-charges.md, .memlog.md, addendum.md
---

# Revue adversariale du PRD — Nova Services

## Synthèse

| Gravité | Nombre |
|---|---|
| Critique | 3 |
| Haute | 11 |
| Moyenne | 17 |
| Basse | 12 |
| **Total** | **43** |

Le PRD couvre toutes les fonctionnalités listées par le cahier des charges (CdC) et il est lisible. Ses faiblesses sont ailleurs : (1) trois contradictions de fond autour de la protection des données (accès anonyme, effacement contre historique immuable, conservation promise mais jamais mise en œuvre) ; (2) des règles de statut et d'attribution qui laissent des demandes orphelines ou incohérentes ; (3) une partie exploitation (§7), pourtant notée explicitement par le jury, sans aucun critère vérifiable ; (4) des hypothèses validées le 03/11 qui sont toujours présentées comme « à confirmer ».

Échelle : **critique** = contradiction ou trou qui rend le produit non conforme ou dangereux, à corriger avant UX/architecture ; **haute** = ambiguïté qui produira des stories fausses ou un écart visible pour le jury ; **moyenne** = manque qui coûtera du retravail ; **basse** = finition.

---

## Critique

### C1 — L'accès anonyme à la base n'est pas encadré
- **Emplacement :** NFR-1, règle 10 (§4), FR-2, SM-4 (§10), addendum.
- **Problème :** le formulaire public écrit dans la base sans compte. Avec la piste Supabase de l'addendum, la clé « anon » est publique, dans le navigateur. Le PRD n'exige nulle part que (a) un visiteur anonyme ne puisse **lire** aucune demande (ni liste, ni détail, ni catégories inactives, ni comptes) ; (b) un visiteur anonyme ne puisse **pas fixer lui-même** le statut, la priorité, le responsable, la référence ou la date de création (il pourrait s'attribuer la priorité Haute ou créer une demande déjà Traitée, ce qui contredit les règles 1 et 5). SM-4 ne teste que « non connecté sur une page interne » et « collaborateur sur une action d'administration ». Une page interne protégée ne prouve pas que les données sont protégées. C'est l'erreur classique d'un débutant sur Supabase, et elle exposerait toutes les données personnelles.
- **Correction proposée :** ajouter à NFR-1 (ou à une nouvelle exigence) et à SM-4 les critères suivants : « Un appel direct à la base ou à l'API sans connexion ne renvoie aucune demande, aucune note, aucun historique, aucun compte (test automatique) » et « Les champs statut, priorité, responsable, référence et date sont fixés par le serveur ; toute valeur envoyée par le formulaire est ignorée (test automatique) ».

### C2 — L'effacement RGPD contredit l'historique et les notes « jamais effacés »
- **Emplacement :** FR-22 contre règle 6, FR-17, FR-18 (critère « aucune action ne permet d'effacer une ligne ») et OPS-3.
- **Problème :** la règle 6 dit « Personne ne peut modifier ni effacer une ligne » et FR-17 « une note ne peut être ni modifiée ni supprimée ». Or FR-22 supprime « définitivement une demande et ses données », donc forcément ses lignes d'historique et ses notes, qui contiennent souvent des données personnelles (« Rappelée à 9 h… »). Le test serveur exigé par FR-18 entre en conflit direct avec FR-22. Autres trous : (a) le titre de FR-22 parle des « données d'un demandeur » mais le texte parle d'« une demande ». Si la même personne a déposé 3 demandes, rien ne dit comment les trouver toutes et les effacer ; (b) les sauvegardes quotidiennes (OPS-3) conservent les données effacées, et une restauration (OPS-4) les ferait réapparaître ; (c) le journal OPS-2 peut contenir l'email de la personne (échec d'envoi d'email).
- **Correction proposée :** reformuler la règle 6 : « Aucune ligne d'historique ni note ne peut être modifiée ou supprimée **individuellement** ; seule la suppression complète d'une demande par un administrateur (FR-22) ou la purge de conservation (voir C3) les supprime avec elle. » Adapter le critère de FR-18 en conséquence. Dans FR-22 : rechercher toutes les demandes d'un même email et les supprimer en une fois. Ajouter dans §8 et OPS-3 : « Les sauvegardes sont conservées N jours ; une donnée effacée disparaît des sauvegardes au plus tard après N jours ; après une restauration, les effacements tracés dans le journal sont rejoués. »

### C3 — La conservation de 2 ans est affichée au demandeur mais jamais appliquée
- **Emplacement :** §8 (conservation), FR-4 (critère durée), FR-21, §9.1, §12 hyp. 11.
- **Problème :** FR-4 affiche au demandeur une durée de conservation et FR-21 la rend réglable, mais **aucune FR ni OPS ne supprime quoi que ce soit** à l'échéance. Le §8 n'est d'ailleurs pas dans le périmètre MVP du §9.1, qui ne liste que les FR, NFR et OPS. Le produit fait donc une promesse RGPD qu'il ne tient pas, et le jury peut le relever. Cas non traités : demande restée Nouvelle ou En cours pour toujours (jamais purgée) ; Traitée → En cours → Traitée (le délai repart-il ?) ; changement de la durée dans FR-21 (rétroactif ou non ?) ; traçabilité de la purge ; effet sur l'historique (voir C2) ; mécanique d'exécution (tâche planifiée, que l'offre gratuite ne fournit pas toujours, ou action manuelle).
- **Correction proposée :** créer une FR-24 « Purge des demandes expirées » dans le MVP. Version simple pour un débutant : un bouton administrateur « Supprimer les demandes expirées » qui affiche le nombre concerné, demande confirmation et trace l'opération dans OPS-2 (une tâche automatique pourra venir plus tard). Fixer les règles : date de référence = dernier passage à Traitée ; une demande non traitée depuis plus de X ans est signalée à l'administrateur ; un changement de durée s'applique au prochain passage de purge. Ajouter un critère : « une demande Traitée il y a plus que la durée réglée n'apparaît plus après la purge ».

---

## Haute

### H1 — Les hypothèses validées sont toujours présentées comme « à confirmer »
- **Emplacement :** §0 (« [HYPOTHÈSE] … à confirmer »), §12 (titre), balises [HYPOTHÈSE] dans les règles 2, 3, 4 et 8, FR-5, FR-11, FR-17, NFR-6, NFR-7, OPS-2, OPS-3 et §8 ; `status: draft`.
- **Problème :** le memlog (dernière entrée) indique qu'Abraham a confirmé les 12 hypothèses telles quelles. Le PRD ne le dit nulle part. Un jury, ou un agent BMAD en aval, lira 12 points ouverts et pourra les rouvrir ou les traiter comme provisoires.
- **Correction proposée :** remplacer les balises par « [Hypothèse validée le 03/11/2026] », renommer le §12 en « Hypothèses validées », ajouter une ligne de validation en §0 et passer le statut à `validated` une fois les corrections faites.

### H2 — On peut passer une demande En cours sans responsable
- **Emplacement :** règle 1 contre règle 2, FR-15, FR-19.
- **Problème :** la règle 1 autorise Nouvelle → En cours comme simple changement de statut (FR-15, ouvert à tout membre selon la règle 3), hors de la prise en charge de la règle 2. Résultat : des demandes En cours sans responsable, que le compteur « Nouvelle sans responsable » de FR-19 ne voit plus et que personne ne suit. L'inverse se produit aussi : Traitée → En cours sur une demande dont le responsable a été désactivé.
- **Correction proposée :** écrire « Le passage Nouvelle → En cours se fait **uniquement** par la prise en charge (ou l'attribution par un administrateur) ; FR-15 ne propose pas ce passage. » Ajouter un critère : « aucune demande En cours n'est sans responsable ».

### H3 — Un responsable désactivé laisse des demandes orphelines
- **Emplacement :** règle 4, règle 7, FR-9, FR-14, FR-19.
- **Problème :** quand Léo est désactivé (UJ-3), ses demandes En cours gardent un responsable qui ne peut plus agir. La règle 4 interdit aux collaborateurs de les reprendre (elles « ont déjà un responsable »), seul un administrateur peut les réattribuer, et rien ne les signale : ni le tableau de bord, ni un filtre, ni FR-9. Elles tombent dans un angle mort, alors que le CdC cherche justement à éviter les oublis.
- **Correction proposée :** dans FR-9, critère : « Avant de désactiver un compte, l'administrateur voit le nombre de demandes non traitées dont il est responsable et peut les réattribuer. » Dans FR-19, ajouter un indicateur « demandes attribuées à un compte désactivé ». Autre option : la règle 4 permet à tout membre de reprendre une demande dont le responsable est désactivé.

### H4 — Le tableau de bord exige des filtres que FR-12 ne prévoit pas
- **Emplacement :** FR-19 (« chaque chiffre mène à la liste filtrée », « les chiffres correspondent à la liste filtrée ») contre FR-12.
- **Problème :** « Nouvelle sans responsable » demande une valeur « Sans responsable » dans le filtre responsable. « Haute non traitées » demande de filtrer sur plusieurs statuts (Nouvelle **ou** En cours) ou sur « non traitée ». FR-12 ne prévoit ni l'un ni l'autre : les critères de FR-19 ne peuvent pas être tenus.
- **Correction proposée :** compléter FR-12 : le filtre responsable propose « Sans responsable » et « Moi » ; le filtre statut propose « Non traitée » (Nouvelle + En cours) ou accepte plusieurs valeurs. Ajouter les critères correspondants.

### H5 — La saisie des demandes reçues par téléphone ou email via le formulaire public ne tient pas
- **Emplacement :** §2.2, §12 hyp. 1, FR-1, FR-4, FR-5, règle 6.
- **Problème :** le contexte du CdC, ce sont précisément des demandes qui arrivent « par email ou téléphone ». La solution retenue a plusieurs défauts : (a) le collaborateur coche la case de consentement à la place du client, ce qui n'a aucune valeur ; (b) l'email est obligatoire, donc un appelant sans email ne peut pas être saisi ; (c) au-delà de 5 saisies en 10 minutes depuis le bureau de Nova, la limitation de FR-5 bloque l'équipe ; (d) l'historique enregistre une création « anonyme », sans le collaborateur qui a saisi ni le canal d'origine ; (e) le client reçoit un email de confirmation sans l'avoir demandé. L'objectif central, centraliser, en sort affaibli.
- **Correction proposée :** au minimum, ajouter des règles explicites. Si la saisie a lieu depuis une session connectée : pas de limitation, canal enregistré (Formulaire / Téléphone / Email), auteur de la création = le collaborateur, case remplacée par « Le demandeur a été informé oralement », email facultatif si un téléphone est fourni. Sinon, assumer clairement dans le PRD que les demandes téléphone/email restent hors application dans le MVP, ce qui est risqué face au jury.

### H6 — La limitation des envois (FR-5) est mal définie
- **Emplacement :** FR-5, §12 hyp. 6, §8.
- **Problème :** « depuis une même connexion » n'est pas défini : adresse IP, navigateur, session ? Si c'est l'adresse IP, tous les salariés d'un même client derrière une même box ou un réseau d'entreprise, ainsi que l'équipe Nova (voir H5), partagent le quota. Si la limite est appliquée dans le navigateur, un robot la contourne. L'IP devient une donnée personnelle collectée, absente du §8. Rien ne dit non plus si la saisie est conservée après le refus.
- **Correction proposée :** définir « par adresse IP, vérifié côté serveur ». Exclure les sessions connectées. Préciser que l'IP n'est gardée que le temps de la fenêtre de 10 minutes et la déclarer au §8. Critères : « la saisie est conservée après le refus » ; « un envoi direct au serveur sans passer par la page est aussi limité ». Prévoir un repli plus simple (champ piège invisible pour les robots) si l'architecture ne permet pas une limitation par IP.

### H7 — L'exploitation et une partie des NFR n'ont aucun critère vérifiable
- **Emplacement :** §6 (NFR-2, 3, 4) et §7 (OPS-1, 2, 3, 5, 6, 7) ; §5 annonce pourtant des « critères de réussite observables ».
- **Problème :** le jury note explicitement logs, sauvegarde/restauration, retour arrière et documentation (section « Résultat attendu »). Seuls OPS-4 et NFR-5 sont couverts par SM-5. « Consultables par l'administration technique » (OPS-1) : où, par qui, comment ? « Sauvegardée chaque jour » (OPS-3) : comment le prouver ? Ces exigences deviendront des stories impossibles à clore.
- **Correction proposée :** donner à chaque OPS et NFR au moins un critère. Exemples : OPS-1 « une erreur provoquée volontairement apparaît dans l'outil de suivi en moins de 5 min, sans email ni mot de passe dans le message » ; OPS-3 « les 7 dernières sauvegardes datées sont listées » ; NFR-2 « un scan du dépôt ne trouve aucun secret ; `.env` est ignoré par Git ; un `.env.example` existe » ; NFR-3 « l'URL de la base de production n'apparaît pas dans la configuration de développement » ; OPS-7 « un fichier par thème, chacun d'une page au plus, existe dans `docs/` ».

### H8 — Mesures de sécurité de base absentes
- **Emplacement :** FR-6, FR-1, NFR-1, OPS-7 ; CdC « application… sécurisée et déployée ».
- **Problème :** le PRD ne mentionne nulle part : HTTPS obligatoire ; règle minimale de mot de passe (FR-8 et FR-7) ; limitation des tentatives de connexion (OPS-2 journalise les échecs mais ne les bloque pas) ; expiration de session ; affichage sûr du texte saisi par le public, alors que description et objet sont réaffichés dans l'espace interne (risque XSS) ; longueurs maximales des champs. Ce sont les premières questions d'un jury sur la sécurité.
- **Correction proposée :** créer une NFR-9 « Sécurité de base » avec des critères : site uniquement en HTTPS ; mot de passe d'au moins 12 caractères ; blocage temporaire après N échecs de connexion ; session expirée après X heures d'inactivité ; un texte `<script>` saisi dans une description s'affiche tel quel, sans être exécuté ; longueurs maximales pour chaque champ de FR-1.

### H9 — Désactivation et changement de rôle n'agissent pas sur les sessions ouvertes
- **Emplacement :** FR-9 (« ne peut plus se connecter »), FR-10, règle 7, addendum (rôle stocké dans les métadonnées de Supabase Auth).
- **Problème :** le critère ne vise que la **connexion**. Un compte désactivé ou rétrogradé pendant qu'il est connecté garde ses droits tant que son jeton reste valide (jusqu'à une heure par défaut avec Supabase, et le rôle est copié dans le jeton). Un salarié qui part ou un administrateur rétrogradé conserve donc un accès.
- **Correction proposée :** ajouter à FR-9 le critère : « Une action faite par un compte désactivé ou rétrogradé, avec une session déjà ouverte, est refusée par le serveur au plus tard à la requête suivante (test automatique). » Signaler la contrainte à l'architecture : vérifier l'état actif et le rôle dans la base, pas seulement dans le jeton.

### H10 — Sauvegarde et restauration : faisabilité et périmètre non définis
- **Emplacement :** OPS-3, OPS-4, §11.
- **Problème :** l'offre gratuite visée ne fournit pas forcément de sauvegarde quotidienne téléchargeable. Le PRD ne précise ni où les sauvegardes sont stockées (chez le même hébergeur, elles ne servent à rien si celui-ci tombe), ni combien de temps elles sont gardées, ni ce qu'elles contiennent (les comptes d'authentification sont-ils inclus ? les paramètres ?), ni le délai de restauration visé. Le lien avec l'effacement RGPD n'est pas traité (voir C2).
- **Correction proposée :** préciser dans OPS-3 : sauvegarde automatique quotidienne de la base **et** des comptes, copiée hors de l'hébergeur principal, gardée N jours (ce N sert aussi à C2). Ajouter une question ouverte « mécanisme de sauvegarde compatible avec l'offre gratuite » pour l'architecture. Dans OPS-4, viser un délai de restauration indicatif (par exemple moins d'une heure) et vérifier les comptes après la restauration.

### H11 — Trois FR du MVP dépendent d'un service d'email non choisi
- **Emplacement :** FR-3, FR-7, FR-8, §11 question 1.
- **Problème :** la confirmation, le mot de passe oublié et l'invitation exigent tous un envoi d'email vers des adresses quelconques. L'envoi intégré de Supabase (piste de l'addendum) est fortement limité en volume et réservé aux adresses de l'équipe du projet. Il ne peut donc pas envoyer la confirmation à un client. Le PRD présente cette dépendance comme une question ouverte mineure, alors qu'elle conditionne le MVP.
- **Correction proposée :** remonter la question 1 du §11 en risque majeur avec une décision à prendre au début de l'architecture (fournisseur SMTP tiers avec offre gratuite). Prévoir un plan de repli, par exemple confirmation à l'écran seulement si l'email n'est pas disponible le jour de la démonstration.

---

## Moyenne

### M1 — Pas de tableau de correspondance CdC → exigences
- **Emplacement :** tout le document.
- **Problème :** le jury note par rapport au CdC. Les balises [CdC] sont dispersées et certaines puces du CdC (« accessible en ligne », « identifier les versions déployées », « coordonnées ») n'ont pas d'exigence qui leur correspond clairement.
- **Correction proposée :** ajouter une annexe d'une page avec, pour chaque puce du CdC, l'exigence qui la couvre (FR, NFR ou OPS) et le critère qui la vérifie. Ajouter une exigence explicite « application accessible en ligne à une adresse publique » (aujourd'hui seulement implicite dans NFR-3).

### M2 — La version en ligne n'est pas identifiable à l'écran
- **Emplacement :** NFR-4.
- **Problème :** « porte un numéro identifiable » : où ? Le CdC demande d'« identifier les versions déployées ».
- **Correction proposée :** critères : « chaque mise en ligne correspond à un tag Git `vX.Y.Z` » et « le numéro de version est affiché dans le pied de page de l'espace interne ».

### M3 — Le retour arrière ignore la base de données
- **Emplacement :** NFR-5, OPS-5.
- **Problème :** revenir au code précédent après une modification de la structure de la base (migration) peut casser l'application. La procédure ne dit rien des données ni des migrations.
- **Correction proposée :** préciser dans NFR-5 : « les modifications de structure de la base restent compatibles avec la version précédente, sinon la procédure prévoit la restauration de la sauvegarde prise juste avant la mise en ligne ». Ajouter « sauvegarde manuelle avant chaque mise en ligne ».

### M4 — Journal des événements incomplet et renvois croisés incohérents
- **Emplacement :** OPS-2, FR-3 (« suivi des erreurs (§7) »), FR-22 (« journal des événements (§7) »).
- **Problème :** OPS-2 ne prévoit ni les changements de rôle, ni les réactivations, ni les modifications de paramètres et de catégories, ni les purges (C3), ni les dépassements de limite (FR-5). FR-3 renvoie au « suivi des erreurs » (OPS-1) alors que les échecs d'email sont rangés dans OPS-2. Le journal contient des emails (connexions échouées) mais n'a ni durée de conservation ni contrainte « sans données sensibles », contrairement à OPS-1.
- **Correction proposée :** compléter la liste d'OPS-2 ; renvoyer précisément à « OPS-1 » ou « OPS-2 » plutôt qu'à « §7 » ; fixer une durée de conservation du journal (par exemple 12 mois) et interdire d'y copier le contenu des demandes.

### M5 — Échec de l'email de confirmation : invisible pour l'équipe
- **Emplacement :** FR-3.
- **Problème :** l'échec n'est visible que dans un journal technique. Le collaborateur qui ouvre la demande ignore que le client n'a rien reçu. Une adresse mal saisie par le client n'est jamais détectée. Aucun renvoi n'est prévu. Le contenu de l'email n'est pas limité : faut-il y recopier la description ?
- **Correction proposée :** critère : « le détail de la demande indique "Email de confirmation non envoyé" en cas d'échec ». Préciser que l'email ne contient que la référence, l'objet et le contact, sans la description.

### M6 — Cycle de vie des comptes incomplet
- **Emplacement :** FR-8, FR-9, UJ-3 ; CdC « permettre la gestion des comptes utilisateurs ».
- **Problème :** rien sur l'expiration d'une invitation, son renvoi ou son annulation ; ni sur un email déjà pris par un compte **désactivé** ; ni sur la modification du nom ou de l'email d'un compte. Un membre ne peut pas changer son propre mot de passe une fois connecté. « Gestion » se réduit à créer, changer le rôle et désactiver.
- **Correction proposée :** compléter FR-8 et FR-9 : invitation valable N jours, bouton « Renvoyer l'invitation », modification du nom par l'administrateur, message spécifique quand l'email appartient à un compte désactivé (« réactivez-le »). Ajouter « changer mon mot de passe » ou le renvoyer explicitement vers FR-7.

### M7 — Règles d'attribution incomplètes
- **Emplacement :** règle 2, règle 4, FR-14.
- **Problème :** un responsable ne peut pas rendre une demande (se désister). L'administrateur peut-il retirer le responsable ? Quand un administrateur attribue une demande Nouvelle, passe-t-elle En cours comme avec la règle 2 ? Peut-on attribuer à un compte « Invité » ?
- **Correction proposée :** trancher dans la règle 4 : attribution par un administrateur = même effet que la prise en charge (passage En cours) ; responsable possible seulement parmi les comptes actifs ; « Libérer la demande » ouvert au responsable, avec une ligne d'historique.

### M8 — Cas limites des catégories
- **Emplacement :** FR-20, règle 9.
- **Problème :** si toutes les catégories sont désactivées, le formulaire devient inutilisable, puisque la catégorie est obligatoire. Renommer une catégorie change l'affichage des anciennes demandes : est-ce voulu ? Réactiver une catégorie dont le nom est déjà pris par une catégorie active n'est pas couvert, la règle d'unicité ne visant que les catégories actives.
- **Correction proposée :** critères : « il reste toujours au moins une catégorie active » ; « réactiver une catégorie dont le nom est déjà actif est refusé » ; « un renommage s'applique aussi aux anciennes demandes » (à assumer explicitement).

### M9 — Spam et doublons : aucune manière de les classer
- **Emplacement :** règle 1, FR-22 ; le CdC cite les « doublons » comme problème.
- **Problème :** Nouvelle → Traitée est interdit. Un spam ou un doublon doit donc être pris en charge, puis marqué Traitée, ce qui fausse les compteurs, ou supprimé par la procédure RGPD de FR-22, ce qui la détourne de son but.
- **Correction proposée :** autoriser Nouvelle → Traitée avec une note obligatoire (« doublon de NOVA-… », « spam »), ou ajouter un motif de clôture. Rester sur les trois statuts imposés pour ne pas alourdir le produit.

### M10 — Critère « bouton retour » peu fiable
- **Emplacement :** FR-6, 3e critère.
- **Problème :** le cache des navigateurs peut réafficher une page déjà chargée. Le critère est difficile à garantir et à tester tel quel.
- **Correction proposée :** reformuler : « après déconnexion, toute action ou tout rechargement d'une page interne renvoie vers la connexion ; les pages internes sont servies sans mise en cache ».

### M11 — Le compteur du menu est ambigu
- **Emplacement :** FR-19, 2e critère ; memlog Tour 3.
- **Problème :** « nouvelles demandes » : statut Nouvelle, Nouvelle sans responsable, ou demandes non vues depuis la dernière visite ? Est-il mis à jour en direct ou au chargement de la page ?
- **Correction proposée :** « compteur = demandes au statut Nouvelle sans responsable, mis à jour à chaque chargement de page » (sans temps réel dans le MVP).

### M12 — §8 « Rien d'autre » est inexact
- **Emplacement :** §8 « Données collectées ».
- **Problème :** l'application collecte aussi l'adresse IP (FR-5), les traces de connexion (OPS-2) et les données des membres de l'équipe (nom, email, actions). FR-23 enverrait le contenu des demandes à un service d'IA tiers, peut-être hors de l'UE, ce que le texte de consentement de FR-4 ne mentionne pas.
- **Correction proposée :** lister toutes les catégories de données avec leur durée de conservation. Ajouter à FR-23 une condition : mise à jour de la mention d'information et choix d'un fournisseur conforme au RGPD avant d'activer la fonction.

### M13 — Support en deux niveaux sans canal ni critère d'escalade
- **Emplacement :** OPS-6, §11 question 3.
- **Problème :** OPS-6 ne dit pas comment un incident arrive au niveau 1 (canal), selon quel critère il passe au niveau 2, avec quel délai, ni qui tient le niveau 2 (question encore ouverte). Les demandeurs (« je n'ai pas reçu ma confirmation ») ne sont pas couverts.
- **Correction proposée :** ajouter un tableau simple : symptôme → niveau → qui → délai indicatif → canal. Nommer le niveau 2 (Abraham) au lieu de laisser la question ouverte.

### M14 — Contenu de la documentation sécurité, RGPD et IA non spécifié
- **Emplacement :** OPS-7, NFR-8 ; CdC « Présenter dans la documentation les principales mesures… » et section « Développer avec l'assistance de l'IA ».
- **Problème :** OPS-7 se contente d'une liste de titres. Rien n'impose de décrire les mesures d'accès (rôles, contrôle côté serveur), la base légale du traitement, les sous-traitants (hébergeur, service d'email), les droits des personnes ni la procédure d'effacement. Le CdC insiste sur l'usage vérifié de l'IA, mais aucune trace de cet usage n'est demandée comme livrable.
- **Correction proposée :** détailler le contenu minimal de chaque document d'OPS-7. Ajouter un livrable « journal d'usage de l'IA » (ce qui a été généré, comment c'était vérifié, quels tests) qui sert de preuve pour NFR-8.

### M15 — SM-1 et SM-3 sans protocole de mesure
- **Emplacement :** §10 SM-1, SM-3.
- **Problème :** qui sont les testeurs, combien sont-ils, comment le temps est-il mesuré ? Le « groupe pilote (séquence 9) » n'est pas défini par le CdC.
- **Correction proposée :** « 3 personnes extérieures au projet, chronométrées, données fictives ; résultats notés dans un tableau joint à la documentation ».

### M16 — FR-21 : validation et effets des paramètres non définis
- **Emplacement :** FR-21.
- **Problème :** seul l'email de contact a un critère. Rien sur le format de l'email, les bornes de la durée de conservation (0 ? 50 ans ?), l'effet d'un changement de durée (voir C3), ni l'historique des modifications de paramètres.
- **Correction proposée :** critères : email valide obligatoire ; durée entre 6 mois et 5 ans ; changement tracé dans OPS-2 ; texte de FR-4 mis à jour aussitôt.

### M17 — Ajouts au-delà du CdC lourds pour un débutant
- **Emplacement :** FR-5 (limitation par IP), FR-8 (invitation avec états), FR-14 (concurrence), FR-19 (tableau de bord et compteur), NFR-7 (test de performance), FR-23 ; SM-C1 dit pourtant « moins de fonctions, toutes testées ».
- **Problème :** aucun de ces éléments n'est exigé par le CdC. Chacun ajoute de l'infrastructure (limitation côté serveur, email transactionnel, requêtes d'agrégation, jeu de 2 000 demandes). Ensemble, ils contredisent SM-C1 et menacent la partie exploitation, elle exigée.
- **Correction proposée :** classer explicitement ces éléments en « MVP+ » à livrer après OPS-1 à OPS-7. Prévoir des versions minimales : champ piège plutôt que limitation par IP ; tableau de bord = 3 liens filtrés sans graphique ; NFR-7 vérifié une seule fois sur l'environnement de développement.

---

## Basse

### B1 — Sources mal étiquetées
- **Emplacement :** règle 10 (« [CdC : … ; principe de la séquence 8] »), §8 (« [CdC séquence 9 + Décision] »).
- **Problème :** [CdC] désigne le cahier des charges, qui ne parle ni de séquence 8 ni de séquence 9. Le jury peut y voir une citation inexacte.
- **Correction proposée :** créer une balise [Cours] pour les supports de séquence.

### B2 — « Qui » pour la création, et nombre de lignes d'historique pour une prise en charge
- **Emplacement :** FR-18, règle 6.
- **Problème :** le demandeur n'a pas de compte : que montre la colonne « qui » d'une création ? La prise en charge crée-t-elle une ligne ou deux (responsable + statut) ?
- **Correction proposée :** « Création, par Sophie Martin (formulaire public) » ; prise en charge = deux lignes, ou une ligne combinée, à trancher.

### B3 — Format de la référence
- **Emplacement :** FR-2, glossaire.
- **Problème :** la numérotation repart-elle à 1 chaque année ? Que se passe-t-il au-delà de 9999 ? L'unicité doit tenir quand deux envois arrivent en même temps.
- **Correction proposée :** « compteur annuel, au moins 4 chiffres, unicité garantie par la base ».

### B4 — L'addendum n'est pas référencé
- **Emplacement :** §0, §11.
- **Problème :** le memlog demande de garder la piste Supabase/RLS dans l'addendum, mais le PRD n'y renvoie jamais. L'architecte risque de ne pas le lire.
- **Correction proposée :** ajouter un lien vers `addendum.md` au §11.

### B5 — Champs du formulaire sans longueurs ni conservation de la saisie après refus
- **Emplacement :** FR-1, FR-5.
- **Problème :** aucune longueur maximale (risque d'abus) ; FR-5 ne dit pas que la saisie est conservée après un refus.
- **Correction proposée :** fixer des longueurs maximales (par exemple description ≤ 5 000 caractères) et ajouter « saisie conservée » à FR-5.

### B6 — « Sauvegarde » ambigu dans NFR-8
- **Emplacement :** NFR-8.
- **Problème :** « avant chaque sauvegarde » peut désigner un commit Git ou une sauvegarde de base (OPS-3).
- **Correction proposée :** écrire « avant chaque commit sur la branche principale et chaque mise en ligne ».

### B7 — NFR-7 : environnement de mesure non précisé
- **Emplacement :** NFR-7, §8 (données de test).
- **Problème :** 2 000 demandes fictives ne peuvent pas être chargées en production (§8). Sur quel environnement mesure-t-on ?
- **Correction proposée :** « mesuré sur l'environnement de développement avec 2 000 demandes fictives ».

### B8 — Décision « pas d'email à l'équipe » absente
- **Emplacement :** §9.2 et §9.3 ; memlog Tour 3.
- **Problème :** la décision de ne pas notifier l'équipe par email n'est écrite nulle part dans le PRD. Elle risque d'être réintroduite en aval.
- **Correction proposée :** ajouter « Notification email à l'équipe pour chaque nouvelle demande » dans le §9.2.

### B9 — Contenu de l'historique : ajout non signalé
- **Emplacement :** règle 6 ; memlog Tour 2.
- **Problème :** la décision du memlog ne liste pas le « changement de responsable ». Le PRD l'ajoute (à juste titre) sous l'étiquette [Décision].
- **Correction proposée :** l'étiqueter « [Déduit de la règle 4] » pour rester exact.

### B10 — Affirmation non sourcée sur le jury
- **Emplacement :** §9.2, FR-23 (« Bonus apprécié par le jury »).
- **Problème :** l'affirmation n'est appuyée sur rien dans le CdC.
- **Correction proposée :** remplacer par « Le CdC autorise des fonctions supplémentaires qui améliorent l'expérience ».

### B11 — Garde-fous administrateur incomplets
- **Emplacement :** règle 8.
- **Problème :** un administrateur seulement « Invité » compte-t-il comme administrateur actif ? Deux administrateurs peuvent se désactiver mutuellement en même temps.
- **Correction proposée :** « au moins un administrateur à l'état Actif ; la vérification se fait au moment de l'enregistrement ».

### B12 — Règles de recherche imprécises
- **Emplacement :** FR-12.
- **Problème :** recherche partielle ? sensible à la casse et aux accents ?
- **Correction proposée :** « recherche partielle, insensible à la casse et aux accents » (ou assumer l'inverse).
