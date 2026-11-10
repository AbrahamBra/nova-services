---
title: 'Story 4.4 — Renvoyer ou annuler une invitation'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'edec2e1553cc15e1f31fe44b70c5ee7f427f400f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-inviter-un-membre.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** une invitation dont le lien a expiré reste « Invité » pour toujours, et une invitation faite par erreur ne peut pas être retirée : son adresse reste bloquée.

**Approach :** sur la ligne d'un membre « Invité », ajouter « Renvoyer l'invitation » (nouveau lien de 24 h affiché avec « Copier », l'ancien devient invalide) et « Annuler l'invitation » (confirmation, puis le compte disparaît de la liste et l'adresse redevient libre).

## Boundaries & Constraints

**Always :**
- **Boutons** sur la ligne (tableau et carte téléphone) d'un compte à l'état `invite` seulement : « Modifier » (inchangé), « Renvoyer l'invitation », « Annuler l'invitation ».
- **Renvoyer** (action `renvoyerInvitation`, `lib/actions/admin.ts`) : administrateur revérifié ; `NEXT_PUBLIC_SITE_URL` vérifiée avant tout ; état `invite` vérifié par la base **avant** d'appeler Auth (`noter_renvoi_invitation(p_id)`, qui écrit le journal `compte` `{evenement: "invitation_renvoyee", membre_id, nom}` et renvoie l'email) ; puis `generateLink({ type: "invite", email })`, qui renvoie le même compte avec un nouveau jeton et rend l'ancien invalide. Le lien s'affiche dans la fenêtre du lien partagée (`fenetre-lien.tsx`) : titre « Lien d'invitation », « Copier », « Ce lien est valable 24 h. ». Si `generateLink` renvoie un autre compte que celui attendu ou échoue : rien n'est supprimé, erreur signalée à Sentry (id seulement), message d'erreur.
- **Annuler** : fenêtre de confirmation (modèle `FenetreDesactiver`) « L'invitation de [Nom] sera annulée et son compte disparaîtra de la liste. », boutons « Retour » (à gauche, sélectionné) et « Annuler l'invitation » (destructeur, à droite). Action `annulerInvitation` : administrateur revérifié ; `annuler_invitation(p_id)` (verrou de la ligne, état `invite` obligatoire sinon `ETAT_COMPTE_INVALIDE`, supprime la ligne `membres`, journal `{evenement: "invitation_annulee", membre_id, nom}`) ; **puis** suppression du compte Auth. Un échec de la suppression Auth est signalé à Sentry (id seulement) et l'action réussit quand même (la base ne connaît plus le membre ; `verifier_email_libre` refusera l'adresse tant que le compte Auth existe — noté dans le message Sentry). Toast « Invitation annulée. », la liste se rafraîchit.
- **Lien remplacé ou expiré** : « Ce lien n'est plus valable. Contactez votre administrateur. » (message d'invitation existant, aucune nouvelle page).
- **Refus** : collaborateur → `ACCES_REFUSE` pour les deux actions ; compte actif ou désactivé → `ETAT_COMPTE_INVALIDE` (« Renvoyer » et « Annuler » ne sont pas proposés, et la base refuse un appel direct) ; la liste se rafraîchit sur `ETAT_COMPTE_INVALIDE`.
- **Migration `20261103000029_annuler_invitation.sql`** : `noter_renvoi_invitation(p_id)` et `annuler_invitation(p_id)` (`SECURITY DEFINER`, `search_path = ''`, administrateur actif vérifié en premier sinon `DROIT_INSUFFISANT`, `EXECUTE` à `authenticated` seulement, journal via `prive.ecrire_journal`) ; listes de droits des tests à jour. La suppression de `membres` par `annuler_invitation` est la seule suppression de membre permise (AD-17).
- **Test d'expiration** : une invitation dont l'envoi date de plus de 24 h est refusée et une de 23 h acceptée (date reculée en base sur un compte `TEST-` ; vérifier sur nova-dev quel champ Auth porte la date de l'invitation, comme en 4.3).

**Never :**
- Ne jamais supprimer un compte actif ou désactivé, ni un compte Auth sans ligne `membres` correspondante supprimée par `annuler_invitation`.
- Pas d'envoi d'email (mode démonstration, comme 4.1).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Renvoyer | Léo « Invité » | Fenêtre avec un nouveau lien 24 h + « Copier » ; journal `invitation_renvoyee` |
| Ancien lien | Lien d'avant le renvoi | « Ce lien n'est plus valable. Contactez votre administrateur. » |
| Nouveau lien | Lien renvoyé | Choix du mot de passe, Léo « Actif » |
| Annuler | Léo « Invité », confirmation | Disparaît de la liste ; compte Auth supprimé ; l'adresse peut être réinvitée |
| Annuler un actif | Appel direct | `ETAT_COMPTE_INVALIDE`, rien supprimé |
| Collaborateur | Appel des deux actions | `ACCES_REFUSE`, rien ne change |
| Invitation de 25 h | Envoi reculé de 25 h | Lien refusé ; 23 h : accepté |
| Suppression Auth en échec | Auth renvoie une erreur | Membre retiré de la liste, Sentry alerté |

</frozen-after-approval>

## Code Map

- `lib/actions/admin.ts` -- `inviter` (`generateLink` invite, `creeParCetAppel`), `genererLienMotDePasse` (modèle : base d'abord, puis `generateLink`), `verifierAdmin`, `clientSession`, `refusBase` (rafraîchit sur `ETAT_COMPTE_INVALIDE`), `supprimerCompteAuth`, `signaler`, `CHEMIN_COMPTES`.
- `lib/server/liens.ts` -- `lienConfirmation` / lien d'invitation, `adresseDuSite`.
- `components/nova/comptes/actions-compte.tsx` (`ActionsCompte`, `FenetreDesactiver`, `BoutonLienMotDePasse`), `fenetre-lien.tsx` (fenêtre du lien partagée), `liste-comptes.tsx`.
- `supabase/migrations/20261103000028_mot_de_passe_oublie.sql` (`noter_lien_mot_de_passe` : modèle de fonction admin + journal + email renvoyé), `20261103000026_gerer_comptes.sql` (verrous, `ETAT_COMPTE_INVALIDE`), `20261103000025_email_libre.sql` (`verifier_email_libre`).
- Constat 4.1 : `generateLink({type:"invite"})` sur un compte Auth non confirmé renvoie **le même compte** avec un nouveau jeton (l'ancien devient invalide).
- Tests : `tests/story-4-1/inviter.spec.ts` (`autreNavigateur`, lien lu dans la fenêtre), `tests/story-4-3/base.test.ts` (date d'envoi reculée en base pour l'expiration), `tests/outils/comptes.ts`, listes de droits `tests/securite/*`, `tests/story-1-3/deposer.test.ts`. Comptes `TEST-` seulement, nettoyés (journal compris).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000029_annuler_invitation.sql` -- deux fonctions (écrite, essayée dans une transaction annulée) ; à appliquer sur nova-dev par la session principale
- [x] `lib/actions/admin.ts` -- `renvoyerInvitation`, `annulerInvitation`
- [x] `components/nova/comptes/*` -- boutons, fenêtre de confirmation, fenêtre du lien
- [x] `tests/story-4-4/` -- base (fonctions, droits, journal, expiration 24 h), action (ordre base/Auth, échecs Auth, refus), navigateur (critères 1 à 3, réinvitation après annulation, axe, ordinateur et téléphone) ; listes de droits
- [x] `docs/carnet-ia.md` -- ligne de la story 4.4

**Acceptance Criteria :**
- Given un membre « Invité », when je clique sur « Renvoyer l'invitation », then un nouveau lien valable 24 h m'est affiché.
- Given l'ancien lien (remplacé), when Léo l'ouvre, then il lit « Ce lien n'est plus valable. Contactez votre administrateur. ».
- Given un membre « Invité », when je clique sur « Annuler l'invitation » et confirme, then il disparaît de la liste.

## Implementation Notes

- Champ Auth de la date d'une invitation (sonde sur nova-dev, comptes `test-4-4-…` supprimés) : `auth.users.confirmation_sent_at` (25 h → `otp_expired`, 23 h → accepté) ; `invited_at` n'est pas lu par Auth.
- Une invitation dont le lien a déjà été ouvert (« Continuer ») sans mot de passe choisi a un compte Auth confirmé : `generateLink` invite renvoie alors `email_exists` ; « Renvoyer » génère à la place un lien `recovery` (même compte vérifié), qui mène à la version invitation de `/nouveau-mot-de-passe` et active le compte (vérifié par test navigateur sur nova-dev).
- `tests/story-4-2/liste.test.tsx` : le cas « Invité » attend désormais Modifier, Renvoyer l'invitation, Annuler l'invitation.

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | Blind + Edge + VG | Annulation pendant un renvoi : `generateLink` crée un nouveau compte Auth orphelin, qui bloque l'adresse | medium | Le verrou `for share` ne dure que l'appel SQL ; l'id différent est refusé sans être supprimé → patch (supprimer le compte seulement s'il vient d'être créé par cet appel) |
| 2 | Blind + Edge | Invité qui a cliqué « Continuer » sans choisir de mot de passe : « Renvoyer » échoue (`email_exists`) | medium | Le membre reste « Invité » sans moyen d'obtenir un lien → patch (lien `recovery` dans ce cas, menant à la version invitation de `/nouveau-mot-de-passe`) |
| 3 | Blind + Edge + VG | Journal `invitation_renvoyee` écrit avant `generateLink` | low | Écart seulement si Auth échoue, déjà signalé à Sentry ; le plan impose la vérification par la base avant Auth → rejeté |
| 4 | Blind | Invitation déjà annulée par un autre administrateur : `DONNEES_INVALIDES`, liste non rafraîchie | low | Les deux fonctions lèvent `DONNEES_INVALIDES` pour une ligne absente → patch (traité comme `ETAT_COMPTE_INVALIDE`) |
| 5 | Blind + Edge | Focus perdu après une annulation réussie | low | La ligne et son bouton disparaissent → patch (focus sur « Inviter un membre ») |
| 6 | Blind + Edge (claim) | Suppression Auth en échec : « Invitation annulée. » alors que l'adresse reste bloquée | low | Conforme au plan (Sentry alerté) ; une session issue de l'ancien lien n'a pas de profil et est refusée → rejeté |
| 7 | Blind | Renvoi d'une invitation expirée jamais testé | medium | Le nouveau délai de 24 h dépend de la remise à zéro de `confirmation_sent_at`, non prouvée → patch (test) |
| 8 | Blind | Pas de test de concurrence (annulation contre activation, renvoi contre annulation) | low | Le cas utile est couvert par le patch 1 → rejeté |
| 9 | Blind + VG | États d'échec et d'attente de l'écran non testés | low | Même convention que les autres actions de comptes → reporté (VG : defer) |
| 10 | Blind | Carnet et plan absents de la relecture | false | Exclus exprès du fichier de relecture (méthode) |
| 11 | Blind | `annuler_invitation` ne vérifie pas la suppression ; clés étrangères vers `membres` | low | Un invité ne peut être ni responsable, ni auteur, ni saisisseur (droits réservés aux actifs) → rejeté |
| 12 | Blind | Ordre alphabétique de `DROITS_ATTENDUS` | low | Cosmétique, correction directe → patch |
| 13 | Edge + VG | Commentaire SQL : le verrou ne protège pas l'intervalle avant `generateLink` | low | Commentaire seulement, migration déjà appliquée ; le cas réel est traité par le patch 1 → rejeté |

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-4-4 tests/story-4-1 tests/story-4-2 tests/story-4-3 tests/securite tests/story-1-3/deposer.test.ts` -- vert
- `npx playwright test tests/story-4-4 tests/story-4-1 tests/story-4-2` -- vert, ordinateur et téléphone
