---
title: 'Story 1.7 — Recevoir l''email de confirmation'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'c948715d4804b42409e10bd08ed5fe3d152f3e1f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-coursenia-2026-11-03/architecture.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** après l'envoi, le client voit sa référence à l'écran, mais il ne reçoit rien. S'il ferme la page, il perd sa preuve.

**Approach :** après l'enregistrement de la demande, envoyer un email de confirmation via Resend, depuis un module serveur unique (AD-13). Sans domaine acheté (budget 0 €), Resend n'écrit qu'à l'adresse du compte d'Abraham : c'est le **mode démonstration**. Seules les adresses de `EMAILS_AUTORISES` reçoivent l'email ; pour les autres, la demande est enregistrée et marquée « non envoyé (démonstration) ». Le résultat est noté sur la demande, et un échec est inscrit au journal. L'envoi de l'email ne fait jamais échouer un dépôt.

## Boundaries & Constraints

**Always :**
- Un seul module d'envoi `lib/server/emails.ts` (`server-only`), avec l'API Resend et l'expéditeur `onboarding@resend.dev`. La clé `RESEND_API_KEY` n'est lue que dans `lib/server/` (AD-9).
- `EMAILS_AUTORISES` : liste d'adresses séparées par des virgules, comparées en minuscules. Une adresse absente de la liste → aucun appel à Resend, état `non_envoye_demo`.
- **Ordre :** enregistrement (`deposer_demande`), puis envoi, puis `noter_resultat_email(id, etat)`, puis redirection vers la confirmation. Un échec d'envoi ou de notation ne change ni la redirection ni le contenu de la confirmation, sauf la phrase sur l'email.
- `noter_resultat_email` : `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` à `service_role` seul. Passage autorisé uniquement depuis `en_attente`, vers `envoye`, `echec` ou `non_envoye_demo`.
- **Contenu de l'email :**
  - objet « Votre demande NOVA-… a bien été enregistrée » ;
  - corps en texte simple et en HTML : la référence, l'objet de la demande, la date (heure de Paris), le nom et l'email de contact lus dans `parametres` ;
  - **jamais** la description, ni le téléphone, ni la société.
  - Les textes saisis par le client sont échappés dans la version HTML.
- **Page de confirmation :** la phrase « Un email de confirmation vous a été envoyé. » s'affiche **uniquement** si l'état vaut `envoye`. Pour cela, `lire_confirmation` renvoie aussi l'état de l'email.
- **Journal :**
  - table `journal` (type fermé, détails structurés, auteur : membre ou « système », date) ;
  - écriture seulement via `prive.ecrire_journal` (AD-19) ;
  - RLS activée, aucun droit direct pour personne (la lecture arrive en story 5.1) ;
  - un échec d'envoi écrit une ligne de type `email`, auteur « système », avec la référence et le code d'erreur, **jamais** l'adresse du demandeur (AD-14).
- Les tests n'appellent **jamais** le vrai Resend : le module d'envoi accepte un expéditeur simulé. L'envoi réel n'est vérifié qu'à la main par Abraham.
- `.env.example` complété (`RESEND_API_KEY`, `EMAILS_AUTORISES`, sans valeur). Le secret GitHub n'est pas nécessaire : en CI, l'envoi est simulé.

