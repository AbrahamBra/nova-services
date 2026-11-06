---
title: 'Story 4.1 — Inviter un nouveau membre'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '67609224492688b053e4c328403ee5ef08543ea3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** aucun écran ne permet d'ajouter un membre : les comptes ne se créent que par script, et l'administration n'est qu'une page provisoire.

**Approach :** une page Comptes (liste + fenêtre « Inviter un membre ») ; l'action crée le compte Auth et la ligne `membres` (`invite`), journalise, puis affiche un lien d'invitation de 24 h à copier. Le lien mène à `/auth/confirmer`, puis à `/nouveau-mot-de-passe` ; le premier mot de passe passe le compte à `actif` et ouvre l'espace équipe.

## Boundaries & Constraints

**Always :**
- **Page `/equipe/admin/comptes`** (titre « Comptes ») : tableau Nom · Email · Rôle · État (`LIBELLES_ROLE`, `LIBELLES_ETAT_MEMBRE`), trié par nom, lu par `lister_comptes()` ; sur téléphone, une liste de cartes. Vide (seul l'admin) : « Aucun autre compte. Invitez un premier collaborateur. ». `/equipe/admin` redirige vers cette page ; le menu « Administration » contient « Comptes » à la place de « Vue d'ensemble ». `/equipe/admin/test-erreur` reste accessible par son adresse.
- **Fenêtre « Inviter un membre »** : Nom, Email, Rôle (Collaborateur par défaut) ; erreurs sous le champ, saisie conservée, « Envoi en cours… ». Email déjà utilisé (dans `membres` ou dans Auth) : « Cette adresse email est déjà utilisée par un autre membre. » sous Email.
- **Action `inviter`** (`lib/actions/admin.ts`) : profil admin revérifié (sinon `ACCES_REFUSE`), Zod (nom 1-150, email minuscule sans espaces, rôle fermé), `auth.admin.generateLink({ type: "invite" })` (crée l'utilisateur Auth, n'envoie aucun email), puis `creer_membre(..., 'invite', auteur)` ; si `creer_membre` échoue, `auth.admin.deleteUser` (AD-17, échec de suppression signalé à Sentry). Renvoie le lien `${NEXT_PUBLIC_SITE_URL}/auth/confirmer?token_hash=…&type=invite`, puis `revalidatePath`.
- **Fenêtre du lien** : le lien en lecture seule, « Copier » (`copierTexte`), « Ce lien est valable 24 h. » ; aucun email n'est envoyé en 4.1 (mode démonstration).
- **Journal** : `creer_membre` reçoit un `p_auteur_id` facultatif ; quand il est fourni, ligne `compte` `{evenement: "compte_cree", membre_id, nom, role}` au nom de l'auteur (rien pour les scripts et tests, qui ne le passent pas).
- **`/auth/confirmer`** (décision d'Abraham : bouton « Continuer ») : la page affiche « Bienvenue chez Nova Services » et un bouton « Continuer » ; elle ne touche pas au lien à l'affichage (l'aperçu d'une messagerie ne le consomme pas). Le clic appelle l'action `confirmerLien`, qui vérifie le lien côté serveur (`verifyOtp({ token_hash, type })`, client porteur de session) puis redirige vers `/nouveau-mot-de-passe`. Lien invalide, expiré ou déjà utilisé : « Ce lien n'est plus valable. Contactez votre administrateur. ».
- **`/nouveau-mot-de-passe`** : titre « Bienvenue chez Nova Services, [prénom] » (nom lu par `mon_invitation()`), deux champs (mot de passe, confirmation), règle « 8 caractères minimum » affichée, refus côté Zod et côté Supabase. Action `choisirMotDePasse` (`lib/actions/comptes.ts`) : `auth.updateUser({ password })`, puis `activer_mon_compte()` (`invite` → `actif`, sans effet si déjà actif), puis redirection vers `/equipe`. Sans session valide : « Ce lien n'est plus valable. Contactez votre administrateur. ».
- **Migration `20261103000024_inviter_membre.sql`** : `lister_comptes()` (admin actif, sinon `DROIT_INSUFFISANT`), `mon_invitation()` et `activer_mon_compte()` (utilisateur connecté, sur `auth.uid()` seulement), `creer_membre` étendue. Toutes `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` nominatif ; listes des tests de droits mises à jour.
- `proxy.ts` couvre aussi `/auth/confirmer` et `/nouveau-mot-de-passe`. Variable `NEXT_PUBLIC_SITE_URL` (`.env.example`, CI, Netlify) ; son absence fait échouer l'invitation avec un message clair, jamais un lien faux.

**Never :**
- L'administrateur ne voit ni ne saisit le mot de passe ; aucun client Supabase dans le navigateur ; pas d'envoi d'email.
- Pas de modification, désactivation, renvoi, annulation ni « Réactiver ce compte » (stories 4.2 à 4.4).
- Ne pas utiliser l'en-tête `Host` de la requête pour fabriquer le lien.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu |
|---|---|---|
| Invitation | Léo Martin, email neuf, Collaborateur | Ligne « Invité » + fenêtre du lien ; journal `compte_cree` |
| Email pris | Email d'un membre existant (même casse différente) | Message sous Email, aucun compte créé |
| Échec `membres` | `creer_membre` en erreur | Compte Auth supprimé, erreur affichée |
| Collaborateur | Page ou action appelée | Accès refusé, rien créé |
| Lien ouvert | Lien valide, autre navigateur | `/nouveau-mot-de-passe` avec « Bienvenue… Léo » |
| Mot de passe court | 7 caractères | Refusé sous le champ, compte toujours Invité |
| Activation | 8+ caractères, confirmation identique | `/equipe`, état « Actif » dans la liste |
| Lien réutilisé | Lien déjà consommé | « Ce lien n'est plus valable. Contactez votre administrateur. » |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000005_membres.sql` -- `membres` (états `invite|actif|desactive`, RLS sans droit), `prive.est_admin()`, `prive.est_membre_actif()`, `mon_profil()` (null si non actif), `creer_membre` l.159-226 (service_role, codes `DONNEES_INVALIDES`, `MEMBRE_EXISTANT`, `EMAIL_DEJA_UTILISE`, vérifie l'email dans `auth.users`).
- `supabase/migrations/20261103000009_emails_journal.sql:73` -- `prive.ecrire_journal(type, details, auteur_id)` ; type `compte` déjà permis ; détails = codes et ids (pas de données de demandeurs).
- `scripts/premier-admin.ts`, `scripts/comptes-de-test.ts`, `tests/outils/comptes.ts` -- appellent `creer_membre` sans auteur : ne pas casser leur signature.
- `lib/server/appeler.ts` (`appeler`, `Resultat`, `ResultatAction`), `lib/erreurs.ts` (`MESSAGES_ERREUR`, `CODES_APPLICATION`, test de concordance `tests/story-1-3/codes-erreur.test.ts`), `lib/server/supabase-service.ts` (`creerClientService`), `lib/supabase/serveur.ts` (`creerClientServeur`), `lib/session.ts` (`lireProfil`, `estAdmin`).
- `app/equipe/admin/test-erreur/actions.ts` -- modèle de vérification admin dans une action.
- `lib/schemas/saisie.ts`, `components/formulaire-saisie.tsx`, `lib/actions/demandes.ts:757` (`saisir`, `sousLeChamp`) -- modèle formulaire + erreurs sous le champ.
- `lib/schemas/connexion.ts`, `components/formulaire-connexion.tsx`, `app/connexion/page.tsx` -- modèle de page publique centrée.
- `app/equipe/admin/layout.tsx` (garde admin, `AccesRefuse`), `app/equipe/admin/page.tsx` (page provisoire à remplacer), `components/nova/menu-equipe.tsx:31` (`RUBRIQUES_ADMIN`).
- `components/ui/alert-dialog.tsx` -- seule fenêtre installée ; `radix-ui` 1.8 fournit aussi `Dialog` : créer `components/ui/dialog.tsx` sur le même modèle (pas de `npx shadcn`, disque presque plein).
- `lib/copier.ts`, `components/nova/copier-lien.tsx` -- copie ; `lib/domaine.ts` -- `ROLES`, `LIBELLES_ROLE`, `LIBELLES_ETAT_MEMBRE`.
- `proxy.ts`, `lib/supabase/proxy.ts` -- matcher et session de 8 h (`heureDeConnexion` : `amr` le plus récent ; un lien d'invitation y compte comme connexion).
- `.github/workflows/tests.yml:36` -- env de la CI ; `docs/exploitation/deploiement.md` -- variables de production.
- Tests : `tests/outils/comptes.ts` (`creerCompteTest`, `supprimerComptesTest`, `clientServiceTest`, `avecBase`), `tests/outils/ip-test.ts`, modèle `tests/story-2-8/`. Invités de test : nom `TEST-4.1-…`, email `test-…@example.com`, supprimés en fin de test.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000024_inviter_membre.sql` -- `lister_comptes`, `mon_invitation`, `activer_mon_compte`, `creer_membre(+p_auteur_id)` + journal ; appliquer sur nova-dev (`db:push`)
- [x] `lib/erreurs.ts`, tests de droits par rôle -- nouveaux codes éventuels et fonctions exécutables
- [x] `lib/schemas/invitation.ts`, `lib/schemas/mot-de-passe.ts` -- schémas partagés écran/action
- [x] `lib/comptes.ts` -- `lireComptes()` ; `lib/actions/admin.ts` -- `inviter` ; `lib/actions/comptes.ts` -- `confirmerLien`, `choisirMotDePasse`
- [x] `components/ui/dialog.tsx`, `components/nova/comptes/*` -- tableau/cartes, fenêtre d'invitation, fenêtre du lien
- [x] `app/equipe/admin/comptes/page.tsx`, `app/equipe/admin/page.tsx` (redirection), `components/nova/menu-equipe.tsx`
- [x] `app/auth/confirmer/page.tsx`, `app/nouveau-mot-de-passe/page.tsx` + formulaire ; `proxy.ts`
- [x] `.env.example`, `.github/workflows/tests.yml`, `docs/exploitation/deploiement.md` -- `NEXT_PUBLIC_SITE_URL` et réglage « durée des liens 24 h »
- [x] `tests/story-4-1/` -- base (fonctions, droits, journal, retour arrière AD-17), action (refus collaborateur, email pris, mot de passe < 8), navigateur (critères 1 à 3, lien réutilisé, axe, ordinateur et téléphone)
- [x] `docs/carnet-ia.md` -- ligne de la story 4.1

**Acceptance Criteria :**
- Given la page Comptes, when j'invite « Léo Martin » Collaborateur, then il apparaît « Invité » et la fenêtre affiche son lien avec « Copier ».
- Given ce lien dans un autre navigateur, when Léo choisit un mot de passe de 8+ caractères, then il arrive sur `/equipe` et la liste l'affiche « Actif ».
- Given un email déjà utilisé, when j'invite, then un message l'indique sous le champ.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Relecteur | Constat | Verdict | Preuve / décision |
|---|---|---|---|---|
| 1 | Blind + Edge | Fenêtre d'invitation fermable pendant l'envoi : lien perdu, adresse bloquée | medium | `useActionState` dans `DialogContent`, démonté à la fermeture ; Échap et « Annuler » restent actifs → patch |
| 2 | Blind | Aucun moyen de récupérer une invitation en attente ou expirée | low | Réel, mais « Renvoyer » et « Annuler l'invitation » sont la story 4.4 (exclus par l'intention) → rejeté, couvert par 4.4 |
| 3 | Blind + Edge | Deux invitations simultanées de la même adresse : jeton remplacé, suppression possible du compte partagé | maybe-false | Les codes `MEMBRE_EXISTANT` / `EMAIL_DEJA_UTILISE` ne suppriment rien ; reste le jeton remplacé et les branches « sans jeton » / erreur inattendue dans la marge de 2 min → reporté (deferred-work) |
| 4 | Edge | `created_at` absent ou horloge en avance de plus de 2 min : compte Auth orphelin jamais supprimé | maybe-false | Supabase renvoie toujours `created_at` (vu dans la sonde) ; il faudrait un décalage d'horloge > 2 min → reporté avec la 3 |
| 5 | Blind | Tri de la liste testé avec une comparaison JS différente du tri SQL | low | `order by lower(nom)` (collation de la base) contre `toLowerCase()` en JS sur base partagée → patch du test |
| 6 | Blind + Edge | Lien ouvert dans un navigateur déjà connecté : la session de l'administrateur est remplacée | low | Réel (`verifyOtp` écrase les cookies), gêne seulement, pas de faille ; le garde ajoute une branche → rejeté |
| 7 | Blind | L'activation n'écrit rien au journal | low | Le journal exigé (epic 4) couvre création, modification, désactivation, réactivation ; pas l'activation → rejeté |
| 8 | Blind | Limite de 72 comptée en octets, message en caractères | low | Message faux pour un mot de passe accentué ; correction de texte directe → patch |
| 9 | Blind | Commentaires contraires au code (`fenetre-invitation.tsx`, « hexadécimal ») | low | Vérifié ; correction directe → patch |
| 10 | Blind | `NEXT_PUBLIC_` lue à la construction | false | Nom imposé par l'epic ; `deploiement.md:79` prévient qu'il faut relancer une mise en ligne ; la CI la fournit au build (`tests.yml`) |
| 11 | Blind + VG | Branches d'erreur de `confirmerLien`, `choisirMotDePasse`, `inviter` non testées (`same_password`, déjà activé, 5xx, session perdue, activation en échec, sans jeton) | medium | Constats VG pré-vérifiés (suppression d'une branche sans test rouge) → patch des tests |
| 12 | Blind | Page Comptes : « Inviter un membre » affiché à côté d'un accès refusé | low | Cas `DROIT_INSUFFISANT` de `lister_comptes` ; correction directe → patch |
| 13 | Blind | `ConfirmerLien` compare le texte du message | low | Fonctionne aujourd'hui ; refonte plus large qu'une correction → rejeté |
| 14 | Blind | `token_hash` dans l'adresse : journaux et Sentry | false | `beforeSend` de Sentry retire déjà les paramètres d'adresse (story 3.3) ; page en `no-referrer` ; jeton à usage unique de 24 h |
| 15 | VG (autre) | `tests/story-1-3/deposer.test.ts` : liste des fonctions de service_role sans `verifier_email_libre` | high | Exécuté : 1 échec (`+ "verifier_email_libre"`) → patch |
| 16 | Edge | 422 sans code de Supabase affiché comme « adresse déjà utilisée » | low | L'email est déjà validé par Zod ; cas improbable, garde supplémentaire → rejeté |
| 17 | Edge | `verifyOtp` en 429 : lien valide affiché comme mort, « Continuer » disparaît | low | Ajout direct du 429 à la branche serveur → patch |
| 18 | Edge | `getClaims` en panne (page et action) affichée comme « lien plus valable », sans « Réessayer » | low | Même correction directe → patch |
| 19 | Edge | `activer_mon_compte` appelable avant tout mot de passe | low | Demande d'extraire son jeton et d'appeler l'API soi-même ; le compte reste celui de l'invité légitime, sans mot de passe → rejeté (nouvelle migration) |
| 20 | Edge (claim) | « Valable 24 h » dépend d'un réglage Supabase manuel | false | Réglage documenté (`deploiement.md`, Design Notes) et demandé à Abraham sur nova-dev et nova-prod |

## Design Notes

Lien fabriqué par l'application à partir de `properties.hashed_token` de `generateLink` : pas d'adresse de redirection à autoriser dans Supabase, et la page `/auth/confirmer` reste la seule entrée. La durée de 24 h vient du réglage Supabase « Email OTP Expiration » (86 400 s), posé à la main sur nova-dev et nova-prod (prouvé par test automatique en 4.3/4.4).

## Verification

**Commands :**
- `npm run lint && npm run typecheck` -- aucune erreur
- `npx vitest run tests/story-4-1 tests/story-1-3/codes-erreur.test.ts` -- vert, plus les tests de droits mis à jour
- `npx playwright test tests/story-4-1` -- vert, ordinateur et téléphone
