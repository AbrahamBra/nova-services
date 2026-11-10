---
title: 'Story 5.4 — Effacer les données d''une personne'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '852da1e1c5fd10b1f2023a02230b7217be05a08a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-3-parametres-generaux.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** quand une personne demande l'effacement de ses données (RGPD), l'administratrice n'a aucun moyen de retrouver et d'effacer toutes ses demandes.

**Approach :** une page `/equipe/admin/donnees` avec un bloc « Droit à l'effacement » : recherche par email (envoyée par action serveur, jamais dans l'adresse), liste des demandes trouvées, bouton « Effacer ces N demandes » avec confirmation ; une fonction `effacer_demandeur` qui efface en un seul bloc les demandes (historique et notes par cascade), inscrit leurs références dans `effacements` et écrit le journal sans l'email.

## Boundaries & Constraints

**Always :**
- **Page** « Données personnelles », entrée « Données » dans le menu Administration (après « Paramètres », avant « Journal »). Bloc « Droit à l'effacement » : champ « Email du demandeur », bouton « Rechercher » ; erreurs sous le champ (même schéma Zod d'email que les autres formulaires) ; l'email est normalisé (minuscules, espaces retirés) et la correspondance est **exacte** sur `demandes.email`.
- **Jamais dans l'adresse** : la recherche passe par une action serveur ; l'adresse reste `/equipe/admin/donnees` sans paramètre ; le résultat vit dans l'état de l'écran (perdu au rechargement, voulu).
- **Résultat** : « Aucune demande avec cet email. », ou la liste (Référence avec lien vers le détail, Date, Objet, Statut — badges existants) triée de la plus récente à la plus ancienne, et le bouton « Effacer ces N demandes » (singulier pour 1).
- **Confirmation** (modèle `FenetreDesactiver`, « Annuler » à gauche et sélectionné, bouton destructeur à droite) : « N demandes de [email] vont être effacées définitivement, avec leur historique et leurs notes. Cette action ne peut pas être annulée. » ; après succès : toast « N demandes effacées. », le résultat se vide, la liste et la recherche des demandes ne les montrent plus.
- **Migration `20261103000033_effacer_demandeur.sql`** :
  - `chercher_demandes_demandeur(p_email)` — administrateur actif sinon `DROIT_INSUFFISANT` ; email vide/mal formé → `DONNEES_INVALIDES` ; renvoie `[{id, reference, cree_le, objet, statut}]`.
  - `effacer_demandeur(p_email, p_ids uuid[])` — administrateur actif ; verrouille les demandes de cet email (`for update`) ; si l'ensemble des ids ne correspond plus exactement aux demandes de cet email → `DEMANDES_CHANGEES` (« La liste a changé depuis votre recherche. Vérifiez-la avant d'effacer. »), rien effacé ; sinon, dans la même transaction : insère chaque référence dans `effacements` (`on conflict do nothing`), supprime les demandes (historique et notes en cascade), journal `donnees` `{evenement: "demandeur_efface", nombre}` au nom de l'administrateur ; renvoie `{nombre}`. Liste vide → `DONNEES_INVALIDES`.
  - `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` à `authenticated` seulement ; listes de droits des tests à jour.
