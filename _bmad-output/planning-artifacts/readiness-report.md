---
title: Rapport de préparation à la construction — Nova Services
date: 2026-11-03
documents relus:
  - epics.md
  - prds/prd-coursenia-2026-11-03/prd.md
  - ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md et DESIGN.md
  - architecture/architecture-coursenia-2026-11-03/architecture.md
---

# Rapport de préparation à la construction

## 1. Verdict : **prêt avec corrections**

Le découpage est solide. Chaque FR, NFR et OPS du PRD, chaque écran d'EXPERIENCE.md, chaque règle AD-1 à AD-31 et chaque fonction SQL de l'architecture se retrouvent dans au moins une story. Aucune story n'invente de fonctionnalité absente des sources. Toutes les stories ont 2 à 4 critères au format « Étant donné… Quand… Alors… ».

Il faut pourtant corriger quelques points **avant de commencer** :
- **1 point bloquant** : il n'existe aucune donnée fictive de développement. Sans elles, Abraham ne peut pas vérifier à l'écran plusieurs critères (badges En cours, Traitée et Haute, pagination à 25, recherche « Dupont-Aïdi », effacement de jean.dupont, purge des demandes de plus de 2 ans, remise en état après la restauration).
- **17 points importants**. Trois stories sont trop grosses pour une seule séance (1.1, 1.5, 3.1). Il y a aussi des contradictions avec l'architecture (création des membres par les scripts, droits sur `infos_publiques`, tests lancés par le build Netlify) et plusieurs dépendances vers des stories futures (journal en 5.3, note de classement en 2.2, compte désactivé en 2.2 et 2.5).
- **22 points mineurs** : précisions de texte ou d'écran.

**Bilan : 40 écarts (1 bloquant, 17 importants, 22 mineurs).**

## 2. Liste des écarts

Pour chaque écart : la gravité, la story concernée, le problème, puis la solution proposée.

### Bloquant

**1. Bloquant — Story 1.6 (et 2.6, 2.7, 3.4, 5.3, 5.4) : aucune donnée fictive pour vérifier à l'écran.**
*Problème :* avant l'epic 2, le formulaire public ne crée que des demandes « Nouvelle / Normale / sans responsable ». En 1.6, Abraham ne peut donc pas voir les badges En cours, Traitée et Haute (critère 2). Pour dépasser 25 demandes (critère 3), il devrait remplir 26 formulaires, ce que l'anti-spam (5 envois en 10 minutes) rend presque impossible. Plus loin, d'autres critères supposent des données qu'aucune story ne crée : « Dupont-Aïdi » (2.6), les 3 demandes de jean.dupont (5.3), les demandes traitées depuis plus de 2 ans (5.4) et le retour du projet dev à « ses données fictives » (3.4). L'architecture prévoit bien `supabase/seed.sql` (AD-27), mais aucune story ne le crée.
*Solution :* ajouter à la story 1.6 la création de `supabase/seed.sql` et de deux commandes réservées au développement, qui refusent de viser la production :
- `npm run donnees:remplir` crée environ 40 demandes `TEST-` : tous les statuts, priorités, canaux et catégories ; certaines avec le collaborateur de test comme responsable ; « Dupont » et « Dupont-Aïdi » ; 3 demandes de jean.dupont@example.com ; 3 demandes traitées depuis plus de 2 ans ; 1 demande rouverte puis traitée récemment.
- `npm run donnees:vider` vide les demandes, pour voir l'état vide.

Ajouter un critère à 1.6 : « Étant donné que je lance `npm run donnees:remplir`, quand j'ouvre Demandes, alors je vois « 1–25 sur 40 » ». La story 2.6 complète ensuite ce script avec 2 000 demandes.

### Importants

