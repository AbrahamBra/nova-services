---
title: 'Story 5.1 — Consulter le journal des événements'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'a105eef95e7fd46ad20977a77f98182eb6d73841'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** l'application inscrit déjà au journal les créations et changements de comptes, les échecs d'email et les blocages de connexion, mais personne ne peut les lire hors d'un script de développement.

**Approach :** une page `/equipe/admin/journal` réservée aux administrateurs : tableau du plus récent au plus ancien (Date · Type · Description · Par), filtre par type, 50 lignes par page. Les descriptions sont fabriquées à l'affichage par un module unique qui traduit les codes stockés.

## Boundaries & Constraints

**Always :**
- **Page** : titre « Journal », entrée « Journal » dans le menu Administration (après « Comptes »). Tableau sur ordinateur, cartes sur téléphone (même modèle que Comptes). Date et heure via `formaterDateHeure` (Europe/Paris). Type : `LIBELLES_TYPE_JOURNAL`. Par : nom actuel du membre, « Système » si `auteur_type = systeme`, « Membre inconnu » si le membre n'existe plus.
- **Filtre** : « Tous » et les 6 types (Compte, Paramètre, Catégorie, Données, Email, Connexion), dans l'adresse (`?type=compte&page=2`) ; valeur inconnue ignorée ; adresse ramenée à sa forme canonique comme la liste des demandes. Pagination de 50 lignes avec `Pagination` existant. Vide : « Aucun événement. » ; chargement : lignes squelettes ; erreur : bandeau `role="alert"` + « Réessayer ».
- **Descriptions** (`lib/journal.ts`, une phrase par `details.evenement`, sans jamais afficher de JSON brut) :
  - `compte_cree` « Compte créé : [nom] ([Rôle]) » ; `compte_modifie` « Compte modifié : [nom] » + les changements (« nom : A → B », « rôle : X → Y ») ; `compte_desactive` « Compte désactivé : [nom] » + « , n demande(s) remise(s) en Nouvelle » si n > 0 ; `compte_reactive` « Compte réactivé : [nom] » ; `lien_mot_de_passe_genere` « Lien de mot de passe généré pour [nom] » ; `invitation_renvoyee` « Invitation renvoyée à [nom] » ; `invitation_annulee` « Invitation annulée : [nom] » ;
  - `connexion_bloquee` « Connexion bloquée 15 minutes après 5 échecs » + « (même email) » / « (même adresse IP) » / « (même email et même adresse IP) » ;
  - `echec_confirmation` « Email de confirmation non envoyé pour [référence] (code : [code]) » ;
  - tout autre code : « Événement « [code] » » (les stories 5.2 à 5.5 ajouteront leurs phrases ici).
  Le nom affiché est celui enregistré dans `details` (une invitation annulée n'a plus de membre).
- **Migration `20261103000030_lire_journal.sql`** : `lire_journal(p_type text default null, p_page integer default 1)` — administrateur actif sinon `DROIT_INSUFFISANT` ; type inconnu → `DONNEES_INVALIDES` ; tri `cree_le desc, id desc` ; 50 lignes ; renvoie `{total, lignes: [{id, cree_le, type, auteur_type, auteur_nom, details}]}` ; `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` à `authenticated` seulement ; index `(type, cree_le desc)`. Listes de droits des tests à jour.
- **Collaborateur** : page refusée (`AccesRefuse`, comme Comptes) et fonction refusée par la base.
- **AD-14** : test automatique qui vérifie que chaque `evenement` connu n'a que les clés de `details` attendues (liste fermée) et qu'aucune ligne ne contient le nom, l'email, le téléphone ou la société d'une demande de test créée pour l'occasion.

**Never :**
- Pas de modification ni de suppression de lignes du journal (ajout seulement) ; pas de recherche texte ni d'export.
- Ne pas changer les détails déjà écrits par les migrations précédentes.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Ouverture | Admin, journal non vide | Plus récent en haut ; date, type, description, auteur |
| Filtre Compte | `?type=compte` | Seulement les événements de comptes, dont « Compte créé : Léo Martin (Collaborateur) » |
| Système | Échec d'email, blocage de connexion | Par : « Système » |
| Pagination | 51 lignes du type choisi | 50 en page 1, 1 en page 2 |
| Type inconnu | `?type=xyz` | Ignoré, adresse ramenée à la forme canonique |
| Vide | Aucun événement du type | « Aucun événement. » |
| Collaborateur | Adresse tapée, appel direct | Accès refusé ; `DROIT_INSUFFISANT` |
| Membre supprimé | Invitation annulée | Description lisible avec le nom enregistré |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000009_emails_journal.sql:23-93` -- table `journal` (types fermés, `auteur_type`, `auteur_id` → `membres`, index `cree_le desc`, aucun droit direct), `prive.ecrire_journal`. Événements existants : `0009:146` echec_confirmation {reference, code} ; `0013:247` connexion_bloquee {bloque: email|ip|email_et_ip, duree_minutes} ; `0024:93` compte_cree {membre_id, nom, role} ; `0026:95,202,262` compte_modifie {…, ancien_nom, ancien_role}, compte_desactive {…, demandes_remises}, compte_reactive ; `0028:184` lien_mot_de_passe_genere ; `0029:55,119` invitation_renvoyee, invitation_annulee.
- `0026_gerer_comptes.sql:284` (`lister_comptes`) et `lib/comptes.ts` (`lireReponseComptes`, `lireComptesAvec`, `lireComptes`) -- modèle de lecture admin ; `lib/server/appeler.ts` (`Resultat`, `ClientRpc`).
- `scripts/journal.ts` -- requête de lecture existante (jointure `membres`, « Système », « Membre inconnu ») ; ne pas casser son test `tests/story-3-1/scripts-production.test.ts:311`.
- `lib/domaine.ts:99-108` (`TYPES_JOURNAL`, `LIBELLES_TYPE_JOURNAL`, `LIBELLES_ROLE`) ; modèle de phrases : `PHRASES_HISTORIQUE` (`lib/domaine.ts:188`) et `components/nova/historique.tsx`.
- `lib/filtres.ts` (`lireNumeroPage`, `bornerPage`, `adresseAvecPage`, `parmi`, taille passée en argument), `components/nova/pagination.tsx`, `app/equipe/demandes/page.tsx:76-125` (lecture des `searchParams`, redirection canonique), `lib/format.ts` (`formaterDateHeure`).
- `app/equipe/admin/comptes/page.tsx` + `loading.tsx` (garde admin, `generateMetadata`, `AccesRefuse`, bandeau d'erreur), `components/nova/menu-equipe.tsx:32` (`RUBRIQUES_ADMIN`).
- Tests : `tests/outils/comptes.ts` (`creerCompteTest`, `effacerJournalDesComptesTest`, `avecBase`), `tests/outils/demandes.ts`, listes de droits `tests/securite/*`. Base partagée : ne jamais supposer un nombre total exact ; créer ses propres lignes (via les fonctions existantes) et les retrouver ; nettoyer.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000030_lire_journal.sql` -- `lire_journal` + index ; à appliquer sur nova-dev par la session principale
- [x] `lib/journal.ts` -- lecture validée et phrases ; `lib/filtres.ts` ou fichier dédié -- filtre de type et adresse canonique
- [x] `app/equipe/admin/journal/page.tsx` + `loading.tsx`, `components/nova/journal.tsx`, menu Administration
- [x] `tests/story-5-1/` -- phrases (chaque événement, code inconnu), lecture et filtre, base (tri, 50 par page, type, droits, AD-14), navigateur (critères 1 à 3, axe, ordinateur et téléphone) ; listes de droits
- [x] `docs/carnet-ia.md` -- ligne de la story 5.1

**Acceptance Criteria :**
- Given la page Journal, when je l'ouvre, then je vois les événements du plus récent au plus ancien avec date, type, description et auteur (« Système » pour un échec d'email ou un blocage de connexion).
- Given le filtre « Compte », when je le choisis, then seuls les événements de comptes s'affichent, dont « Compte créé : Léo Martin… ».
- Given que je suis collaborateur, when je tape l'adresse du journal, then l'accès est refusé.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | Blind + Edge | Liste des types écrite en SQL et en TypeScript sans test qui les relie | low | Un type ajouté d'un seul côté casserait le filtre → patch (test pour chaque type) |
| 2 | Blind | Taille de page 50 écrite deux fois | low | Correction de test directe → patch |
| 3 | Blind | Pas d'index pour la vue « Tous » ni sur `id` | low | Journal court (1 an, peu d'événements par jour) ; `journal_cree_le_idx` existe → rejeté |
| 4 | Blind | Une seule ligne invalide fait échouer toute la page | low | « Réessayer » ne peut jamais réussir dans ce cas → patch (validation ligne par ligne) |
| 5 | Blind + Edge | Purge entre les deux lectures : page vide au-delà de la fin | low | Demande une purge à la même seconde ; « Aucun événement. » sans perte → rejeté |
| 6 | Blind + Edge | Phrase de blocage : durée de 15 minutes inventée si absente | low | Correction directe → patch ; « 5 échecs » est la règle fixe de 1.9 |
| 7 | Blind | Aucun contrôle qu'un événement est écrit avec le bon type | low | Correction de test directe → patch |
| 8 | Blind | Liste des clés et liste des phrases peuvent diverger | low | Un seul sens testé → patch |
| 9 | Blind | « Membre inconnu » jamais testé en base | false | La clé étrangère sans `on delete` empêche de supprimer un auteur ; le cas ne peut pas venir de la base |
| 10 | Blind | Test du filtre Compte fragile sur la base partagée | low | Assertion trop large → patch |
| 11 | Blind + Edge | Contrôle des clés sur toute la base fragile pour 5.2 à 5.5 | low | Garde voulue (AD-14) ; message d'échec à rendre explicite → patch |
| 12 | Blind | Journaux d'erreur serveur sans détail | low | Le patch 4 ajoute le champ en défaut → rejeté pour le reste |
| 13 | Blind | Code technique brut affiché (« code : invalid_api_key ») | low | Lisible pour un administrateur ; pas de donnée personnelle → rejeté |
| 14 | Blind | Référence de demande non cliquable | low | Amélioration hors plan → rejeté |
| 15 | Blind | Squelette de chargement sans le filtre | low | Correction directe → patch |
| 16 | Edge | Test navigateur : `TypeError` si la ligne de préparation manque | low | Message d'erreur trompeur → patch |
| 17 | VG | Aucun manque de vérification | false | Rapport du relecteur |

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-5-1 tests/securite tests/story-1-3/deposer.test.ts tests/story-3-1` -- vert
- `npx playwright test tests/story-5-1 tests/story-4-1` -- vert, ordinateur et téléphone