**Never :**
- Pas d'email lors de la saisie interne (story 2.6 l'ajoutera) ; pas de page de journal (story 5.1).
- Aucun email vers une adresse hors de `EMAILS_AUTORISES`.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Adresse autorisée, envoi réussi | Email d'Abraham, Resend répond OK | État `envoye` ; la confirmation affiche « Un email de confirmation vous a été envoyé. » ; email reçu avec la référence, l'objet, la date et le contact, sans la description | — |
| Adresse non autorisée | Autre email | Aucun appel à Resend ; état `non_envoye_demo` ; confirmation sans la phrase | — |
| Majuscules dans l'adresse | `Abraham@…` alors que la liste est en minuscules | Considérée comme autorisée | — |
| Resend en échec | Erreur de l'API ou délai dépassé | État `echec` ; ligne de journal `email` sans l'adresse ; confirmation affichée normalement, sans la phrase | — |
| Clé absente | `RESEND_API_KEY` vide | Comme un échec ; la demande est enregistrée | — |
| `<b>` dans l'objet | Objet saisi avec du HTML | Affiché comme du texte dans l'email HTML | — |
| Notation en double | `noter_resultat_email` appelée deux fois | Seul le premier passage depuis `en_attente` compte ; le second est refusé sans planter le dépôt | Code prévu |
| Appel direct | Clé publiable sur `noter_resultat_email` ou sur `journal` | Refusé | Droit absent |

</frozen-after-approval>

## Code Map