**2. Important — Story 1.1 : trop grosse pour une séance.**
*Problème :* elle cumule la création du projet Next.js et de shadcn, le dépôt GitHub, le projet Supabase, la migration de verrouillage, le schéma `prive`, deux tables avec leurs données de départ, une fonction, trois fichiers `lib/`, Vitest, Playwright et axe, le thème DESIGN.md et la page du formulaire.
*Solution :* la couper en deux.
- **1.1a « Socle technique »** : projet, dépôt, Supabase dev, verrouillage des droits, schéma `prive`, outils de test, thème, `.env.example`. Critères : une page d'accueil provisoire en bleu marine et en police Inter ; `npm test` affiche un test vert ; `git status` ne montre pas `.env.local`.
- **1.1b « Afficher le formulaire »** : tables `categories` et `parametres`, `infos_publiques()`, la page, et les critères actuels.

**3. Important — Stories 1.1 et 1.2 : `infos_publiques()` et `lire_confirmation()` ne sont autorisées pour aucun rôle.**
*Problème :* AD-15 n'autorise `service_role` (la clé secrète) que sur 5 fonctions, et ces deux-là n'y sont pas. Or `anon` n'a aucun droit (AD-2). Un agent qui suit l'architecture à la lettre ne peut donc pas afficher les catégories du formulaire ni la page de confirmation.
*Solution :* dans la story, autoriser `service_role` à exécuter `infos_publiques` et `lire_confirmation`, et le noter dans l'architecture (AD-15). Créer dès 1.1 le client serveur à clé secrète (`lib/server/supabase-admin.ts`) et le client serveur de session (`lib/supabase/serveur.ts`). Aujourd'hui, aucune story ne les mentionne dans « À créer ».

**4. Important — Story 1.1 : le dépôt est public dès le premier jour, mais la recherche de secrets n'arrive qu'en 3.1.**
*Problème :* une clé envoyée par erreur sur GitHub pendant l'epic 1 ou 2 serait visible de tous.
*Solution :* installer dès 1.1 une recherche de secrets (par exemple gitleaks, avant chaque commit ou dans une petite tâche GitHub Actions). Ajouter une vérification automatique : « un faux secret ajouté à un fichier bloque le commit ».

**5. Important — Story 1.4 : l'en-tête qui donne l'adresse IP n'existe pas sur le PC.**
*Problème :* l'IP est lue dans `x-nf-client-connection-ip`, un en-tête ajouté par Netlify. En local, il est absent : la limite de 5 envois ne sait pas qui compter, et le critère 1 ne peut pas être vérifié sur le PC. L'architecture (§10.4) demande de confirmer cet en-tête sur une prévisualisation Netlify, qui n'existe qu'en 3.1.
*Solution :*
- Hors Netlify seulement, utiliser une valeur de repli (`x-forwarded-for`, ou « local »), écrite et testée.
- Ajouter à 3.1 la vérification « l'anti-spam bloque bien au 6e envoi sur la prévisualisation Netlify ».
- Nommer la variable secrète, par exemple `SECRET_EMPREINTES`.

**6. Important — Story 1.5 : trop grosse.**
*Problème :* elle contient la table `membres`, deux fonctions `prive`, `tentatives_connexion`, l'action de connexion avec blocage, `proxy.ts` avec la limite de 8 h, deux mises en page, le menu latéral complet et deux scripts.
*Solution :* la couper en deux.
- **1.5a « Se connecter et se déconnecter »** : `membres`, scripts, action de connexion simple, `proxy.ts` (renvoi vers la connexion), mises en page, menu, page d'accueil provisoire et page « accès refusé ». Critères 1, 3 et 4.
- **1.5b « Bloquer les tentatives et limiter la session »** : `tentatives_connexion`, blocage après 5 échecs, déconnexion après 8 h, ligne de journal `connexion`. Critère 2.

**7. Important — Story 1.5 : les scripts créent des membres sans passer par `creer_membre`.**
*Problème :* `scripts/premier-admin.ts` et `scripts/comptes-de-test.ts` doivent créer une ligne `membres`. Mais `creer_membre` n'arrive qu'en 4.1, et AD-17 interdit « deux façons de créer la ligne `membres` ». Il faut aussi que ces comptes soient directement « Actif », pas « Invité ».
*Solution :* créer `creer_membre` dès 1.5, exécutable seulement avec la clé secrète. Lui ajouter un paramètre « état initial `actif` », réservé aux scripts. La story 4.1 la réutilise.

