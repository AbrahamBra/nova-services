# Epic 5 Context: Administrer les paramètres et les données

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

L'administrateur consulte le journal des événements importants (qui a fait quoi sur les comptes, les réglages et les données), règle ce qui fait fonctionner l'application (catégories du formulaire, nom et email de contact affichés, durée de conservation) et respecte les droits des personnes sur leurs données : il efface sur demande toutes les demandes d'une personne (droit à l'effacement RGPD) et supprime en une fois les demandes traitées depuis plus longtemps que la durée promise. C'est ce qui rend l'application administrable sans développeur et conforme à ce qui est annoncé aux demandeurs.

## Stories

- Story 5.1 : Consulter le journal des événements
- Story 5.2 : Gérer les catégories
- Story 5.3 : Modifier les paramètres généraux
- Story 5.4 : Effacer les données d'une personne
- Story 5.5 : Supprimer les demandes expirées

## Requirements & Constraints

- **Réservé aux administrateurs actifs** : pages `/equipe/admin/journal`, `categories`, `parametres`, `donnees` et leurs actions. Un collaborateur est refusé à l'adresse comme à l'appel direct de l'action (vérifié côté serveur).
- **Journal** : du plus récent au plus ancien, 50 lignes par page, filtre par type. Colonnes date, type, description, auteur ; « Système » quand aucun membre n'est à l'origine (échec d'email, blocage de connexion). Types fermés : `compte`, `parametre`, `categorie`, `donnees`, `email`, `connexion`. **Aucune donnée de demandeur** dans une ligne (test automatique). Conservé 1 an.
- **Catégories** (règle 9) : ajouter, renommer, désactiver, réactiver. Il reste toujours au moins une catégorie active (« Il doit rester au moins une catégorie active. »). Nom unique sans tenir compte des majuscules ni des accents (« formation », « Formatión » refusés si « Formation » existe), y compris à la réactivation et au renommage. Une catégorie ajoutée apparaît aussitôt dans le formulaire public ; renommée, elle s'affiche avec son nom actuel partout, anciennes demandes comprises ; désactivée, elle disparaît du formulaire public et du choix de catégorie du détail mais reste sur les anciennes demandes, et `changer_categorie` la refuse. Chaque changement est journalisé (type `categorie`).
- **Paramètres** : nom affiché, email de contact, durée de conservation de 6 à 60 mois (2 ans par défaut). Email mal formé ou durée hors bornes refusés sous le champ. Un changement apparaît aussitôt sur le formulaire public, la page de confirmation et le prochain email de confirmation. Journalisé (type `parametre`).
- **Effacement RGPD** : recherche par email (normalisé en minuscules, pour ne rien oublier entre `Jean@…` et `jean@…`), l'email **n'apparaît jamais dans l'adresse de la page** (recherche envoyée par action serveur). Effacement définitif après confirmation, avec historique et notes ; les demandes disparaissent de la liste et de la recherche. Journal : « 3 demandes effacées (droit à l'effacement) par [nom] », sans l'email. Les références effacées sont inscrites dans `effacements`.
- **Purge des expirées** : compte les demandes Traitées depuis plus que la durée réglée, comparée au **dernier** passage à Traitée (`traitee_le`). Une demande jamais traitée n'est jamais purgée ; une demande rouverte puis traitée récemment reste. Le nombre annoncé égale le nombre effacé. Journalisé avec le nombre (type `donnees`).

## Technical Decisions