- **Journal** : `demandeur_efface {nombre}` enregistré dans `lib/journal.ts` ; phrase « 3 demandes effacées (droit à l'effacement) » (singulier pour 1) ; l'auteur s'affiche dans la colonne « Par ». Jamais l'email, le nom ni la référence.
- **Actions** `lib/actions/donnees.ts` : `chercherDemandesDemandeur`, `effacerDemandeur` (administrateur revérifié, Zod, `DROIT_INSUFFISANT` → `ACCES_REFUSE`, `revalidatePath` de `/equipe/demandes` et `/equipe`) ; nouveaux codes dans `lib/erreurs.ts`.
- **Tests sur la base partagée** : chaque test utilise un email unique `test-5-4-<code>@example.com` et des demandes `TEST-5.4-…` ; les références qu'il fait inscrire dans `effacements` sont supprimées au nettoyage. Le test de la story 3.4 (`tests/story-3-4/rejouer-effacements.test.ts:35-44`, qui refuse toute référence étrangère dans `effacements`) est rendu indépendant des autres fichiers (il ne contrôle que ses propres références), pour que les deux puissent tourner en même temps.

**Never :**
- Ne jamais mettre l'email dans l'adresse, dans le journal, dans Sentry ni dans les journaux du serveur.
- Pas d'effacement partiel ni par nom ; pas de purge des expirées (story 5.5) ; ne pas toucher aux données d'essai (`jean.dupont@example.com`) dans les tests automatiques.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Recherche | `Jean.Dupont@example.com` (3 demandes) | Ses 3 demandes ; adresse sans email |
| Aucune | Email sans demande | « Aucune demande avec cet email. » |
| Email mal écrit | `jean@dupont` | Message sous le champ, aucune recherche |
| Effacement | Confirmation | 3 demandes, historique et notes effacés ; 3 références dans `effacements` ; journal « 3 demandes effacées (droit à l'effacement) » |
| Liste changée | Nouvelle demande arrivée entre-temps | `DEMANDES_CHANGEES`, rien effacé, nouvelle recherche proposée |
| Collaborateur | Page ou fonctions | Accès refusé ; `DROIT_INSUFFISANT` |
| Après effacement | Liste et recherche des demandes | Plus aucune des 3 références |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000027_effacements.sql:12-45` -- table `effacements(reference, efface_le)`, RLS sans droit, `rejouer_effacements()` ; seule une fonction `SECURITY DEFINER` peut y écrire.
- `20261103000003_demandes.sql:48,85,126,166` -- `email` en minuscules, index `demandes_email_idx`, `historique` en cascade (pas de blocage de suppression) ; `20261103000015` -- `notes` en cascade, `prive.refuser_modification_notes` laisse passer la cascade.
- `20261103000032_modifier_parametres.sql` -- modèle de fonction admin (droits, journal, droits d'exécution).
- `lib/journal.ts:50-271` -- `CLES_DETAILS_JOURNAL`, `TYPE_EVENEMENT_JOURNAL`, `PHRASES_JOURNAL` ; test de toute la base `tests/story-5-1/base.test.ts:265-377` (aucune donnée de demandeur, clés exactes).
- `lib/actions/parametres.ts`, `lib/actions/categories.ts` -- modèle d'actions ; `components/nova/categories/actions-categorie.tsx:77` (`FenetreDesactiver`) ; `components/formulaire-mot-de-passe-oublie.tsx:49` (formulaire email par action serveur, état côté écran) ; **ne pas** reprendre `components/nova/filtres-demandes.tsx` (recherche dans l'adresse).
- `components/nova/badges.tsx`, `lib/format.ts` (`formaterDate`), `components/nova/menu-equipe.tsx:35` (`RUBRIQUES_ADMIN`), `components/nova/acces-refuse.tsx`, `lib/erreurs.ts` (`DEMANDE_INTROUVABLE` dit déjà « Elle a peut-être été effacée. »).
- Tests : `tests/outils/demandes.ts:53` (`creerDemandeTest`, option `email`), `tests/outils/comptes.ts`, listes de droits `tests/securite/*`, `tests/story-3-4/rejouer-effacements.test.ts:35-72`.
- `deferred-work.md:121-123` -- `effacer_demandeur` doit écrire dans `effacements` (traité ici ; refaire l'essai de restauration ensuite, côté session Exploitation).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000033_effacer_demandeur.sql` -- deux fonctions ; à appliquer sur nova-dev par la session principale
- [x] `lib/erreurs.ts`, `lib/journal.ts`, `lib/schemas/donnees.ts`, `lib/actions/donnees.ts`
- [x] `app/equipe/admin/donnees/page.tsx` + `loading.tsx`, `components/nova/donnees/*`, menu
- [x] `tests/story-5-4/` -- base (droits, recherche exacte et normalisée, effacement complet avec historique et notes, `effacements`, journal sans email, `DEMANDES_CHANGEES`), action, écran, navigateur (critères 1 à 3, adresse sans email, axe, ordinateur et téléphone) ; `tests/story-3-4/rejouer-effacements.test.ts` indépendant ; listes de droits
- [x] `docs/carnet-ia.md` -- ligne de la story 5.4

**Acceptance Criteria :**
- Given la page Données personnelles, when je recherche `Jean.Dupont@example.com`, then je vois ses 3 demandes d'essai, et l'email n'apparaît pas dans l'adresse de la page.
- Given ces demandes, when je clique sur « Effacer ces 3 demandes » et confirme, then elles n'apparaissent plus ni dans la liste ni dans la recherche.
- Given le journal, when je l'ouvre, then une ligne indique « 3 demandes effacées (droit à l'effacement) par [mon nom] », sans l'email effacé.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | Blind | Les demandes sans email (saisies au téléphone) ne peuvent pas être effacées | medium | Réel (`demandes.email` facultatif) ; le plan approuvé exclut l'effacement par nom → reporté, à décider avec Abraham |
| 2 | Blind + VG | Les anciennes lignes `echec_confirmation` du journal gardent la référence | false | Une référence n'est pas une donnée personnelle (AD-14 : nom, email, téléphone, société) ; la demande elle-même est effacée |
| 3 | Blind + Edge | Plafond de 1 000 seulement côté effacement : une personne avec plus de demandes ne peut jamais être effacée | low | Limite côté écran sans équivalent en base → patch |
| 4 | Blind + Edge | Échec d'effacement : message affiché deux fois (toast + bandeau) | low | → patch (bandeau seul, focus après la fermeture) |
| 5 | Blind + Edge | Liste périmée et bouton « Effacer » encore utilisables après un refus | low | → patch (bouton désactivé jusqu'à une nouvelle recherche ; liste vidée après une erreur imprévue) |
| 6 | Blind | Commentaire faux sur le rafraîchissement ; pages de détail et journal non rafraîchies | low | → patch (`revalidatePath("/equipe", "layout")`) |
| 7 | Blind | Demande créée pendant l'effacement non détectée | low | Fenêtre de quelques millisecondes ; la recherche suivante la montre → rejeté |
| 8 | Blind | Aucun test de rejeu après restauration (AD-30) | medium | Raison d'être de l'écriture dans `effacements` → patch |
| 9 | Blind | Recherches par email non journalisées | low | Hors plan (seul l'effacement est journalisé) → rejeté |
| 10 | Blind | Zone de résultat annoncée deux fois aux lecteurs d'écran | low | → patch |
| 11 | Blind | Identifiants non validés comme UUID | low | → patch |
| 12 | VG | Branches d'erreur de l'écran non testées | low | Même convention que les autres écrans → reporté (VG : defer) |
| 13 | Edge | « Relancer la recherche » laisse un champ modifié différent | low | → patch |
| 14 | Edge | « Effacer » cliquable pendant une nouvelle recherche | low | → patch |
| 15 | Edge | Lecture du profil en échec : page « Accès refusé » | low | Même comportement que les autres pages d'administration → rejeté |

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-5-4 tests/story-5-1 tests/story-3-4 tests/story-2-5 tests/securite` -- vert, lancés ensemble
- `npx playwright test --project=ordinateur --project=telephone tests/story-5-4 tests/story-5-1` -- vert
