# Epic 2 Context: Traiter les demandes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

L'équipe Nova s'organise autour des demandes reçues à l'epic 1 : qui s'en occupe (prise en charge, attribution, libération), ce qui a été fait (notes internes, historique), où elles en sont (statut), ce qui est urgent (priorité). Elle retrouve n'importe quelle demande en quelques secondes grâce à la recherche et aux filtres, saisit elle-même les demandes reçues par téléphone ou par email, et voit dès son arrivée ce qui attend une intervention (tableau de bord et compteur). C'est ce qui transforme la liste de l'epic 1 en véritable outil de travail et garantit qu'aucune demande ne reste oubliée.

## Stories

- Story 2.1 : Prendre en charge une demande
- Story 2.2 : Ajouter une note interne
- Story 2.3 : Marquer une demande traitée, la rouvrir ou la classer sans suite
- Story 2.4 : Fixer la priorité et corriger la catégorie
- Story 2.5 : Rechercher et filtrer les demandes
- Story 2.6 : Saisir une demande reçue par téléphone ou par email
- Story 2.7 : Libérer ou attribuer une demande
- Story 2.8 : Voir le tableau de bord et le compteur de nouvelles demandes

## Requirements & Constraints

**Passages de statut autorisés (seuls ceux-ci) :**

| Passage | Comment | Responsable |
|---|---|---|
| Nouvelle → En cours | Uniquement par prise en charge ou attribution | Devient le responsable |
| En cours → Traitée | Changement de statut | Inchangé |
| Traitée → En cours | « Rouvrir » | Inchangé s'il est actif ; sinon retour en Nouvelle sans responsable |
| Nouvelle → Traitée | Classement sans suite, note interne obligatoire, en une seule opération | Aucun |
| En cours → Nouvelle | Uniquement par « Libérer » | Retiré |

- Tout membre actif peut consulter toutes les demandes, changer le statut (selon le tableau), la priorité, la catégorie, et ajouter des notes.
- Seul un administrateur attribue une demande Nouvelle ou réattribue une demande En cours, à un membre **actif** ; l'effet est celui d'une prise en charge. Libérer : le responsable ou un administrateur.
- Prise en charge simultanée : un seul gagne, l'autre lit « Déjà prise en charge par [nom]. ».
- Priorité : `basse`, `normale` (défaut), `haute`, fixée uniquement par l'équipe.
- Notes internes : ni modifiables ni supprimables ; une note vide est refusée ; affichées avec auteur, date et heure.
- Historique : chaque prise en charge, attribution, libération, changement de statut/priorité/catégorie, classement sans suite et note crée une ligne (qui, quoi, quand), affichée du plus ancien au plus récent. Une prise en charge = **une seule** ligne (« Prise en charge par Karim : Nouvelle → En cours »). Le texte d'une note n'est jamais recopié dans l'historique.
- Recherche : texte sur référence, nom, société, email, objet ; mot partiel, insensible à la casse et aux accents. Filtres combinables : statut (dont « Non traitées » = Nouvelle + En cours), priorité, catégorie, canal, responsable (dont « Sans responsable » et « Mes demandes »). Les filtres vivent dans l'adresse de page (ex. `?statut=non_traitees&responsable=aucun`).
- Performance : la liste filtrée s'affiche en moins de 2 s avec 2 000 demandes.
- Saisie interne : canal Téléphone ou Email obligatoire ; mêmes champs que le formulaire public, email facultatif mais au moins un email **ou** un téléphone ; pas de consentement ni d'anti-spam ; référence fabriquée par la base ; email de confirmation envoyé seulement si un email est renseigné (sinon état `sans_email`). Historique : « Saisie par [nom] (téléphone) ».
- Tableau de bord : 5 chiffres (À prendre en charge = Nouvelle sans responsable, Priorité Haute non traitées, Nouvelle, En cours, Traitée), chacun menant à la liste filtrée contenant exactement ce nombre ; compteur du menu = Nouvelle sans responsable, masqué à 0 ; mis à jour au chargement de page (pas de temps réel).
- Toute action refusée par le serveur même si l'écran l'a cachée (droits, passages interdits).

