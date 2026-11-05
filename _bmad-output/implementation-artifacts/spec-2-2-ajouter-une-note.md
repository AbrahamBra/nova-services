---
title: 'Story 2.2 — Ajouter une note interne'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '3d2488c8a489d19433023571dd1004273413b07b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/mockups/key-detail-demande.html'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** l'équipe n'a aucun endroit où noter ce qui a été fait ou dit sur une demande.

**Approach :**
- Ajouter un bloc « Notes internes » au détail, entre « Demandeur » et « Historique ».
- Ce bloc contient la liste des notes (auteur, date et heure), une zone de texte et un bouton « Ajouter la note ».
- La fonction SQL `ajouter_note` enregistre la note et la ligne d'historique en un bloc.
- Une note ne se modifie jamais et ne se supprime jamais (AD-5).

## Boundaries & Constraints

**Always :**
- **Table `notes`** (AD-5) :
  - colonnes : demande, auteur (membre), texte, date ; RLS activée ;
  - lecture par colonne pour les membres actifs (`prive.est_membre_actif()`), comme `historique` en 1.6 ;
  - aucun droit d'écriture direct, pour personne ;
  - un déclencheur refuse UPDATE, DELETE et TRUNCATE, comme pour le journal en 1.7. Seule exception : la suppression en cascade avec la demande, prévue pour l'effacement complet (epic 5).
- **Fonction `ajouter_note(p_demande_id uuid, p_texte text)`** (AD-4, AD-15) :
  - `SECURITY DEFINER`, `search_path = ''` ;
  - en première instruction, membre actif, sinon `DROIT_INSUFFISANT` ;
  - demande inconnue : `DEMANDE_INTROUVABLE` ;
  - texte sans espaces en début et en fin, entre 1 et 2 000 caractères, sinon `DONNEES_INVALIDES` ;
  - possible quel que soit le statut ;
  - écrit la note et une ligne d'historique `note_ajoutee`, auteur membre, **sans le texte** (AD-19) ;
  - `EXECUTE` à `authenticated` seulement.
- **Action serveur `ajouterNote`** dans `lib/actions/demandes.ts` :
  - même modèle que `prendreEnCharge` (session du membre, `appeler`, `ResultatAction` sans `detail`, `refresh()` comme en 2.1) ;
  - un schéma Zod unique pour l'écran et l'action (AD-8).