**8. Important — Story 1.5 : un collaborateur n'a pas le droit de lire son propre rôle.**
*Problème :* l'architecture (§4.2) ne laisse un collaborateur lire que l'identifiant, le nom et l'état dans `membres`. Le critère 1 demande pourtant d'afficher « mon nom et mon rôle » en bas du menu. De plus, `membres` n'a qu'un champ « nom », alors que l'écran dit « Bonjour [prénom] ».
*Solution :* ajouter une fonction `mon_profil()` (rôle `authenticated`) qui renvoie le nom et le rôle de la personne connectée. Écrire la règle « le prénom est le premier mot du nom ».

**9. Important — Stories 1.5 et 2.7 : la page d'arrivée `/equipe` n'est créée par personne avant 2.7.**
*Problème :* le critère 1 de 1.5 dit « j'arrive sur l'espace équipe… Bonjour [prénom] », mais 1.5 ne crée pas la page `/equipe`, et 2.7 la crée plus tard (« tableau de bord »). Si le menu affiche des liens vers des pages pas encore faites (Saisir, Comptes, Catégories…), le débutant tombe sur des pages d'erreur.
*Solution :*
- 1.5 crée une page `/equipe` minimale (« Bonjour [prénom] » et un lien vers Demandes), remplacée en 2.7 par le tableau de bord.
- Le menu n'affiche que les rubriques déjà construites ; chaque story ajoute la sienne.

**10. Important — Story 1.5 : la page « accès refusé » n'a ni page à protéger ni critère.**
*Problème :* le groupe « Administration » et la garde `/equipe/admin/*` (AD-28) arrivent en 1.5, mais aucune page d'administration n'existe avant 4.1. La page « Vous n'avez pas accès à cette page. » (UX-DR4) n'est vérifiée à l'écran nulle part.
*Solution :* 1.5 crée une page d'accueil d'administration provisoire, `/equipe/admin`. Ajouter le critère : « Étant donné que je suis le collaborateur de test, quand je tape `/equipe/admin`, alors je lis « Vous n'avez pas accès à cette page. » et un bouton « Retour au tableau de bord » ».

**11. Important — Story 2.2 : la note obligatoire du classement sans suite n'est visible nulle part.**
*Problème :* la table `notes` est créée en 2.2, mais le bloc « Notes internes » du détail n'arrive qu'en 2.4. Abraham ne peut donc pas voir que la note a bien été enregistrée.
*Solution :* construire **2.4 avant 2.2**, avec la table `notes` dans 2.4. Le critère 3 de 2.2 devient « …la demande passe à Traitée et la note apparaît dans Notes internes ». Remplacer aussi « l'historique l'indique » (critère 1) par le texte exact de la ligne.

**12. Important — Stories 2.2, 2.3 et 2.5 : des vérifications automatiques reposent sur des stories futures.**
*Problème :* « le responsable est désactivé » (2.2), « on ne peut pas attribuer à un compte désactivé » (2.5) et « une catégorie désactivée ne peut pas être choisie » (2.3) supposent des fonctions de désactivation qui n'existent qu'en 4.4 et 5.1.
*Solution :* déplacer ces vérifications dans 4.4 et 5.1. Sinon, écrire dans la story que le test prépare cet état lui-même avec la clé secrète, sur des données `TEST-`.

**13. Important — Story 3.1 : trop grosse, et les tests du build Netlify vont échouer.**
*Problème :*
- (a) La story cumule le projet de production, le site Netlify, les variables, les migrations en production, l'intégration continue, la protection de `main`, la version, l'étiquette, la recherche de secrets, `npm audit` et la désactivation des anciennes clés.
- (b) AD-11 fait lancer les tests au build Netlify, alors que ce build tourne avec les clés de production et qu'AD-27 interdit aux tests de viser la production : le build échouera.
- (c) Les tests GitHub ont besoin des clés du projet dev et des comptes de test comme secrets GitHub, ce qui n'est écrit nulle part.
- (d) La création du premier administrateur en production se heurte à la même interdiction.