- **Nouvelles fonctions SQL** : `ajouter_categorie`, `renommer_categorie`, `activer_categorie`, `desactiver_categorie`, `modifier_parametres`, `effacer_demandeur`, `purger_expirees`. Toutes `SECURITY DEFINER`, `SET search_path = ''`, droit vérifié en première instruction (`prive.est_admin()`), `EXECUTE` accordé nominativement à `authenticated` ; mettre à jour le test des fonctions exécutables par rôle. En un seul bloc : vérifier droit et règle, modifier, écrire le journal (uniquement via `prive.ecrire_journal`).
- **Tables existantes** : `categories` (nom, nom normalisé unique sans accents ni majuscules, actif) ; `parametres` (une seule ligne : nom affiché, email de contact, `duree_conservation_mois` 6–60) ; `journal` (type, détails structurés, auteur, date) ; `effacements` (références et date seulement). Les 5 catégories de départ et la ligne `parametres` sont créées par migration.
- **Ajout seulement** : aucune fonction ne modifie une ligne de `historique`, `notes` ou `journal`. Seules suppressions permises : effacement complet d'une demande par `effacer_demandeur` / `purger_expirees` (avec historique et notes), et purge du journal à plus d'un an par `purger_technique` (nocturne, déjà prévue).
- **Journal** : détails structurés en codes et identifiants, jamais en libellés ; affichage par **un composant unique** qui traduit les codes (et affiche le nom actuel d'une catégorie). Dates affichées via `lib/format.ts` (Europe/Paris).
- **Infos publiques** : le formulaire et la confirmation lisent catégories actives et contact via `infos_publiques()` côté serveur ; aucune donnée lue par le visiteur directement. Pages de l'espace équipe jamais mises en cache ; `revalidatePath` après chaque action pour que le changement soit visible aussitôt.
- **`rejouer_effacements()`** (`service_role` seulement) réefface après une restauration les références inscrites dans `effacements`.
- **Erreurs prévues** : `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>'` (`NOM_DEJA_PRIS`, `DROIT_INSUFFISANT`…, plus un code pour la dernière catégorie active), recopiés dans `lib/erreurs.ts` (test de concordance).
- **Actions** dans `lib/actions/admin.ts` : revérifier la session (`getClaims()`), valider avec Zod (`lib/schemas/`, email en minuscules sans espaces), passer par `lib/server/appeler.ts`, renvoyer `{ ok: true, donnees } | { ok: false, code, message }`. Aucun client Supabase dans le navigateur.
- **Tests** par story (`tests/story-5-x/`), données `TEST-` uniquement, jamais contre la production ; trois profils (visiteur, collaborateur, administrateur). `traitee_le` étant posée par déclencheur, les demandes « traitées il y a plus de 2 ans » viennent des données fictives de développement (déclencheur suspendu à l'insertion), avec les 3 demandes de jean.dupont@example.com et une demande rouverte puis retraitée récemment.

## UX & Interaction Patterns

- **Journal** : tableau Date · Type (Compte, Paramètre, Catégorie, Données, Email, Connexion) · Description · Par ; filtre par type ; vide « Aucun événement. » ; lignes squelettes ; bandeau réseau en erreur.
- **Catégories** : liste Nom · État · nombre de demandes · Actions (Renommer, Désactiver / Réactiver) ; bouton « Ajouter une catégorie ». Erreurs : nom en double, dernière active.
- **Paramètres** : formulaire Nom affiché, Email de contact, Durée de conservation (liste de 6 mois à 5 ans), aperçu de la phrase affichée aux demandeurs (« … conservées 2 ans après son traitement… »), bouton « Enregistrer les paramètres », toast « Paramètres enregistrés. ».
- **Données personnelles**, deux blocs : effacement (champ email + « Rechercher », liste des demandes trouvées, bouton destructeur « Effacer ces N demandes », sans résultat « Aucune demande avec cet email. ») ; purge (« N demandes sont traitées depuis plus de 2 ans. », bouton destructeur « Supprimer les demandes expirées », désactivé avec « Aucune demande expirée. » à 0).
- **Fenêtre de confirmation** réutilisée pour effacer et purger : texte précis (« 3 demandes de jean.dupont@example.com vont être effacées définitivement »), « Annuler » à gauche et sélectionné par défaut, bouton destructeur à droite.
- Formulaires : erreurs sous le champ, focus sur le premier en erreur, saisie conservée ; toasts après chaque action. Vouvoiement, pas d'emoji ; contrôle d'accessibilité automatique sur chaque écran.

## Cross-Story Dependencies

- 5.1 vient en tête : les lignes de journal existent déjà (epics 1 et 4 : comptes, emails, connexions bloquées) et 5.2 à 5.5 vérifient leurs propres lignes sur cette page.
- S'appuie sur l'epic 1 : tables `categories`, `parametres`, `journal`, `effacements`, `prive.ecrire_journal`, `prive.est_admin`, `infos_publiques()`, formulaire public et confirmation, garde `equipe/admin`, données fictives de développement.
- S'appuie sur l'epic 2 : `changer_categorie` et choix de catégorie du détail (refus d'une catégorie désactivée vérifié en 5.2), fenêtre de confirmation, liste et recherche (`demandes_liste`), déclencheur de `traitee_le` et « Rouvrir ».
- 5.3 fournit la durée de conservation lue par 5.5 et par la mention du formulaire public.
- 5.4 alimente `effacements` ; relancer une fois l'essai de restauration (epic 3) pour voir `rejouer_effacements` réeffacer une demande.