- `lib/actions/demandes.ts` -- action `deposer` : y brancher l'envoi après `deposer_demande` et avant la redirection.
- `supabase/migrations/20261103000003_demandes.sql` -- `deposer_demande` et `lire_confirmation`, colonne `etat_email` (défaut `en_attente`) ; `lire_confirmation` est à remplacer (`create or replace`) pour renvoyer aussi l'état de l'email.
- `app/confirmation/[jeton]/page.tsx`, `lib/confirmation.ts` -- page de confirmation : y ajouter la phrase conditionnelle.
- `lib/server/appeler.ts`, `lib/server/supabase-service.ts`, `lib/erreurs.ts` (`CODES_APPLICATION`, concordance des codes), `lib/domaine.ts` (`ETATS_EMAIL`, types de journal), `lib/format.ts` (dates à l'heure de Paris).
- `lib/infos-publiques.ts` -- lecture du nom et de l'email de contact (réutilisable pour l'email).
- `supabase/migrations/20261103000004_*`, `…0005_*` -- `service_role` sans droit direct sur les tables ; reproduire pour `journal`.
- `tests/securite/*`, `tests/story-1-3/*` -- listes de droits et de fonctions attendues à compléter ; les tests d'envoi de la 1.3 doivent rester verts (envoi simulé).

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000009_emails_journal.sql` -- table `journal`, `prive.ecrire_journal`, `noter_resultat_email`, nouvelle version de `lire_confirmation` (avec l'état de l'email), droits
- [x] `lib/server/emails.ts` -- liste autorisée, envoi Resend, contenu texte et HTML échappé, expéditeur simulé injectable
- [x] `lib/actions/demandes.ts` -- envoi puis notation après le dépôt, sans jamais faire échouer le dépôt
- [x] `lib/confirmation.ts`, `app/confirmation/[jeton]/page.tsx` -- phrase affichée seulement si `envoye`
- [x] `lib/erreurs.ts`, `lib/domaine.ts` -- nouveaux codes et types de journal
- [x] `package.json` -- dépendance `resend@6.37`
- [x] `.env.example` -- variables d'email sans valeur
- [x] `tests/story-1-7/emails.test.ts` -- liste autorisée, contenu sans description, HTML échappé, échec et clé absente
- [x] `tests/story-1-7/notation.test.ts` -- base : passages d'état, double notation refusée, ligne de journal sans adresse, droits
- [x] `tests/story-1-7/confirmation.spec.ts` -- navigateur (envoi simulé) : phrase présente si `envoye`, absente sinon
- [x] `tests/securite/*`, `tests/story-1-3/*` -- listes attendues mises à jour
- [x] `docs/carnet-ia.md` -- ligne de la story 1.7 (colonne d'Abraham à compléter)

**Acceptance Criteria :**
- Given la migration appliquée, la clé Resend et `EMAILS_AUTORISES` renseignés par Abraham, when il suit les critères 1 et 2 de la story 1.7 d'`epics.md`, then chacun est visible à l'écran et dans sa boîte mail.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert, sans aucun appel réel à Resend.

## Implementation Notes

- **`deposer_demande` remplacée** (`create or replace`, même signature, mêmes droits) dans les migrations 0009 puis 0010 : elle renvoie aussi `id`, `objet`, `cree_le`, `nom_affiche`, `email_contact` (lus dans `parametres`), `nouvelle` et `etat_email` (AD-13 : « les fonctions SQL renvoient les données de l'email »). L'action envoie si `nouvelle` ou si `etat_email = 'en_attente'` (premier appel coupé, notation perdue, second envoi) ; la clé d'idempotence Resend `confirmation-demande/<id>` évite les doublons, et une réponse `concurrent_idempotent_requests` n'est pas notée (l'autre appel note). Données de l'email absentes : noté `echec` / `donnees_absentes`.
- **Signature** : `noter_resultat_email(p_demande_id uuid, p_etat text, p_code_erreur text default null)`. Codes : `DONNEES_INVALIDES` (état non permis), `EMAIL_DEJA_NOTE` (plus `en_attente`), `DEMANDE_INTROUVABLE`. Un code d'erreur absent ou qui n'est pas `^[a-z0-9_]{1,64}$` est noté `inconnu`.
- **Journal** : `details` = `{ evenement: "echec_confirmation", reference, code }`, auteur `systeme`. UPDATE refusé ; DELETE et TRUNCATE refusés sauf `set_config('nova.purge_journal', 'on', true)` dans la transaction (pour `purger_technique`, migration 0010).
- **Resend** : expéditeur `EMAIL_EXPEDITEUR` (défaut `onboarding@resend.dev`), nom affiché entre guillemets (RFC 5322) ; envoi à l'adresse saisie (sans espaces), comparée en minuscules ; délai 5 s. `EMAILS_AUTORISES=*` : toutes les adresses (production avec domaine vérifié) ; vide : personne.
- **Confirmation** : état d'email inconnu traité comme `en_attente`.
- **Tests navigateur** : les adresses de test sont hors de `EMAILS_AUTORISES` (et `*` refusé) ; l'état `envoye` est écrit directement en base pour simuler un envoi réussi.

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Pas d'interrupteur de production conforme à l'AD-13 ; expéditeur en dur | medium | Corrigé (patch) : `EMAIL_EXPEDITEUR`, `EMAILS_AUTORISES=*` ; AD-13 mis à jour. |
| Demande bloquée en `en_attente` (coupure, échec de notation, double envoi) | medium | Corrigé (patch) : migration 0010, renvoi si encore `en_attente` (clé d'idempotence). |
| Journal protégé seulement contre la modification | medium | Corrigé (patch) : effacement refusé hors purge explicite. |
| En-tête From non entre guillemets | low | Corrigé (patch). |
| Adresse envoyée en minuscules | low | Corrigé (patch). |
| Délai de 10 s avant la confirmation | low | Corrigé (patch) : 5 s. |
| État d'email inconnu = page « plus disponible » | low | Corrigé (patch). |
| Constantes inutilisées | low | Corrigé (patch). |
| Test « jamais la description » sans valeur ; garde d'adresse absente en 1.3 ; critère 2 non testé de bout en bout ; échec sans code | medium | Corrigé (patch) : tests remplacés ou ajoutés. |
| Envoi non annulé après le délai (email reçu mais noté `echec`) | low | Rejeté : rare ; le client a son email, seule la phrase manque. |
| Table `parametres` vide | false | Une ligne est toujours créée par migration (story 1.2). |
| Envoi après la réponse (`after()`) | low | Rejeté : la page de confirmation doit connaître l'état de l'email. |
| Réception réelle via Resend non vérifiée | medium | Reporté : compte Resend à créer par Abraham. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0009 appliquée. **Si refusée par les permissions, le signaler : Abraham la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Abraham dépose une demande avec son adresse autorisée et reçoit l'email ; puis une autre avec une adresse fictive, et voit « Email non envoyé (mode démonstration) » dans le détail.
- Ne rien commiter avant cette vérification.