*Solution :*
- Définir `npm run verifier` = vérification du code (lint), des types et des tests unitaires **sans base de données**.
- Couper la story en **3.1a « Intégration continue »** (tests sur GitHub avec les secrets du projet dev, `main` protégée, `npm audit`), à faire tôt, et **3.1b « Mise en ligne v1.0.0 »**.
- Prévoir une option explicite (par exemple `--production`) pour que `premier-admin.ts` accepte de viser la production.
- Brancher les prévisualisations Netlify sur le projet dev (architecture §8).

**14. Important — Story 3.4 : un essai de restauration sur une production vide ne prouve rien.**
*Problème :* le critère 4 de 3.1 laisse la production sans aucune demande. « Le même nombre de demandes » revient alors à comparer 0 avec 0. Le débutant ne sait pas non plus lire le nombre de demandes contenu dans une sauvegarde. Enfin, la remise du projet dev à ses données fictives dépend du script de l'écart 1.
*Solution :*
- Avant l'essai, déposer 3 demandes fictives en production avec le formulaire.
- La tâche GitHub affiche dans son résumé « Demandes dans la sauvegarde : 3 / dans le projet dev après restauration : 3 ».
- Remise en état : `npm run donnees:remplir` puis `scripts/comptes-de-test.ts`.
- Après 5.3, relancer l'essai une fois pour voir `rejouer_effacements` effacer à nouveau une demande.
- Effacer ensuite ces demandes de démonstration de la production (le PRD §8 demande une production sans données de test).

**15. Important — Story 4.1 : la ligne de journal « Compte créé » n'est demandée par aucune story.**
*Problème :* le critère de FR-26 (« Compte créé : Léo (Collaborateur), par Claire ») n'apparaît ni en 4.1 ni en 5.5. Seule 4.4 parle du journal.
*Solution :* ajouter à 4.1 la vérification « l'invitation est inscrite au journal (type `compte`) ». Ajouter à 5.5 le critère : « après l'invitation de Léo, je lis « Compte créé : Léo Martin (Collaborateur), par [mon nom] » ».

**16. Important — Stories 4.2 et 4.3 : on ne peut pas voir un « lien expiré » sans attendre 24 h.**
*Problème :* le critère 2 de 4.2 demande d'ouvrir un lien expiré. Pour un débutant, c'est irréalisable dans la séance.
*Solution :* reformuler à l'écran avec un lien **déjà utilisé** ou celui d'une invitation **annulée**, qui affichent le même message. L'expiration à 24 h est vérifiée par un test automatique. Ajouter à 4.1 le réglage de durée des liens dans Supabase (architecture §10.6).

**17. Important — Story 5.3 : le critère 3 consulte le journal, dont la page n'arrive qu'en 5.5.**
*Problème :* c'est une dépendance vers une story future. De plus, l'email recherché ne doit pas apparaître dans l'adresse de la page, pour ne pas laisser de donnée personnelle dans les historiques de navigation.
*Solution :* construire **5.5 avant 5.3** (les lignes de journal existent dès 1.3 et 1.5). Dans 5.3, faire la recherche par email avec une action serveur (envoi de formulaire), pas avec un paramètre d'adresse.

**18. Important — Story 5.4 : impossible de créer des demandes « traitées depuis plus de 2 ans ».**
*Problème :* `traitee_le` est posée par le déclencheur à l'heure actuelle (AD-22), et aucune fonction ne peut l'écrire. Le critère 1 ne peut donc pas être préparé.
*Solution :* le script de données fictives (écart 1) insère ces demandes avec une date `traitee_le` ancienne, déclencheur suspendu pendant l'insertion, en développement uniquement. Ajouter une demande rouverte puis retraitée récemment, qui ne doit pas être purgée (FR-24).

### Mineurs

**19. Mineur — Story 1.1 : le critère 4 est vague.** « Aux couleurs de DESIGN.md » ne se vérifie pas facilement. *Solution :* « le bouton « Envoyer ma demande » est bleu marine, le texte est en police Inter, les champs ont des coins arrondis ».

**20. Mineur — Stories 1.1 et 1.5 : le lien « Espace équipe » en pied de formulaire (EXPERIENCE §9.1) n'apparaît dans aucune story.** *Solution :* l'ajouter en 1.5, avec le critère « le lien mène à `/connexion` ».

