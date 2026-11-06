---
title: 'Story 4.2 — Modifier, désactiver ou réactiver un compte'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '62bb9b9c1527e33137b3ea5f276b815eb1903634'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-inviter-un-membre.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** la page Comptes ne fait qu'inviter : impossible de corriger un nom, de changer un rôle ou de couper l'accès d'un membre qui part.

**Approach :** ajouter à chaque compte « Modifier » (nom, rôle), « Désactiver » (avec annonce des demandes qui reviennent en Nouvelle) et « Réactiver », portés par trois fonctions SQL qui gardent toujours un administrateur actif, puis bloquer ou débloquer la connexion dans Auth. Proposer « Réactiver ce compte » quand on invite l'email d'un compte désactivé.

## Boundaries & Constraints

**Always :**
- **Colonne Actions** (tableau et cartes téléphone) selon l'état : Invité → Modifier ; Actif → Modifier, Désactiver ; Désactivé → Modifier, Réactiver. Sur la ligne de l'administrateur connecté : « Modifier » sans champ Rôle, jamais « Désactiver ».
- **Modifier** : fenêtre (Nom, Rôle), erreurs sous le champ, « Envoi en cours… » ; la liste se met à jour aussitôt ; toast « Compte modifié ». Le nouveau rôle s'applique au prochain chargement de page du membre (droits relus à chaque requête, déjà en place).
- **Désactiver** : fenêtre de confirmation (modèle `FenetreClasserSansSuite`, « Annuler » à gauche et sélectionné, bouton destructeur à droite) : « [Nom] ne pourra plus se connecter. » puis, si n > 0, « Ses n demandes en cours reviendront en Nouvelle, sans responsable. » (singulier pour 1). n vient de `lister_comptes` (nouveau champ `demandes_en_cours`). Après confirmation : état « Désactivé », toast.
- **Réactiver** : bouton direct (action réversible, pas de confirmation), état « Actif », toast.
- **Invitation d'un email désactivé** : sous Email, « Cette adresse appartient à un compte désactivé. » et un bouton « Réactiver ce compte » qui réactive ce membre, ferme la fenêtre et affiche le toast.
- **Migration `20261103000026_gerer_comptes.sql`** (toutes `SECURITY DEFINER`, `search_path = ''`, administrateur actif vérifié en premier sinon `DROIT_INSUFFISANT`, `EXECUTE` à `authenticated` seulement, journal `compte` via `prive.ecrire_journal`) :
  - `modifier_membre(p_id, p_nom, p_role)` : sur soi-même, rôle inchangé obligatoire (sinon `PROPRE_COMPTE`) ; journal `{evenement: "compte_modifie", membre_id, nom, role, ancien_nom, ancien_role}` seulement si quelque chose change.
  - `desactiver_membre(p_id)` : refuse soi-même (`PROPRE_COMPTE`) et tout état autre qu'`actif` (`ETAT_COMPTE_INVALIDE`) ; ses demandes `en_cours` passent à `nouvelle`, `responsable_id = null`, une ligne d'historique `retour_nouvelle` chacune (auteur : l'administrateur) ; renvoie `{demandes_remises: n}` ; journal `compte_desactive` avec n.
  - `reactiver_membre(p_id)` : seulement depuis `desactive` (sinon `ETAT_COMPTE_INVALIDE`) ; journal `compte_reactive`.
  - `modifier_membre` et `desactiver_membre` prennent `pg_advisory_xact_lock(hashtextextended('membres:administrateurs', 0))` puis lèvent `DERNIER_ADMIN` s'il ne resterait aucun administrateur **actif**.
  - `lister_comptes()` renvoie en plus `demandes_en_cours` (entier) ; `verifier_email_libre` lève `COMPTE_DESACTIVE` (avec l'id du membre en détail) au lieu d'`EMAIL_DEJA_UTILISE` pour un membre désactivé.
- **Actions** (`lib/actions/admin.ts`, profil admin revérifié, Zod, `revalidatePath`) : `modifierMembre`, `desactiverMembre` (SQL **puis** blocage Auth `ban_duration` long ; un échec du blocage est signalé à Sentry sans annuler, la base refusant déjà tout), `reactiverMembre` (déblocage Auth **puis** SQL : si le SQL échoue, le compte reste refusé à la connexion car non actif).
- Nouveaux codes dans `lib/erreurs.ts` : `DERNIER_ADMIN` « Il doit rester au moins un administrateur actif. », `PROPRE_COMPTE`, `ETAT_COMPTE_INVALIDE`, `COMPTE_DESACTIVE` ; tests de droits mis à jour.

**Never :**
- Ne pas toucher à l'invitation, au renvoi ni à l'annulation (4.1, 4.4), ni au mot de passe oublié (4.3).
- Ne jamais supprimer un membre ni ses lignes d'historique ; son nom reste affiché dans les historiques.
- Pas de rôle stocké dans les métadonnées Auth.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Modifier | Nom de Léo, rôle → Administrateur | Liste à jour ; Léo voit « Administration » au chargement suivant |
| Désactiver | Léo responsable de 2 demandes En cours | Fenêtre « Ses 2 demandes… » ; après : Désactivé, 2 demandes Nouvelle sans responsable, 2 lignes `retour_nouvelle` |
| Connexion refusée | Léo désactivé, bon mot de passe | « Email ou mot de passe incorrect. » |
| Session ouverte | Léo connecté, puis désactivé | Action suivante refusée ; page suivante → `/connexion` |
| Soi-même | Admin sur sa ligne | Pas de « Désactiver » ni de Rôle ; appel direct → `PROPRE_COMPTE` |
| Dernier admin | Deux admins se rétrogradent en même temps | Un seul réussit ; l'autre reçoit `DERNIER_ADMIN` |
| Réactiver | Léo désactivé | Actif ; il peut se reconnecter |
| Invitation | Email de Léo désactivé | Message + « Réactiver ce compte » → Actif |
| Attribuer | Cible désactivée | `MEMBRE_INVALIDE` (déjà en place, à prouver) |
| Rouvrir | Traitée, responsable désactivé | Nouvelle sans responsable (déjà en place, à prouver) |
| Collaborateur | Appel des trois actions | Refus, rien ne change |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000003_demandes.sql` -- `demandes` (`statut`, `responsable_id` l.65), `historique` (type `retour_nouvelle` déjà permis l.131), `prive.ecrire_historique(demande, type, auteur, ancienne, nouvelle)` l.174.
- `20261103000005_membres.sql` -- `prive.est_admin()`, `prive.est_membre_actif()`, `mon_profil()` (null si non actif) ; `20261103000009_emails_journal.sql:73` `prive.ecrire_journal`.
- `20261103000016_statuts.sql:116` -- `changer_statut` : la réouverture avec responsable non actif remet déjà en Nouvelle sans responsable. `20261103000023_liberer_attribuer_corrections.sql:89` -- `attribuer` refuse déjà une cible non active (`MEMBRE_INVALIDE`).
- `20261103000024_inviter_membre.sql:120` (`lister_comptes`), `20261103000025_email_libre.sql` (`verifier_email_libre`) : à remplacer (`create or replace`, même signature). Verrou consultatif : modèle `0011:130`.
- `lib/actions/admin.ts` -- `inviter`, `bandeau`, `emailPris`, `signaler`, `CHEMIN_COMPTES`, client service ; `lib/server/appeler.ts` (`detail` des erreurs) ; `lib/actions/comptes.ts:64` (`user_banned` déjà compté comme échec de connexion).
- `components/nova/comptes/liste-comptes.tsx` (`ListeComptes`, `data-compte`, « (vous) »), `inviter-membre.tsx` (fenêtre d'invitation), `app/equipe/admin/comptes/page.tsx`, `lib/comptes.ts` (`Compte`).
- `components/nova/actions-demande.tsx:545` (`FenetreClasserSansSuite`, modèle de confirmation), `components/ui/dialog.tsx`, `components/ui/alert-dialog.tsx`, `components/nova/toasts`.
- `app/equipe/layout.tsx:52` -- profil null → `/connexion` (couvre le compte désactivé).
- Tests : `tests/outils/comptes.ts` (`creerCompteTest` — `desactive` posé en SQL sans blocage Auth ; `effacerJournalDesComptesTest` n'efface que par `auteur_id`), `tests/outils/demandes.ts` (`creerDemandeTest`, `responsableId`, `statut`), listes de droits `tests/securite/droits-anon.test.ts`, `droits-service-role.test.ts`, `tests/story-1-3/deposer.test.ts`. Serveur Playwright sans Sentry (`playwright.config.ts`).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000026_gerer_comptes.sql` -- trois fonctions, `lister_comptes` et `verifier_email_libre` complétées ; appliquer sur nova-dev (`npm run db:push`)
- [x] `lib/erreurs.ts`, listes de droits -- nouveaux codes et fonctions
- [x] `lib/schemas/compte.ts` -- schéma Modifier (nom, rôle) partagé écran/action
- [x] `lib/actions/admin.ts` -- `modifierMembre`, `desactiverMembre`, `reactiverMembre` ; `inviter` renvoie le cas `COMPTE_DESACTIVE`
- [x] `lib/comptes.ts`, `components/nova/comptes/*` -- colonne Actions, fenêtres Modifier et Désactiver, Réactiver, proposition dans la fenêtre d'invitation
- [x] `tests/story-4-2/` -- base (fonctions, verrou et `DERNIER_ADMIN` en parallèle, demandes et historique, journal, droits, attribuer et rouvrir avec compte désactivé), action (ordre SQL/Auth, échecs Auth), navigateur (critères 1 à 4, session ouverte refusée, axe, ordinateur et téléphone)
- [x] `docs/carnet-ia.md` -- ligne de la story 4.2

**Acceptance Criteria :**
- Given un membre, when je modifie son nom ou passe son rôle à Administrateur, then la liste l'affiche aussitôt et il voit « Administration » à son prochain chargement de page.
- Given Léo responsable de 2 demandes En cours, when je clique sur « Désactiver », then la fenêtre annonce ses 2 demandes ; après confirmation il est « Désactivé ».
- Given Léo désactivé, when il se connecte, then il est refusé et son nom reste dans les historiques ; sur mon propre compte, ni « Désactiver » ni changement de rôle.
- Given Léo désactivé, when je clique sur « Réactiver » ou « Réactiver ce compte » à l'invitation, then il peut à nouveau se connecter.

## Implementation Notes

- Migration 0026 appliquée sur nova-dev par la session principale (accord d'Abraham).
- DERNIER_ADMIN n'est atteignable que si l'appelant perd ses droits pendant l'attente du verrou et qu'il ne reste aucun autre administrateur actif : impossible à provoquer sans toucher aux vrais administrateurs. Prouvé par la sérialisation (deux administrateurs `TEST-` en parallèle, le second attend puis est refusé), par la place du contrôle dans le corps des fonctions (`pg_proc`) et par le test de l'action (message sous Rôle).
- `modifier_membre` et `desactiver_membre` revérifient l'appelant après l'attente du verrou (DROIT_INSUFFISANT s'il a perdu ses droits), après le contrôle DERNIER_ADMIN.
- Compte inconnu : DONNEES_INVALIDES.

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | Blind + Edge | Réactivation : Auth débloqué, puis refus de la base → compte désactivé mais débloqué dans Auth, sans alerte | medium | `reactiverMembre` ne rebloque pas sur refus ; la connexion reste refusée par `mon_profil`, mais la défense Auth est perdue → patch (rebloquer, Sentry) |
| 2 | Blind + Edge | Désactiver et réactiver en même temps : compte actif mais bloqué dans Auth | maybe-false | Demande deux administrateurs agissant à la même seconde sur le même compte ; correction = sérialiser Auth et base → reporté |
| 3 | Blind | `DERNIER_ADMIN` testé avant la revérification des droits après le verrou | low | Mauvais message seulement dans une course rare ; la correction demande une migration 0027 → rejeté |
| 4 | Blind + Edge | `reactiver_membre` sans verrou partagé ni revérification après attente | low | Administrateur rétrogradé pendant l'attente d'un verrou de ligne : très improbable, migration 0027 → rejeté |
| 5 | Blind | Fenêtre et toast ignorent le nombre réel de demandes remises | low | Écart possible seulement si la liste a changé entre l'affichage et le clic → rejeté |
| 6 | Blind + Edge | Liste non rafraîchie après un refus `ETAT_COMPTE_INVALIDE` | low | `revalidatePath` seulement en cas de réussite ; correction directe → patch |
| 7 | Blind + Edge + VG | Erreur de rôle sur son propre compte invisible (champ Rôle absent) | medium | `premierChampModificationEnErreur` renvoie `role`, champ non rendu, pas de bandeau → patch |
| 8 | Blind + Edge | « Réactiver ce compte » : fenêtre fermable pendant la requête | low | `onOccupe(enCours)` ignore `reactivation` ; correction directe → patch |
| 9 | Blind | « Réactiver ce compte » garde l'ancien nom et rôle sans le dire | low | Conforme au critère 4 (réactiver le compte) ; le nom et le rôle se changent par « Modifier » → rejeté |
| 10 | Blind | Sélecteur Rôle modifiable pendant l'envoi | low | Champ Nom en lecture seule, sélecteur non ; correction directe → patch |
| 11 | Blind | Boutons sans `aria-haspopup` / `aria-expanded` | low | Contrôle axe vert ; refonte vers les déclencheurs Radix → rejeté |
| 12 | Blind | Échec du blocage Auth absent du journal | low | Signalé à Sentry ; la base refuse déjà tout → rejeté |
| 13 | Blind | Tests faibles (visiteur, id mal formé, bandeau, réactivation refusée) | low | Ajouts non indispensables ; les cas utiles sont couverts par les patchs 1 et 7 → rejeté |
| 14 | Edge | Échec du contrôle d'un id côté écran : rien ne s'affiche | low | Les id viennent du serveur (`lister_comptes`) ; cas impossible en pratique → rejeté |
| 15 | VG | Les tests de navigateur ne réactivent jamais un compte réellement bloqué dans Auth | medium | `creerCompteTest` ne bloque pas Auth ; retirer le déblocage ne casserait rien → patch (bloquer dans les tests du critère 4) |
| 16 | VG + Edge (claim) | `DERNIER_ADMIN` vérifié seulement par lecture du code de la fonction | maybe-false | Inatteignable sur la base partagée sans toucher aux vrais administrateurs → reporté |
| 17 | Agent | « Prendre en charge » au même instant que la désactivation : demande En cours d'un compte désactivé | maybe-false | `prendre_en_charge` ne verrouille pas la ligne du membre → reporté |

## Design Notes

Ordre Auth/SQL choisi pour qu'un échec à mi-chemin laisse toujours le compte refusé : désactiver = base d'abord (refus immédiat partout, AD-3), blocage Auth ensuite (défense en plus) ; réactiver = déblocage Auth d'abord, base ensuite (tant que la base dit « désactivé », `connexion` refuse via `mon_profil`).

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-4-2 tests/story-4-1 tests/securite tests/story-1-3/deposer.test.ts` -- vert
- `npx playwright test tests/story-4-2 tests/story-4-1` -- vert, ordinateur et téléphone
