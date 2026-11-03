---
title: 'Story 1.2 — Afficher le formulaire de dépôt'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'dd9bbf63d84f0f595cfa55eaf90200c1289d8dac'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** la page d'accueil est provisoire. Un client ne voit pas encore où ni comment déposer une demande, et la base ne contient ni les catégories ni les réglages (contact, durée de conservation) à afficher.

**Approach :** remplacer la page provisoire par le formulaire public « Déposer une demande » (EXPERIENCE.md §9.1, maquette `mockups/key-formulaire-public.html`), pensé téléphone d'abord. Ses catégories, le contact et la durée de conservation viennent de la base via une fonction `infos_publiques()` réservée au serveur. L'envoi réel de la demande arrive à la story 1.3.

## Boundaries & Constraints

**Always :**
- Champs, libellés et textes exacts d'EXPERIENCE.md §9.1 : Nom et prénom, Email, Téléphone (facultatif), Société (facultatif), Catégorie, Objet, Description avec compteur « 0 / 5 000 », mention d'information, case de consentement, bouton « Envoyer ma demande ».
- Tables `categories` et `parametres` créées **par migration**, avec leurs données de départ : les 5 catégories dans l'ordre du PRD, et le paramètre unique (nom « Nova Services », email `contact@nova-services.example`, durée 24 mois). RLS activée, aucun droit pour `anon` ni `authenticated` (AD-2).
- `infos_publiques()` : `SECURITY DEFINER`, `SET search_path = ''`, renvoie les catégories **actives** triées, ainsi que le nom, l'email de contact et la durée ; `EXECUTE` accordé à `service_role` seulement (AD-15). La page l'appelle côté serveur via `appeler()` et le client service. Le navigateur ne parle jamais à Supabase (AD-1).
- La durée affichée vient de la base : 24 mois → « 2 ans », 18 mois → « 18 mois ».
- Le bouton « Envoyer ma demande » est visible et stylé, mais **sans effet jusqu'à la story 1.3** (pas d'envoi, pas de rechargement).
- Bouton Nova enveloppant le bouton shadcn : coins 6 px, survol `--primary-hover`, pleine largeur sur téléphone (report de la story 1.1).
- La page n'est jamais mise en cache : les catégories changent.

**Never :**
- Pas de table `demandes`, pas d'action d'envoi, pas de validation Zod du formulaire (story 1.3).
- Pas de lien « Espace équipe » (story 1.4).
- Ne pas modifier les composants shadcn générés : les envelopper.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Affichage normal | Base avec 5 catégories actives | Formulaire complet, 5 catégories dans l'ordre, « conservées 2 ans », email de contact | — |
| Catégorie désactivée | `actif = false` sur une catégorie | Elle n'apparaît pas dans la liste | — |
| Durée non ronde | `duree_conservation_mois = 18` | « conservées 18 mois » | — |
| Base injoignable | `infos_publiques` en erreur | Bandeau « Le serveur ne répond pas. » + bouton « Réessayer » ; pas de formulaire vide trompeur | `ERREUR_INATTENDUE` |
| Visiteur sans serveur | Appel direct de `infos_publiques` avec la clé publiable | Refusé (pas de droit `EXECUTE`) | Erreur de permission |
| Saisie de la description | 12 caractères tapés | Compteur « 12 / 5 000 » | — |

</frozen-after-approval>

## Code Map