**21. Mineur — Stories 1.2 et 1.3 : la confirmation affirme qu'un email a été envoyé.** Elle afficherait « Un email de confirmation vous a été envoyé. » avant que l'envoi existe (1.2) et en mode démonstration (aucun envoi). *Solution :* 1.2 n'affiche pas cette phrase ; 1.3 l'affiche seulement si l'état de l'email est `envoye`.

**22. Mineur — Story 1.2 : plusieurs éléments d'écran ne sont pas cités.** Il manque « Déposer une autre demande », « Copié » pendant 2 s, le compteur « 0 / 5 000 », le message « Cette page n'est plus disponible. » pour un jeton invalide, le bandeau d'erreur serveur avec saisie conservée (FR-2) et le parcours au clavier seul (NFR-6). *Solution :* ajouter un critère « je remplis et envoie le formulaire au clavier seul », et lister le reste dans « À créer ».

**23. Mineur — Story 1.4 : « rien n'est enregistré » ne se voit pas à l'écran avant 1.6.** *Solution :* « aucune page de confirmation n'apparaît ». Le contrôle en base reste dans les tests automatiques.

**24. Mineur — Story 1.5 : les tests de blocage pourraient bloquer le compte d'Abraham.** Après 5 échecs, son compte administrateur serait bloqué 15 minutes. *Solution :* ces tests utilisent uniquement les comptes `TEST-`.

**25. Mineur — Story 1.6 : certains éléments appartiennent à d'autres stories.** Le bouton « Saisir une demande » mène à une page créée en 2.8. Le menu replié sous 1 024 px relève du menu (1.5). *Solution :* n'afficher le bouton qu'à partir de 2.8 ; construire le menu replié en 1.5. Ajouter le tableau réduit sur tablette (EXPERIENCE §8).

**26. Mineur — Story 1.7 : les textes des 10 types d'historique ne sont pas fixés.** Seuls « créé » et « prise en charge » ont un texte. *Solution :* 1.7 définit dans `lib/domaine.ts` le texte de chaque type (par exemple « Statut : En cours → Traitée, par X »), que chaque story réutilise.

**27. Mineur — Story 2.1 : trois précisions manquent.**
- `lib/actions/demandes.ts` existe déjà depuis 1.2 (convention §6) : 2.1 le complète.
- Le composant des messages brefs (toasts) n'est listé nulle part.
- Le critère 3 demande deux navigateurs et deux comptes.

*Solution :* le préciser dans la story.

**28. Mineur — Story 2.5 : deux cas de la règle 2 et de la règle 4 manquent.** Il s'agit de la réattribution d'une demande En cours par un administrateur et de la libération, par un administrateur, de la demande d'un autre. *Solution :* ajouter ces deux critères.

**29. Mineur — Story 2.7 : plusieurs éléments d'EXPERIENCE §9.3 ne sont pas cités.** Il manque le bloc « Mes demandes en cours » (5 dernières, « Tout voir »), l'état vide avec « Copier le lien » et le bouton « Saisir une demande ». Le compteur « disparaît à 0 » est difficile à obtenir avec des données fictives. *Solution :* ajouter ces éléments ; construire 2.8 avant 2.7 ; vérifier le 0 après `npm run donnees:vider`.

**30. Mineur — Story 2.8 : des éléments visibles sont seulement en vérifications automatiques.** *Solution :* ajouter aux critères le message « Demande NOVA-… enregistrée. », le rappel « Pensez à informer le demandeur… » et l'absence de case de consentement.

**31. Mineur — Story 3.1 : le critère 4 ne peut pas être vérifié avant 4.1.** « Seulement le premier administrateur » demande la page Comptes, créée en 4.1. *Solution :* « la liste affiche « Aucune demande pour l'instant. » et je me connecte avec le premier administrateur ».