## Technical Decisions

- **Un changement = une fonction SQL** : `prendre_en_charge`, `ajouter_note`, `changer_statut`, `classer_sans_suite`, `changer_priorite`, `changer_categorie`, `saisir_demande`, `liberer`, `attribuer`. En un seul bloc : vérifier le droit (première instruction) et la règle, modifier, écrire l'historique via `prive.ecrire_historique`. `changer_statut` refuse Nouvelle → Traitée. La prise en charge concurrente se règle par une modification conditionnelle (`DEJA_PRISE`).
- **Fonctions verrouillées** : `SECURITY DEFINER`, `SET search_path = ''`, tables nommées avec leur schéma ; `EXECUTE` accordé nominativement à `authenticated` (membre actif vérifié par `prive.est_membre_actif()` / `prive.est_admin()`). Mettre à jour le test qui liste les fonctions exécutables par rôle.
- **Erreurs prévues** : `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>'` (`DEJA_PRISE`, `PASSAGE_INTERDIT`, `DROIT_INSUFFISANT`…), codes recopiés avec leurs messages dans `lib/erreurs.ts` (un test vérifie la concordance).
- **Actions serveur** (`lib/actions/demandes.ts`) : revérifier la session, valider avec Zod (`lib/schemas/`), appeler **une** fonction via `lib/server/appeler.ts`, renvoyer `{ ok: true, donnees } | { ok: false, code, message }`, puis `revalidatePath`. Aucune exception ne remonte à l'écran ; le navigateur n'a aucun client Supabase.
- **Codes fermés** (contraintes `CHECK` + `lib/domaine.ts` avec libellés) : statut `nouvelle|en_cours|traitee`, priorité `basse|normale|haute`, canal `formulaire|telephone|email`, `etat_email` `en_attente|envoye|echec|non_envoye_demo|sans_email`.
- **Historique** : types fermés `creation`, `prise_en_charge`, `attribution`, `liberation`, `changement_statut`, `classement_sans_suite`, `changement_priorite`, `changement_categorie`, `note_ajoutee`, `retour_nouvelle` ; anciennes/nouvelles valeurs en codes ou identifiants, jamais en libellés. Affichage par le composant unique d'historique ; une catégorie s'affiche sous son nom actuel.
- **Ajout seulement** : aucune fonction ne modifie ni ne supprime une ligne de `notes` ou `historique` (table `notes` : demande, auteur, texte, date).
- **Dates** : `mis_a_jour_le` et `traitee_le` sont écrites uniquement par le déclencheur existant sur `demandes` ; affichage via `lib/format.ts` (Europe/Paris, `03/11/2026 à 09:12`).
- **Lecture et filtres** : liste et compteurs lisent la vue `demandes_liste` (`security_invoker`) à travers **le même** `lib/filtres.ts` ; le tableau de bord ne calcule rien d'autre. La vue porte une colonne de recherche normalisée (sans accents, minuscules). Pages de l'espace équipe jamais mises en cache.
- **Saisie interne** : référence `NOVA-AAAA-NNNN` fabriquée par `saisir_demande` depuis `compteurs_reference` (ligne verrouillée) ; `cle_envoi` aléatoire unique contre le double envoi ; email envoyé **après** l'enregistrement via `lib/server/emails.ts`, puis `noter_resultat_email` ; un échec d'email n'annule jamais la saisie.
- Structure de base uniquement par migrations datées ; tests rangés par story (`tests/story-2-x/`), données de test préfixées `TEST-`, jamais contre la production. Toute nouvelle table/état complète `supabase/seed.sql` (notes d'essai en 2.2) ; commande `donnees:charge` (2 000 demandes) en 2.5.

## UX & Interaction Patterns

- **Panneau d'actions** (colonne de droite, sous le résumé sur téléphone) : n'affiche que les actions permises pour ce statut **et** ce rôle — Responsable (nom ou « Aucun », « Prendre en charge » si Nouvelle, « Attribuer à… » admin, « Libérer » responsable ou admin si En cours), Statut (« Marquer comme traitée », « Rouvrir », « Classer sans suite »), Priorité (liste Basse/Normale/Haute), Catégorie modifiable.
- Chaque action : toast immédiat (bas à droite, haut sur téléphone, 5 s ; erreurs persistantes en rouge avec la raison) et nouvelle ligne d'historique sans recharger la page.
- **Fenêtre de confirmation** (shadcn `AlertDialog`) pour le classement sans suite (note obligatoire) : dit précisément ce qui va se passer, « Annuler » à gauche et sélectionné par défaut, focus gardé dans la fenêtre puis rendu au bouton d'origine, Échap ferme.
- Notes : zone « Ajouter une note » + bouton « Ajouter la note » ; état vide « Aucune note interne. ».
- **Barre de recherche/filtres** : recherche lancée après 300 ms sans frappe ou sur Entrée ; filtres en listes déroulantes ; « Effacer les filtres » visible dès qu'un filtre est actif ; sans résultat : « Aucune demande ne correspond à ces filtres. » ; « ← Retour aux demandes » conserve filtres et page.
- **Saisie interne** (`/equipe/demandes/nouvelle`, accessible depuis le menu et en haut de la liste) : Canal en premier, rappel « Pensez à informer le demandeur de l'usage de ses données. », bouton « Enregistrer la demande » ; succès : toast « Demande NOVA-2026-… enregistrée. » puis ouverture du détail. Mêmes comportements de formulaire que le public (erreurs sous le champ, focus sur le premier en erreur, saisie conservée, « Envoi en cours… »).
- **Tableau de bord** (`/equipe`, remplace l'accueil minimal) : « Bonjour [prénom] », 5 cartes cliquables (« À prendre en charge » mise en avant), « Mes demandes en cours » (5 dernières, « Tout voir »), bouton « Saisir une demande » en haut à droite ; squelettes des cartes au chargement ; vide : « Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients. » + « Copier le lien ». Compteur visible à côté du bouton « Menu » sous 1 024 px.
- Ton : vouvoiement, verbes d'action sur les boutons, pas d'emoji ni de point d'exclamation dans les erreurs. Composants shadcn utilisés tels quels (enveloppés, jamais modifiés) ; bouton destructeur seulement dans les fenêtres de confirmation. Contrôle d'accessibilité automatique sur chaque écran.

## Cross-Story Dependencies

- S'appuie sur l'epic 1 : tables `demandes`, `historique`, `compteurs_reference`, `membres`, `categories`, `journal` ; vue `demandes_liste` et première version de `lib/filtres.ts` (1.5) ; page de détail et composant d'historique (1.6) ; `lib/server/emails.ts` et `noter_resultat_email` (1.7) ; schéma Zod et champs du formulaire public (1.3) ; comptes `TEST-` administrateur et collaborateur (1.4).
- 2.1 crée le panneau d'actions et les toasts, réutilisés par 2.2, 2.3, 2.4 et 2.7.
- 2.2 crée la table `notes`, nécessaire au classement sans suite de 2.3.
- 2.3 crée la fenêtre de confirmation, réutilisée ensuite (désactivation de comptes en 4.2).
- 2.5 complète `lib/filtres.ts`, dont dépendent les chiffres cliquables et le compteur de 2.8.
- Le comportement « Rouvrir avec un responsable désactivé » et l'interdiction d'attribuer à un compte désactivé sont vérifiés en 4.2.
- 2.8 est la story à sacrifier en premier dans cet epic si le temps manque.
