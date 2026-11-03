---
title: 'Story 1.3 — Envoyer ma demande et recevoir ma référence'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '2483d20b2ce04ccc9c210816116cb028c1470eba'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** le formulaire public s'affiche, mais le bouton « Envoyer ma demande » ne fait rien. Aucune demande n'est enregistrée, et le client ne reçoit aucune preuve.

**Approach :** brancher l'envoi. Une action serveur valide la saisie (Zod), puis appelle une fonction SQL `deposer_demande` réservée au serveur. Cette fonction enregistre la demande, fabrique la référence `NOVA-AAAA-NNNN` sans doublon, écrit l'historique `creation` et renvoie un jeton aléatoire. Le client arrive alors sur `/confirmation/[jeton]`, qui affiche sa référence sans aucune donnée personnelle.

## Boundaries & Constraints

**Always :**
- Champs et règles du PRD FR-1, FR-2, FR-4 et d'epic-1-context. Nom, email, catégorie active, objet, description et consentement sont obligatoires ; téléphone et société sont facultatifs. Longueurs maximales : 150 caractères (nom, société, objet), 5 000 (description), 30 (téléphone). Les longueurs se comptent en caractères, comme `char_length` en base (un emoji = 1). L'email est nettoyé des espaces et mis en minuscules (AD-31).
- Les messages d'erreur s'affichent sous chaque champ fautif, la saisie est conservée, et le focus va au premier champ en erreur. Erreurs annoncées par `aria-live`. Textes d'EXPERIENCE.md §3 (« Indiquez votre adresse email. », « Cette adresse email ne semble pas valide. », « Cochez cette case pour envoyer votre demande. »…).
- Pendant l'envoi : bouton désactivé, libellé « Envoi en cours… ».
- Le compteur de description passe en rouge et le dit (`aria-live`) au-delà de 5 000 caractères (report de la story 1.2).
- Enregistrement : canal `formulaire`, statut `nouvelle`, priorité `normale`, `etat_email` `en_attente`, sans responsable, date de consentement, ligne d'historique `creation` (auteur « demandeur »).
- Référence fabriquée **uniquement** par la base, à partir de `compteurs_reference`, en verrouillant la ligne de l'année (heure de Paris) ; numéro sur 4 chiffres minimum, qui s'allonge au-delà de 9 999 (AD-6).
- Anti-doublon : une `cle_envoi` aléatoire, créée à l'affichage du formulaire et unique en base. Un second envoi avec la même clé renvoie la demande existante, sans en créer une autre (AD-26).
- `deposer_demande` et `lire_confirmation` : `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` à `service_role` seul (AD-15, AD-16). Erreurs prévues levées en `P0001` avec un code connu de `lib/erreurs.ts` (AD-20). Test de concordance des codes.
- Confirmation : « Votre demande a bien été enregistrée. », référence en grand avec « Copier » (→ « Copié » 2 s), « Conservez-la pour tout échange avec notre équipe. », contact, lien « Déposer une autre demande ». Jamais le nom, l'email ni la description. Jeton inconnu ou de plus de 24 h : « Cette page n'est plus disponible. ».
- Erreur serveur : bandeau « Le serveur ne répond pas… » avec « Réessayer », saisie conservée.
- Tests avec des données préfixées `TEST-`, effacées à la fin ; uniquement sur `nova-dev`.