- **Bloc Notes** (maquette `key-detail-demande.html`, EXPERIENCE.md §9.5) :
  - les notes, de la plus ancienne à la plus récente ; pour chacune, « Karim Benali · 03/11/2026 à 09:16 » (heure de Paris), puis le texte tel que saisi, retours à la ligne conservés, aucun HTML interprété ;
  - sans note : « Aucune note interne. » ;
  - zone de texte libellée « Ajouter une note (visible uniquement par l'équipe) », avec un compteur « N / 2 000 » ;
  - pendant l'envoi : bouton désactivé « Ajout… » ;
  - réussite : toast « Note ajoutée. », zone vidée, note et ligne « [nom] a ajouté une note interne » visibles sans recharger la page ;
  - texte vide ou fait seulement d'espaces : message sous la zone, « Écrivez le texte de la note. », avec focus sur la zone et sans appel au serveur ;
  - autres erreurs : toast rouge (composant de la story 2.1), texte conservé.
- La lecture du détail (`lib/detail-demande.ts`) ajoute les notes et le nom de leurs auteurs, avec la session.
- Données d'essai (`supabase/essai/demandes-essai.sql`) : quelques notes, avec leur ligne d'historique.

**Never :**
- Aucune modification ni suppression de note, ni à l'écran ni dans la base.
- Pas encore le classement sans suite avec note obligatoire (story 2.3).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Note ajoutée | Texte « Rappelée à 9 h » | Note avec nom, date et heure ; toast « Note ajoutée. » ; ligne d'historique sans le texte | — |
| Zone vide | Vide ou espaces seulement | « Écrivez le texte de la note. », rien d'envoyé | — |
| Trop longue | Plus de 2 000 caractères (appel direct) | Refusée | `DONNEES_INVALIDES` |
| Sans note | Demande sans note | « Aucune note interne. » | — |
| Texte piégé | `<script>` et retours à la ligne | Affiché tel quel, aucun script exécuté | — |
| Demande Traitée | Note sur une demande Traitée | Acceptée | — |
| Modification | UPDATE, DELETE ou TRUNCATE direct sur `notes` | Refusé | droit refusé / déclencheur |
| Membre désactivé ou visiteur | Appel direct ou lecture de `notes` | Refusé, rien de lisible | `DROIT_INSUFFISANT` / droit refusé |
| Demande inconnue | Identifiant inconnu | Rien d'enregistré | `DEMANDE_INTROUVABLE` |

</frozen-after-approval>

## Code Map

- `app/equipe/demandes/[reference]/page.tsx` -- détail : y placer le bloc Notes (carte `Carte`), entre Demandeur et Historique.
- `components/nova/actions-demande.tsx` -- modèle du bouton client de la 2.1 (garde « en vol », toasts, `useTransition`).
- `components/nova/toasts.tsx` -- `afficher` (réussite / erreur) ; ne pas modifier.
- `lib/actions/demandes.ts` (`prendreEnCharge`), `lib/schemas/traitement.ts`, `lib/server/appeler.ts` (`ResultatAction`) -- modèle de l'action.
- `lib/detail-demande.ts` -- lecture du détail et de l'historique, et noms des membres cités : y ajouter les notes.
- `lib/domaine.ts` (`note_ajoutee` : phrase déjà prévue), `components/nova/historique.tsx`, `lib/format.ts` (dates à l'heure de Paris).
- `components/formulaire-depot.tsx` -- modèle du compteur de caractères et du message sous un champ.
- `supabase/migrations/20261103000008_lecture_historique.sql` -- modèle de la RLS et des droits par colonne ; `20261103000009_emails_journal.sql` et `20261103000010_*` -- modèle du déclencheur d'ajout seulement ; `20261103000014_prendre_en_charge.sql` -- modèle de la fonction.
- `tests/securite/*` -- droits attendus (table `notes`, `ajouter_note`).
- `tests/outils/comptes.ts`, `tests/outils/demandes.ts` (préfixe au format `TEST-<étiquette>-<8 hex>`) -- données jetables.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000015_notes.sql` -- table, RLS, droits, déclencheur, fonction
- [x] `lib/schemas/traitement.ts`, `lib/actions/demandes.ts` -- schéma et action `ajouterNote`
- [x] `lib/detail-demande.ts` -- lecture des notes
- [x] `components/nova/notes.tsx`, `app/equipe/demandes/[reference]/page.tsx` -- bloc Notes
- [x] `supabase/essai/demandes-essai.sql` -- notes d'essai
- [x] `tests/story-2-2/notes.test.ts` -- base : cas de la matrice, ajout seulement, historique sans le texte, droits
- [x] `tests/story-2-2/action.test.ts` -- action et schéma
- [x] `tests/story-2-2/notes.spec.ts` -- navigateur : critères 1 à 3, texte piégé, axe ; ordinateur et téléphone
- [x] `tests/securite/*` -- listes mises à jour
- [x] `docs/carnet-ia.md` -- ligne de la story 2.2

**Acceptance Criteria :**
- Given la migration appliquée, when on suit les critères 1 à 3 de la story 2.2 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Note faite seulement d'espaces Unicode acceptée par appel direct | low | Corrigé (patch) : au moins un caractère visible exigé par la base. |
| Texte tapé pendant l'envoi effacé sans être enregistré | medium | Corrigé (patch) : zone en lecture seule pendant l'envoi. |
| Dépassement de 2 000 caractères signalé par la couleur seulement (WCAG 1.4.1) | low | Corrigé (patch) : message sous la zone dès le dépassement, zone annoncée. |
| `DONNEES_INVALIDES` de la base affiché en toast générique | low | Corrigé (patch) : message sous la zone. |
| Lectures des notes et de l'historique l'une après l'autre | low | Corrigé (patch) : en parallèle. |
| `lireNote`, garde anti-double clic, dépassement à l'écran non testés ; test 1.6 des boutons affaibli | medium | Corrigé (patch) : tests ajoutés, comptage strict des boutons. |
| Date d'une note non lisible par machine | low | Corrigé (patch) : `<time>`. |
| `TRUNCATE demandes CASCADE` bloqué sans le dire | low | Corrigé (patch) : documenté dans la migration. |
| Refus du serveur (`ok: false`) du formulaire de note non testé à l'écran | medium | Reporté : demande un montage de test de composant client absent du projet. |
| Membre auteur d'une note impossible à supprimer ; pas d'index sur l'auteur | low | Rejeté : un membre se désactive, il ne se supprime pas (règle 7 du PRD) ; même règle que `historique`. |
| Nombre de notes illimité au chargement | low | Rejeté : quelques notes par demande ; à mesurer avec NFR-7 (story 2.5). |
| Échec de lecture des notes : page entière en erreur | low | Rejeté : même comportement que l'historique, bandeau « Réessayer ». |
| Message du déclencheur sans code | low | Rejeté : aucun droit d'écriture direct, jamais atteint par une action. |
| Caractère UTF-16 isolé collé | low | Rejeté : cas improbable, refusé par le serveur sans dommage. |
| Carnet et spec absents du diff | false | Exclus volontairement du diff de relecture ; la ligne du carnet existe. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0015. **Si refusée par les permissions, le signaler : Abraham la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Ajouter une note dans l'aperçu ; zone vide refusée.
- Ne rien commiter avant la vérification à l'écran.
