---
title: 'Story 4.3 — Retrouver l''accès en cas de mot de passe oublié'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '163a89d2d751d404a6e0a18330f443a5c66eeaa1'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-inviter-un-membre.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** un membre qui oublie son mot de passe reste bloqué : aucune page ne permet d'en choisir un nouveau, et l'administrateur ne peut pas l'aider.

**Approach :** une page « Mot de passe oublié » qui répond toujours le même message et envoie, aux adresses autorisées, un email avec un lien de 24 h ; un bouton « Générer un lien de mot de passe » pour l'administrateur ; les deux liens passent par `/auth/confirmer` puis la version « réinitialisation » de `/nouveau-mot-de-passe`, déjà utilisées par l'invitation.

## Boundaries & Constraints

**Always :**
- **Connexion** : lien « Mot de passe oublié » sous le champ Mot de passe, vers `/mot-de-passe-oublie`.
- **`/mot-de-passe-oublie`** (page publique centrée, comme `/connexion`) : champ Email, bouton « Recevoir un lien ». Quel que soit l'email (inconnu, invité, désactivé, actif, limite atteinte, envoi impossible), le même message : « Si un compte actif correspond à cette adresse, un email avec un lien valable 24 h vient de lui être envoyé. Sans email, demandez un lien à votre administrateur. ». Temps de réponse sans écart visible selon l'existence du compte (envoi fait sans faire attendre la réponse ou durée minimale fixe).
- **Envoi** (action `demanderLienMotDePasse`, `lib/actions/comptes.ts`) : Zod → empreintes (`empreinteEmail`, `empreinteIp`) → `demander_reinitialisation` (limite) → si membre actif et adresse dans `EMAILS_AUTORISES` : `generateLink({ type: "recovery" })`, lien `${NEXT_PUBLIC_SITE_URL}/auth/confirmer?token_hash=…&type=recovery`, email par une nouvelle fonction `envoyerLienMotDePasse` de `lib/server/emails.ts` (même expéditeur, même liste, clé d'idempotence `mot-de-passe/<jeton haché>`, texte « valable 24 h »). Hors liste : aucun envoi (mode démonstration). Un échec d'envoi est signalé à Sentry sans email ni nom.
- **Limite** : au plus 1 lien par adresse toutes les 60 s et 5 demandes par IP en 15 min ; au-delà, rien n'est généré (même message). Lignes effacées après 1 jour.
- **Administrateur** : « Générer un lien de mot de passe » sur la ligne d'un membre **actif** autre que soi ; fenêtre du lien réutilisée de 4.1 (titre « Lien de mot de passe », « Copier », « Ce lien est valable 24 h. ») ; refusé à un collaborateur (`ACCES_REFUSE`) et pour un compte non actif (`ETAT_COMPTE_INVALIDE`) ; journal `compte` `{evenement: "lien_mot_de_passe_genere", membre_id, nom}`. Le lien précédent du membre devient invalide.
- **`/auth/confirmer?type=recovery`** : titre « Nouveau mot de passe », bouton « Continuer » (jeton consommé seulement au clic, comme 4.1). Lien invalide, expiré ou déjà utilisé : « Ce lien n'est plus valable. » + bouton « Demander un nouveau lien » vers `/mot-de-passe-oublie` (l'invitation garde « … Contactez votre administrateur. »).
- **`/nouveau-mot-de-passe`, version réinitialisation** : pour un membre actif dont la session vient d'un lien (méthode `amr` la plus récente différente de `password`), titre « Choisissez un nouveau mot de passe », mêmes champs et règle 8 caractères ; `choisirMotDePasse` met **vraiment** à jour le mot de passe puis renvoie vers `/equipe`. Session ouverte par mot de passe : « Ce lien n'est plus valable. » (pas de changement de mot de passe sans lien).
- **Migration `20261103000028_mot_de_passe_oublie.sql`** : table `demandes_reinitialisation` (empreintes HMAC seulement, date ; RLS sans droit), `demander_reinitialisation(p_empreinte_email, p_empreinte_ip, p_email)` (service_role ; renvoie `{envoyer: bool}`, vrai seulement pour un membre actif sous la limite), `noter_lien_mot_de_passe(p_id)` (administrateur actif ; vérifie l'état et écrit le journal). `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` nominatif ; listes de droits à jour. Le numéro 0027 est réservé à la story 3.4.
- **Test d'expiration** : un lien de récupération dont l'envoi date de plus de 24 h est refusé et un de 23 h accepté (date d'envoi reculée en base sur un compte `TEST-` ; vérifier sur nova-dev quel champ Auth porte cette date).

**Never :**
- Ne jamais dire si un compte existe ; ne jamais envoyer d'email à une adresse hors `EMAILS_AUTORISES` ; ne pas utiliser l'envoi d'emails de Supabase.
- Ne pas changer de mot de passe sans lien (pas de « changer mon mot de passe » depuis l'espace équipe).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Email inconnu | `inconnu@example.com` | Message commun ; rien d'envoyé |
| Adresse autorisée | Abraham, actif | Message commun ; email avec lien 24 h ; nouveau mot de passe → `/equipe` |
| Hors liste | Membre actif hors `EMAILS_AUTORISES` | Message commun ; aucun envoi |
| Invité / désactivé | Compte non actif | Message commun ; rien d'envoyé |
| Limite | 2ᵉ demande en moins de 60 s, ou 6ᵉ par IP en 15 min | Message commun ; rien de généré |
| Admin | « Générer un lien » pour un actif | Fenêtre du lien + « Copier » ; journal |
| Collaborateur | Appel de l'action | `ACCES_REFUSE`, rien généré |
| Lien réutilisé | Lien déjà consommé | « Ce lien n'est plus valable. » + « Demander un nouveau lien » |
| Lien de 25 h | Envoi reculé de 25 h | Refusé ; 23 h : accepté |
| Session par mot de passe | `/nouveau-mot-de-passe` sans lien | « Ce lien n'est plus valable. » |

</frozen-after-approval>

## Code Map

- `lib/server/emails.ts` -- `expediteurResend`, `lireAdressesAutorisees`, `estAdresseAutorisee`, `echapperHtml`, `enteteExpediteur`, `OptionsEnvoi` (injection en test), `envoyerConfirmation` (modèle) ; tests `tests/story-1-7/emails.test.ts` (`vi.mock("resend")`, `expediteurSimule`). Jamais d'appel réel à Resend en test.
- `lib/server/empreintes.ts` (`empreinteEmail`, `empreinteIp`), `lib/server/adresse-ip.ts` (`lireAdresseIp`) ; modèle de limite : `20261103000012_tentatives_connexion.sql` (verrou consultatif, purge 1 jour, RLS sans droit).
- `lib/schemas/mot-de-passe.ts:105` -- `TYPES_LIEN = ["invite"]` : ajouter `recovery` ; `lib/server/liens.ts:29` -- `lienInvitation` (type en dur) : généraliser.
- `lib/actions/comptes.ts` -- `confirmerLien` (:271), `choisirMotDePasse` (:329 ; la branche « déjà actif » redirige **sans** mettre à jour le mot de passe : à corriger), `connexion` ; `lib/session.ts` (`invitationDuClient`, `profilDuClient`, `heureDeConnexion` dans `lib/supabase/proxy.ts` pour lire `amr`).
- `app/auth/confirmer/page.tsx`, `components/confirmer-lien.tsx` (textes d'invitation en dur), `app/nouveau-mot-de-passe/page.tsx` (`lireEtat`), `components/formulaire-mot-de-passe.tsx`, `app/connexion/page.tsx`, `components/formulaire-connexion.tsx`.
- `components/nova/comptes/inviter-membre.tsx:388` (`ContenuLien`, à extraire et paramétrer), `actions-compte.tsx` (`ActionsCompte`), `lib/actions/admin.ts` (`verifierAdmin`, `signaler`, `refusBase`, `CHEMIN_COMPTES`).
- `lib/erreurs.ts` -- `LIEN_INVALIDE` (invitation) : ajouter un message « Ce lien n'est plus valable. » pour la réinitialisation.
- Tests : `tests/outils/comptes.ts`, `tests/story-4-1/inviter.spec.ts` (`autreNavigateur`), `action-base.test.ts:94` (jeton tiré du lien, `verifyOtp`) ; listes de droits `tests/securite/*`, `tests/story-1-3/deposer.test.ts`. Comptes `TEST-` seulement, nettoyés (journal compris).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000028_mot_de_passe_oublie.sql` -- table, `demander_reinitialisation`, `noter_lien_mot_de_passe` ; à appliquer sur nova-dev par la session principale
- [x] `lib/erreurs.ts`, `lib/schemas/mot-de-passe.ts`, `lib/server/liens.ts`, `lib/server/emails.ts` -- type `recovery`, lien générique, email de réinitialisation
- [x] `lib/actions/comptes.ts` -- `demanderLienMotDePasse`, `confirmerLien` et `choisirMotDePasse` en version réinitialisation ; `lib/actions/admin.ts` -- `genererLienMotDePasse`
- [x] `app/mot-de-passe-oublie/page.tsx` + formulaire ; lien sur la connexion ; `/auth/confirmer` et `/nouveau-mot-de-passe` selon le type
- [x] `components/nova/comptes/*` -- fenêtre du lien partagée, bouton « Générer un lien de mot de passe »
- [x] `tests/story-4-3/` -- base (limite, droits, journal, expiration 24 h), emails (expéditeur simulé), action (message identique, ordre, refus), navigateur (critères 1 à 4, axe, ordinateur et téléphone)
- [x] `docs/carnet-ia.md` -- ligne de la story 4.3

**Acceptance Criteria :**
- Given la page de connexion, when je clique sur « Mot de passe oublié » et saisis un email, then je lis le même message, que l'email existe ou non.
- Given l'adresse autorisée d'Abraham, when il fait cette demande, then il reçoit un email avec un lien valable 24 h, qui lui permet de choisir un nouveau mot de passe et de se connecter.
- Given que je suis administratrice, when je clique sur « Générer un lien de mot de passe » pour un membre actif, then le lien m'est affiché avec « Copier ».
- Given un lien déjà utilisé, when je l'ouvre à nouveau, then je lis « Ce lien n'est plus valable. » avec un bouton pour en demander un nouveau.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | Blind + Edge | Demande toutes les 60 s depuis des IP changeantes : le lien en attente d'un membre est sans cesse remplacé | medium | Chaque demande acceptée appelle `generateLink`, qui invalide le lien précédent ; aucune limite longue par adresse → patch (5 par adresse sur 24 h, migration 0028 pas encore appliquée) |
| 2 | Blind + Edge + VG | Empreintes indisponibles ou échec de `demander_reinitialisation` : demande perdue, seulement `console.error` | medium | En production sans en-tête IP, toutes les demandes seraient ignorées sans alerte → patch (`signaler`) |
| 3 | Blind | Échec réseau côté navigateur affiché comme « email envoyé » | low | `catch` renvoie `envoyee: true` ; correction directe → patch |
| 4 | Blind + Edge | Session ouverte par lien : mot de passe changeable à nouveau pendant 8 h | medium | `sessionParLien` ne regarde que la méthode → patch (fenêtre d'1 h après le lien) |
| 5 | Edge | Toute méthode non `password` (totp, oauth…) compte comme lien ; égalité d'horodatage dépendante de l'ordre | low | Corrections directes (liste blanche, `password` prioritaire) → patch |
| 6 | Blind | Autres sessions non fermées après réinitialisation | medium | Une session volée resterait valable jusqu'à 8 h → patch (`signOut({ scope: "others" })`) |
| 7 | Blind | Réinitialisation terminée absente du journal | low | Le journal exigé (epic 4) ne cite pas l'usage du lien → rejeté |
| 8 | Blind | Un administrateur peut générer un lien pour un autre administrateur et se connecter à sa place | low | Conforme au critère 3 (membre actif) ; les administrateurs peuvent déjà rétrograder ou désactiver ; la génération est journalisée → rejeté |
| 9 | Blind + Edge | Journal « lien généré » écrit avant `generateLink` | low | Écart seulement si `generateLink` échoue, déjà signalé à Sentry → rejeté |
| 10 | Blind + Edge (claim) | `config.toml` : `otp_expiry = 3600` alors que tout promet 24 h | low | Base locale seulement ; nova-dev et nova-prod réglés à 86 400 → patch (aligner le fichier) |
| 11 | Blind | Mot de passe identique accepté comme réinitialisation réussie | low | Aucun dommage : le membre retrouve l'accès → rejeté |
| 12 | Blind | `signaler` recopié trois fois, lecture de `amr` dupliquée, règle de session dans le proxy | low | Pas de défaut constaté → rejeté |
| 13 | Blind | Tests manquants (`methodeDeConnexion`, `lireEtat`, compte désactivé à `/auth/confirmer`, envoi réel) | low | Les cas `methodeDeConnexion` viennent avec le patch 5 ; le reste est couvert indirectement → rejeté |
| 14 | Edge | Invitation, compte ni invité ni actif : « Ce lien n'est plus valable. » sans bouton ni consigne | low | Mauvais message choisi pour l'invitation ; correction directe → patch |
| 15 | Edge | Appel direct de l'action pour son propre compte | low | Seul l'écran cache le bouton ; sans conséquence (lien pour soi) → rejeté |
| 16 | Edge | Paramètre `type` répété dans l'adresse : mauvais titre | low | Adresse fabriquée à la main seulement → rejeté |
| 17 | VG | Champ `parcours` et remplacement du bouton par « Demander un nouveau lien » jamais testés depuis le formulaire | medium | Constat VG pré-vérifié → patch (test de rendu) |
| 18 | VG | Toast d'erreur de « Générer un lien de mot de passe » non testé | low | Codes de refus de l'action déjà testés → reporté (VG : defer) |

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-4-3 tests/story-4-1 tests/story-4-2 tests/story-1-7 tests/story-1-9 tests/securite tests/story-1-3/deposer.test.ts` -- vert
- `npx playwright test tests/story-4-3 tests/story-4-1 tests/story-1-4` -- vert, ordinateur et téléphone

**Manual checks :**
- Critère 2 (email réel reçu par Abraham) : vérifié par Abraham sur sa boîte, si `RESEND_API_KEY` est posée ; sinon noté « à vérifier plus tard » comme en 1.7.