**Never :**
- Pas d'email de confirmation (story 1.7), pas d'anti-spam ni de champ piège (story 1.8), pas de liste ni de détail côté équipe (stories 1.5 et 1.6).
- Pas de table `membres` : `responsable_id` et `saisie_par_id` sont créés sans clé étrangère, ajoutée en story 1.4.
- Ne jamais afficher la phrase « Un email de confirmation vous a été envoyé. » (story 1.7).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Envoi correct | Tous les champs valides, case cochée | Page de confirmation avec `NOVA-2026-NNNN` ; demande en base avec les valeurs par défaut et l'historique `creation` | — |
| Champs manquants | Description vide, email `abc`, case non cochée | 3 messages sous les champs, saisie conservée, pas de confirmation | Validation |
| Trop long | Objet de 151 caractères | Message sous Objet ; refusé aussi par la base si appel direct | `DONNEES_INVALIDES` |
| Catégorie désactivée ou inconnue | `categorie_id` invalide | Message sous Catégorie | `CATEGORIE_INVALIDE` |
| Double envoi | Même `cle_envoi` deux fois | Une seule demande ; même référence et même jeton | — |
| Envois simultanés | 2 envois en parallèle, clés différentes | 2 références différentes et consécutives | — |
| Email en majuscules | `Jean.Dupont@Example.COM ` | Enregistré `jean.dupont@example.com` | — |
| Jeton inconnu ou expiré | Jeton aléatoire, ou demande de plus de 24 h | « Cette page n'est plus disponible. » | — |
| Appel direct par un visiteur | Clé publiable sur `deposer_demande` | Refusé | Droit `EXECUTE` absent |
| Base injoignable à l'envoi | Erreur SQL imprévue | Bandeau « Le serveur ne répond pas… », saisie conservée | `ERREUR_INATTENDUE` |
| Texte avec `<script>` | Dans la description | Enregistré tel quel, sans aucun effet | — |

</frozen-after-approval>

## Code Map