- `app/page.tsx` -- page provisoire de 1.1, à remplacer (page serveur).
- `app/layout.tsx`, `app/globals.css` -- Inter, couleurs, `--radius-md: 6px`, `--color-primary-hover` déjà définis ; ne pas changer les jetons.
- `components/ui/button.tsx` -- bouton shadcn généré (`rounded-lg`, `hover:bg-primary/80`) : **ne pas modifier**, l'envelopper.
- `lib/server/appeler.ts` -- `appeler<T>(client, fonction, params)` → `Resultat<T>` ; à réutiliser.
- `lib/server/supabase-service.ts` -- client clé secrète (`server-only`) ; à utiliser pour `infos_publiques`.
- `lib/erreurs.ts` -- `ERREUR_INATTENDUE` et son message « Le serveur ne répond pas… ».
- `supabase/migrations/20261103000001_verrouillage_droits.sql` -- droits par défaut retirés : toute nouvelle table et fonction démarre sans droit ; accorder `EXECUTE` explicitement à `service_role`.
- `tests/securite/droits-anon.test.ts` -- doit rester vert : aucun droit `anon`/`authenticated` sur les nouvelles tables et la fonction.
- `tests/story-1-1/page-provisoire.spec.ts` -- teste la page provisoire, qui disparaît : à remplacer par les tests 1.2.
- `scripts/db-push.mjs` -- `npm run db:push -- --yes` applique la migration sur `nova-dev`.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000002_categories_parametres.sql` -- tables `categories` (id uuid, nom unique, actif, ordre, cree_le) et `parametres` (une seule ligne : nom_affiche, email_contact en minuscules, duree_conservation_mois 6–60), RLS activée, données de départ, fonction `infos_publiques()` (catégories actives triées par ordre + paramètres), `EXECUTE` à `service_role` seul
- [x] `lib/infos-publiques.ts` (`server-only`) -- lit `infos_publiques` via `appeler()` et renvoie un objet typé
- [x] `lib/format.ts` -- ajouter `formaterDuree(mois)` : multiple de 12 → « N an(s) », sinon « N mois »
- [x] `components/nova/bouton.tsx` -- bouton principal Nova qui enveloppe le bouton shadcn (6 px, survol `primary-hover`, option pleine largeur)
- [x] `components/formulaire-depot.tsx` (client) -- champs, compteur de description, case de consentement, bouton sans effet ; reçoit catégories, contact et durée en props
- [x] `app/page.tsx` -- page serveur dynamique : en-tête « Nova Services », titre, sous-titre, formulaire, ou bandeau d'erreur avec « Réessayer » si la lecture échoue
- [x] `tests/story-1-2/infos-publiques.test.ts` -- avec la clé secrète : 5 catégories dans l'ordre et paramètres ; avec la clé publiable : appel refusé
- [x] `tests/story-1-2/format-duree.test.ts` -- 24 → « 2 ans », 12 → « 1 an », 18 → « 18 mois »
- [x] `tests/story-1-2/formulaire.spec.ts` -- remplace `page-provisoire.spec.ts` : champs et mentions « (facultatif) », 5 catégories, mention « conservées 2 ans » et email, case de consentement, compteur, une colonne sans défilement horizontal sur téléphone, bouton 6 px, axe sans violation
- [x] `tests/story-1-1/page-provisoire.spec.ts` -- supprimer (page remplacée)
- [x] `docs/carnet-ia.md` -- ligne de la story 1.2 (colonne d'Abraham à compléter après vérification)

**Acceptance Criteria :**
- Given la migration appliquée sur `nova-dev`, when on ouvre `/` sans être connecté, then les critères 1 à 4 de la story 1.2 d'`epics.md` sont visibles à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert, y compris `droits-anon`.

## Implementation Notes

- Composants shadcn ajoutés sans modification (`npx shadcn add input textarea label checkbox native-select`) ; leur apparence Nova (6 px, 44 px, fond blanc, 15 px) est posée par `className` depuis le formulaire. La catégorie utilise `native-select` (liste native, adaptée au téléphone) plutôt que le `Select` Radix.
- `lib/format.ts` reçoit aussi `formaterNombre` (« 5 000 », espace simple) pour le compteur.
- Pas de champ piège ni de lien « Espace équipe » (stories 1.8 et 1.4). Pas de `maxLength` sur la description : la limite sera validée en 1.3.
- `npm run db:push -- --yes` a été refusé par le garde-fou de permissions de l'agent : la migration 20261103000002 reste à appliquer par Abraham. Avant cela, la page affiche le bandeau « Le serveur ne répond pas. » (fonction absente, PGRST202) et 6 tests de `infos-publiques.test.ts` échouent.
- 2026-11-03 — Abraham a appliqué la migration 20261103000002 sur `nova-dev` ; `npm test` et `npm run test:e2e` sont verts. Les deux points précédents sur la migration non appliquée et les 6 tests en échec sont donc caducs.
- 2026-11-03 — Corrections après relecture : en-tête tiré de `nom_affiche`, bandeau avec le message de `lib/erreurs.ts`, titre de page « Déposer une demande — Nova Services », durée validée (entier de 6 à 60) avant affichage, compteur avec espace insécable, test Vitest du bandeau d'erreur (`page-erreur.test.tsx`, d'où `*.test.tsx` ajouté à `vitest.config.ts`), tests e2e de la police Inter et du survol `--primary-hover`.

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| En-tête « Nova Services » en dur alors que `nom_affiche` est lu | medium | Corrigé (patch) : l'en-tête affiche `nomAffiche`. |
| Durée hors bornes : `formaterDuree` peut planter la page | low | Corrigé (patch) : validation entier 6–60 dans `estReponseValide`. |
| Texte du bandeau en dur | low | Corrigé (patch) : affiche le message de `lib/erreurs.ts`. |
| Pas de titre de page | low | Corrigé (patch) : « Déposer une demande — Nova Services ». |
| Espace ordinaire dans « 5 000 » | low | Corrigé (patch) : espace insécable. |
| État d'erreur de la page jamais rendu par un test | medium | Corrigé (patch) : `page-erreur.test.tsx`. |
| Fabrique du client qui lève une exception non testée | low | Corrigé (patch) : cas ajouté. |
| `rollback` dans `finally` pouvant masquer l'erreur | low | Corrigé (patch). |
| Police Inter et survol du bouton plus testés | medium | Corrigé (patch) : assertions dans `formulaire.spec.ts`. |
| Notes d'implémentation contradictoires | low | Corrigé (patch) : note datée ajoutée. |
| `cn` importé depuis le paquet `cn` | false | Paquet officiel de shadcn, configuré dans `lib/utils.ts` ; typage et build verts. |
| Droits des nouvelles tables non testés | false | `droits-anon.test.ts` parcourt dynamiquement toutes les tables du schéma `public`. |
| Le test de la clé publiable accepte `PGRST202` | low | Rejeté : le test du catalogue (`has_function_privilege`) prouve l'absence de droit ; migration désormais appliquée. |
| Fichiers absents du diff (`carnet-ia.md`, lockfile) | false | Exclus volontairement du diff de relecture. |
| Bouton « Envoyer » sans effet visible | false | Voulu par l'intention : l'envoi arrive en story 1.3. |
| Catégories toutes désactivées → formulaire inutilisable | low | Rejeté : la story 5.2 interdit de désactiver la dernière catégorie active. |
| Compteur au-delà de 5 000 sans alerte ; emojis comptés en unités UTF-16 | medium | Reporté à la story 1.3 (règles de validation partagées écran/serveur). |
| `parametres.mis_a_jour_le` jamais mis à jour | low | Reporté à la story 5.3 (seule fonction qui modifie les paramètres). |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 20261103000002 appliquée sur `nova-dev`
- `npm run lint` et `npm run typecheck` -- aucune erreur
- `npm test` -- tous verts (dont `droits-anon` et `infos-publiques`)
- `npm run test:e2e` -- formulaire affiché, ordinateur et téléphone, axe sans violation

**Manual checks :**
- Aperçu de `/` sur ordinateur et en largeur téléphone : conforme à la maquette `mockups/key-formulaire-public.html` (sans le message d'erreur de consentement, qui arrive en 1.3).
- Ne pas initialiser de commit : Abraham vérifie d'abord à l'écran.