**32. Mineur — Story 3.2 : les variables Sentry dans Netlify ne sont pas citées.** *Solution :* les ajouter (adresse d'envoi Sentry, jeton de build). Préciser que la page de test d'erreur ne contient aucune donnée et reste réservée aux administrateurs.

**33. Mineur — Story 3.6 : le carnet d'usage de l'IA serait écrit de mémoire à la fin.** *Solution :* créer `docs/carnet-ia.md` en 1.1 et y ajouter une ligne à chaque story (ajouter ce point à la définition de « terminé »).

**34. Mineur — Story 4.1 : `/auth/confirmer` est présentée comme la page de choix du mot de passe.** EXPERIENCE §2.1 prévoit pour cela `/nouveau-mot-de-passe`. *Solution :* `/auth/confirmer` vérifie le lien, puis renvoie vers `/nouveau-mot-de-passe` (titre « Bienvenue chez Nova Services, Léo »). Ajouter la variable de l'adresse du site (par exemple `NEXT_PUBLIC_SITE_URL`) pour fabriquer les liens.

**35. Mineur — Story 4.1 : le lien « Réactiver ce compte » (FR-8) dépend de 4.4.** *Solution :* l'ajouter en 4.4.

**36. Mineur — Story 4.4 : modifier le nom ou le rôle d'un autre membre n'a pas de critère.** *Solution :* « je passe Léo Administrateur ; à sa page suivante, il voit le groupe Administration ».

**37. Mineur — Story 5.1 : « Renommer » n'a pas de critère.** Il manque aussi le conflit de nom à la réactivation et la colonne « nombre de demandes ». *Solution :* ajouter « je renomme une catégorie ; le nouveau nom s'affiche aussi sur les anciennes demandes ».

**38. Mineur — Story 5.5 : aucun auteur n'est prévu pour les événements sans membre.** C'est le cas d'un échec d'email ou d'un blocage de connexion. *Solution :* afficher « Système ».

**39. Mineur — Story 6.1 : rien n'est prévu à créer.** Il manque aussi des types d'historique pour « Accepter » et « Corriger », car la liste AD-19 est fermée. *Solution :* prévoir une petite étude (choix du fournisseur, lieu de traitement des données) avant la story, et ajouter les types d'historique.

**40. Mineur — Toutes les stories : exigence UX-DR9 et variables d'environnement.** UX-DR9 (accessibilité) n'est citée par aucune story, et le tableau de correspondance ne couvre pas les UX-DR. Les variables d'environnement sont dispersées ; `NEXT_PUBLIC_SUPABASE_URL` et la connexion de l'outil Supabase (`supabase link`) ne sont jamais citées. *Solution :* citer UX-DR9 dans 1.1b, 1.2, 2.2 et 4.1, et ajouter un tableau UX-DR → stories. Créer `.env.example` en 1.1, puis le compléter à chaque story qui ajoute une variable (1.3, 1.4, 3.2, 4.1).

## 3. Tableau de couverture

### PRD

| Exigence | Story | Couverture |
|---|---|---|
| FR-1 Formulaire public | 1.1, 1.2 | Complète (+ écarts 19, 22) |
| FR-2 Enregistrement et référence | 1.2 | Complète (erreur serveur : écart 22) |
| FR-3 Email de confirmation | 1.3, 1.7 | Complète (écart 21) |
| FR-4 Information et consentement | 1.1, 1.2, 5.2 | Complète |
| FR-5 Anti-spam | 1.4 | Complète (vérification locale : écart 5) |
| FR-6 Connexion | 1.5 | Complète (écart 6) |
| FR-7 Mot de passe oublié | 4.3 | Complète (écart 16) |
| FR-8 Invitation | 4.1, 4.2 | Partielle : réactivation proposée (écart 35) |
| FR-9 Modifier, désactiver | 4.4 | Partielle : modifier un autre membre (écart 36) |
| FR-10 Droits | 1.5, 2.5, 4.x, 5.x | Complète (page refusée : écart 10) |
| FR-11 Liste | 1.6 | Complète si données fictives (écart 1) |
| FR-12 Recherche et filtres | 2.6 | Complète |
| FR-13 Détail | 1.7 | Complète |
| FR-14 Prise en charge, attribution | 2.1, 2.5 | Partielle : réattribution (écart 28) |
| FR-15 Statut | 2.2 | Complète (écart 11) |
| FR-16 Priorité | 2.3 | Complète |
| FR-17 Notes | 2.4 | Complète |
| FR-18 Historique | 1.2, 1.7, epic 2, 4.4 | Complète (textes : écart 26) |
| FR-19 Tableau de bord | 2.7 | Partielle (écart 29) |
| FR-20 Catégories | 5.1 | Partielle : renommer (écart 37) |
| FR-21 Paramètres | 5.2 | Complète |
| FR-22 Effacement | 5.3 | Complète (écarts 1, 17) |
| FR-23 IA | 6.1 | Hors MVP (écart 39) |
| FR-24 Purge | 5.4 | Complète si données fictives (écart 18) |
| FR-25 Saisie interne | 2.8 | Complète |
| FR-26 Journal | 5.5 | Partielle : « Compte créé » (écart 15) |
| NFR-1 Accès côté serveur | 1.1, 1.5, puis chaque story | Complète |
| NFR-2 Secrets | 1.1, 3.1 | Complète, trop tardive (écart 4) |
| NFR-3 Environnements | 3.1 | Complète |
| NFR-4 Versions | 3.1 | Complète |
| NFR-5 Retour arrière | 3.5 | Complète |
| NFR-6 Accessibilité | chaque écran | Complète (clavier : écart 22) |
| NFR-7 Rapidité | 2.6 | Complète |
| NFR-8 Tests verts | 1.1, 3.1 | Complète (écart 13) |
| NFR-9 Sécurité de base | 1.2, 1.4, 1.5, 1.7, 3.1 | Complète |
| OPS-1 Erreurs | 3.2 | Complète |
| OPS-2 Journal | 1.3, 1.5, 4.x, 5.x | Complète (écart 15) |
| OPS-3 Sauvegarde | 3.3 | Complète |
| OPS-4 Restauration | 3.4 | Complète, mais essai sans valeur sans demandes en production (écart 14) |
| OPS-5, 6, 7 Documentation | 3.6 | Complète (carnet : écart 33) |

### Écrans d'EXPERIENCE.md (§2 et §9)

| Écran | Story | Couverture |
|---|---|---|
| Déposer une demande `/` | 1.1, 1.2, 1.4 | Complète (lien « Espace équipe » : écart 20) |
| Confirmation | 1.2, 1.3 | Complète (écarts 21, 22) |
| Connexion | 1.5 | Complète |
| Mot de passe oublié | 4.3 | Complète |
| Choisir un mot de passe | 4.1, 4.3 | Complète (adresse : écart 34) |
| Tableau de bord `/equipe` | (1.5), 2.7 | Partielle (écarts 9, 29) |
| Liste des demandes | 1.6, 2.6 | Complète |
| Détail | 1.7, 2.1 à 2.5 | Complète |
| Saisir une demande | 2.8 | Complète |
| Comptes | 4.1 à 4.4 | Complète |
| Catégories | 5.1 | Partielle (écart 37) |
| Paramètres | 5.2 | Complète |
| Données personnelles | 5.3, 5.4 | Complète |
| Journal | 5.5 | Complète |
| États communs (accès refusé, introuvable, réseau) | 1.5, 1.6, 1.7 | Partielle (écart 10) |

### Architecture

- **AD-1 à AD-31 :** chacune est citée par au moins une story.
- **Fonctions d'AD-4, `lister_comptes`, `infos_publiques` et `lire_confirmation` :** toutes ont une story. Corriger les droits d'`infos_publiques` et de `lire_confirmation` (écart 3) et créer `creer_membre` plus tôt (écart 7).
- **Tables :** toutes sont créées par une story, avant la story qui les lit. Seule exception : `notes`, à créer en 2.4 si l'on suit l'ordre proposé ci-dessous.
- **À ajouter :** `mon_profil()` (écart 8), le script de données fictives (écart 1) et les clients Supabase serveur (écart 3).

## 4. Ordre de construction proposé (du plus utile au moins utile)

Le principe : ce qui sert le besoin n° 1 d'Abraham (recevoir les demandes et les voir au même endroit) d'abord, puis le traitement, la mise en ligne, l'équipe et l'administration. L'ordre ne change par rapport à la numérotation que là où c'est justifié, et chaque story ne dépend que de stories déjà construites.

| # | Story | Pourquoi à cette place |
|---|---|---|
| 1 | 1.1a Socle technique | Tout en dépend ; recherche de secrets, `.env.example` et carnet IA dès le départ |
| 2 | 1.1b Afficher le formulaire | |
| 3 | 1.2 Envoyer ma demande | Le cœur du sujet : la demande est en base |
| 4 | 1.5a Se connecter (avec `creer_membre`, `mon_profil`, `/equipe` provisoire, accès refusé) | Nécessaire pour voir les demandes |
| 5 | 1.6 Liste (avec **données fictives**) | Besoin n° 1 d'Abraham |
| 6 | 1.7 Détail | Fin du besoin n° 1 |
| 7 | **3.1a Intégration continue** (avancée) | Peu coûteuse ; protège `main` et applique NFR-8 pour tout le reste |
| 8 | 1.3 Email de confirmation (avancée après le détail) | Utile mais pas nécessaire pour voir les demandes ; le bandeau de 1.7 est déjà en place |
| 9 | 1.4 Anti-spam | À faire avant la mise en ligne ; les données fictives évitent d'en dépendre |
| 10 | 1.5b Blocage et session de 8 h | Sécurité, avant la mise en ligne |
| 11 | 2.1 Prendre en charge | |
| 12 | **2.4 Note interne** (avant 2.2) | Rend visible la note du classement sans suite |
| 13 | 2.2 Statuts et classement sans suite | |
| 14 | 2.3 Priorité et catégorie | |
| 15 | 2.6 Recherche et filtres (avant 2.5) | Demandée par le cahier des charges (SM-3) ; plus utile que l'attribution, réservée aux administrateurs |
| 16 | 2.8 Saisie téléphone et email (avant 2.7) | Demandée par le sujet ; le tableau de bord affiche son bouton |
| 17 | 2.5 Libérer et attribuer | |
| 18 | 2.7 Tableau de bord | Le PRD dit qu'il « peut attendre » ; la liste filtrée suffit |
| 19 | 3.1b Mise en ligne v1.0.0 | |
| 20 | 3.3 Sauvegarde nocturne (avant 3.2) | Dès qu'il y a une production, ne rien perdre passe avant le suivi des erreurs |
| 21 | 3.2 Suivi des erreurs | |
| 22 | 3.4 Restauration (essai réel) | Avec quelques demandes en production (écart 14) |
| 23 | 3.5 Retour arrière (essai réel) | |
| 24 | 4.1 Inviter | |
| 25 | 4.4 Modifier, désactiver, réactiver (avant 4.3 et 4.2) | Sécurité : couper l'accès de quelqu'un qui part |
| 26 | 4.3 Mot de passe oublié | |
| 27 | 4.2 Renvoyer ou annuler une invitation | Contournable : on peut réinviter |
| 28 | **5.5 Journal** (en tête de l'epic 5) | Nécessaire au critère 3 de 5.3 ; les lignes existent depuis 1.3 |
| 29 | 5.1 Catégories | |
| 30 | 5.2 Paramètres | |
| 31 | 5.3 Effacement RGPD | Puis relancer l'essai 3.4 une fois pour `rejouer_effacements` |
| 32 | 5.4 Purge des demandes expirées | Le PRD dit qu'elle « peut attendre » |
| 33 | 3.6 Documentation (finalisée) | Elle décrit des fonctions de 2.8, 3.4, 3.5 et 4.3 ; le carnet IA est tenu depuis 1.1 |
| 34 | 6.1 Suggestion par l'IA | Après tout le reste, et après une étude du fournisseur |

**Condition pour suivre cet ordre :** créer la table `notes` en 2.4 plutôt qu'en 2.2. La table `journal` reste en 1.3, qui est construite avant 1.5b (blocage noté au journal). L'ordre reste compatible avec l'ordre des epics recommandé par le PRD §9.1 (parcours principal et sécurité, puis exploitation, puis compléments).