- `components/formulaire-depot.tsx` -- formulaire client de 1.2 (`onSubmit` qui bloque l'envoi, compteur, `LONGUEUR_MAX_DESCRIPTION`) : à brancher sur l'action avec `useActionState`. Garder les textes et classes.
- `app/page.tsx` -- page serveur `force-dynamic` : y générer la `cle_envoi` et la passer au formulaire.
- `lib/server/appeler.ts` -- `appeler()` : réutiliser ; il traduit `P0001` + code connu en `{ ok: false, code, message }`.
- `lib/erreurs.ts` -- ajouter `DONNEES_INVALIDES`, `CATEGORIE_INVALIDE`, `CONSENTEMENT_REQUIS` avec leurs messages.
- `lib/domaine.ts` -- codes fermés (statut, priorité, canal, état email, types d'historique) : à utiliser, ne pas les recopier.
- `lib/format.ts` -- `formaterNombre` (espace insécable) pour le compteur.
- `lib/server/supabase-service.ts` -- client clé secrète pour l'action et la confirmation.
- `components/nova/bouton.tsx`, `components/nova/reessayer.tsx` -- bouton principal, et bouton « Réessayer ».
- `supabase/migrations/20261103000001_*`, `…0002_*` -- droits par défaut retirés : tout nouvel objet démarre sans droit.
- `tests/securite/droits-anon.test.ts` -- doit rester vert (les nouvelles tables et fonctions n'ont aucun droit `anon`/`authenticated`).
- `tests/story-1-2/*` -- doivent rester verts. Adapter seulement les assertions qui testaient « bouton sans effet ».

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000003_demandes.sql` -- tables `demandes`, `compteurs_reference` et `historique` (contraintes CHECK des codes, longueurs, email en minuscules), RLS activée sans règle ; déclencheur des dates (AD-22) ; `prive.ecrire_historique` ; `deposer_demande` (idempotente par `cle_envoi`, verrou de l'année) ; `lire_confirmation(jeton)` ; `EXECUTE` à `service_role` seul
- [x] `lib/erreurs.ts` -- 3 nouveaux codes et leurs messages
- [x] `lib/schemas/depot.ts` -- schéma Zod partagé écran/action (longueurs en caractères, email normalisé, consentement obligatoire, `cle_envoi` uuid)
- [x] `lib/actions/demandes.ts` -- action serveur `deposer` : Zod → `deposer_demande` (clé secrète) → redirection vers `/confirmation/[jeton]`, ou erreurs par champ, ou erreur générale
- [x] `components/formulaire-depot.tsx` -- `useActionState`, valeurs conservées, erreurs sous les champs (`aria-live`, `aria-describedby`, `aria-invalid`), focus sur le premier champ en erreur, « Envoi en cours… », compteur en rouge au-delà de 5 000, `cle_envoi` en champ caché
- [x] `app/page.tsx` -- générer la `cle_envoi` (`crypto.randomUUID()`)
- [x] `app/confirmation/[jeton]/page.tsx`, `components/copier-reference.tsx` -- page de confirmation, page « plus disponible », bouton « Copier »
- [x] `tests/story-1-3/deposer.test.ts` -- base : valeurs par défaut, historique, référence au bon format, idempotence, 2 envois simultanés → 2 références, email normalisé, longueurs refusées, catégorie inactive refusée, `<script>` inerte, droits `EXECUTE`, `lire_confirmation` (valide, inconnu, plus de 24 h) ; nettoyage des données `TEST-`
- [x] `tests/story-1-3/schema-depot.test.ts`, `tests/story-1-3/codes-erreur.test.ts` -- règles Zod ; concordance des codes SQL et de `lib/erreurs.ts`
- [x] `tests/story-1-3/envoi.spec.ts` -- navigateur : envoi correct → confirmation (Copier → Copié, aucune donnée personnelle, « Déposer une autre demande ») ; 3 erreurs sous les champs avec saisie conservée ; parcours au clavier seul ; jeton inconnu ; axe sur la confirmation
- [x] `docs/carnet-ia.md` -- ligne de la story 1.3 (colonne d'Abraham à compléter)

**Acceptance Criteria :**
- Given la migration appliquée sur `nova-dev`, when Abraham suit les critères 1 à 4 de la story 1.3 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

- `npm run db:push -- --yes` a été refusé par les permissions de l'agent : la migration 20261103000003 n'est pas appliquée sur `nova-dev`. Elle a été exécutée en local sur PGlite (PostgreSQL embarqué) avec les migrations 1 et 2 : dépôt, idempotence, codes P0001, 10 000, emojis, `lire_confirmation` (valide, inconnu, expiré), historique non modifiable, droits — tout conforme. Les envois simultanés ne sont testables que sur `nova-dev`.
- Historique : `auteur_type` (`demandeur` | `membre`) + `auteur_id` (clé étrangère en 1.4) ; la ligne `creation` porte `nouvelle_valeur = 'formulaire'` (canal).
- Jeton : 64 caractères hexadécimaux tirés de deux `gen_random_uuid()` (pas de dépendance à pgcrypto).
- La confirmation n'affiche pas l'objet (liste du spec et maquette) : seulement référence et contact.
- Le formulaire valide d'abord à l'écran (même schéma Zod), puis appelle l'action dans une transition ; une coupure réseau devient le bandeau « Réessayer », qui renvoie la saisie (`requestSubmit`) sans la perdre. Redirection en `replace` : un retour arrière ne réaffiche pas le formulaire avec la même clé.
- Email : 254 caractères maximum (Zod et base), en plus des longueurs du spec.
- `supabase/seed.sql` non créé (prévu en story 1.5).
- **03/11/2026 — corrections après relecture :**
  - migration `20261103000004_droits_service_role.sql` : retire à `service_role` tout droit direct (lecture, écriture, `TRUNCATE`…) sur `demandes`, `historique`, `compteurs_reference`, `categories`, `parametres` et la séquence de l'historique ; les fonctions `SECURITY DEFINER` continuent de fonctionner. Test `tests/securite/droits-service-role.test.ts`. **À appliquer par Abraham (`npm run db:push`)** : ce test échoue tant que la migration n'est pas appliquée ;
  - messages de catégorie et de consentement : une seule source, `lib/erreurs.ts`, reprise par le schéma ;
  - caractère nul (U+0000) refusé par Zod avec un message sous le champ (évitait une erreur 22P05 et le bandeau « Le serveur ne répond pas » en boucle) ;
  - action `deposer` : une `cle_envoi` invalide renvoie tout de suite le bandeau, avant les erreurs de champ ;
  - compteur de description compté comme Zod (espaces de début et de fin retirés) ; sur `CATEGORIE_INVALIDE`, `router.refresh()` recharge la liste des catégories sans perdre la saisie, et la liste revient à « Choisissez une catégorie » ;
  - « Copier » : zone de copie de secours toujours retirée, et « Copie impossible » pendant 2 s en cas d'échec ;
  - tests : référence construite sur l'année de Paris ; second dépôt après « Déposer une autre demande » (autre adresse, autre référence) ; catégorie désactivée après l'affichage (ordinateur seulement) ; envois simultanés : on vérifie seulement que les références diffèrent ; contrainte CHECK testée sur un objet de 151 caractères.

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| `service_role` garde un accès direct aux tables ; historique effaçable en direct | medium | Corrigé (patch) : migration 0004, test `droits-service-role`. |
| Message de catégorie différent écran/serveur ; consentement en double | low | Corrigé (patch) : une seule source dans `lib/erreurs.ts`. |
| Catégorie désactivée pendant la saisie : liste périmée, utilisateur bloqué | medium | Corrigé (patch) : `router.refresh()`, message sous Catégorie ; test navigateur ajouté. |
| Erreurs de champ venant du serveur jamais testées à l'écran | medium | Corrigé (patch) : même test. |
| Second envoi après « Déposer une autre demande » non testé (clé neuve) | medium | Corrigé (patch) : test étendu. |
| Compteur non aligné sur Zod (espaces finaux) | low | Corrigé (patch). |
| Caractère NUL → erreur serveur en boucle | low | Corrigé (patch) : refus avec message. |
| Clé d'envoi falsifiée + erreurs de champ | low | Corrigé (patch) : erreur générale d'abord. |
| Zone de copie non retirée si erreur ; échec de copie muet | low | Corrigé (patch) : `finally`, « Copie impossible ». |
| Année 2026 en dur dans un test | low | Corrigé (patch) : année de Paris calculée. |
| Test « références consécutives » instable sur la base partagée | low | Corrigé (patch) : vérifie seulement qu'elles diffèrent. |
| Test de longueur qui insérait un email en majuscules | low | Corrigé (patch). |
| Test qui désactivait la vraie catégorie « Autre » | low | Corrigé (patch) : catégorie `TEST-` dédiée. |
| Focus clavier sans contour sur la confirmation | false | Badge de développement Next.js (`NEXTJS-PORTAL`) ; `devIndicators: false`. Absent en production. |
| `requestSubmit` absent sur Safari < 16 | low | Rejeté : navigateurs de plus de 3 ans. |
| Nom de marque en dur sur les pages de repli de la confirmation | low | Rejeté : cas rares ; à revoir si le nom change (story 5.3). |
| Page de confirmation sans mention d'expiration à 24 h | low | Rejeté : hors intention ; l'email (story 1.7) donne la référence. |
| Trois règles d'email différentes (Zod, fonction, CHECK) | low | Rejeté : Zod fait foi pour la saisie ; la base garde un contrôle minimal. |
| Violation d'unicité sur la référence (compteur désynchronisé) | low | Rejeté : compteur verrouillé, seule source des références. |
| Même clé rejouée après 24 h | low | Rejeté : clé neuve à chaque affichage. |
| Annonces `aria-live` en double | low | Rejeté : acceptable ; à revoir à l'audit d'accessibilité. |
| Prop `action` redondante | low | Rejeté : sans effet. |
| Double clic non testé à l'écran | medium | Reporté : idempotence testée en base, bouton désactivé. |
| Branche d'erreur de la confirmation non testée | medium | Reporté (proposé par le relecteur). |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 20261103000003 appliquée. **Si cette commande est refusée par les permissions, ne pas insister : le signaler, Abraham la lancera lui-même.**
- `npm run lint`, `npm run typecheck` -- aucune erreur
- `npm test` -- tous verts
- `npm run test:e2e` -- tous verts

**Manual checks :**
- Envoi d'une vraie demande dans l'aperçu, puis vérification de la page de confirmation.
- Ne rien commiter : Abraham vérifie d'abord à l'écran.
