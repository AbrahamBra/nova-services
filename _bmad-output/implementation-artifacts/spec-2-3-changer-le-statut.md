---
title: 'Story 2.3 — Marquer traitée, rouvrir, classer sans suite'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'ab57228c19e0c35bbdcc274a75e72cf7143a812a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** une demande prise en charge reste En cours pour toujours. On ne peut ni la terminer, ni la rouvrir, ni écarter un spam ou un doublon.

**Approach :**
- Une partie « Statut » dans le panneau d'actions du détail, avec seulement les passages permis par la règle 1 du PRD :
  - « Marquer comme traitée » (En cours) ;
  - « Rouvrir » (Traitée) ;
  - « Classer sans suite » (Nouvelle), qui ouvre une fenêtre avec une note obligatoire.
- Deux fonctions SQL, `changer_statut` et `classer_sans_suite`, font chaque changement en un bloc, avec son historique.

## Boundaries & Constraints

**Always :**
- **`changer_statut(p_demande_id uuid, p_statut text)`** (AD-4, AD-15) :
  - `SECURITY DEFINER`, `search_path = ''` ; membre actif en première instruction (`DROIT_INSUFFISANT`) ;
  - lit la demande verrouillée (`FOR UPDATE`) ; `DEMANDE_INTROUVABLE` si elle n'existe pas ;
  - passages permis : En cours → Traitée, et Traitée → En cours. Pour Traitée → En cours, le responsable est inchangé s'il est encore un membre actif ; sinon la demande revient en **Nouvelle sans responsable** (règle 1) ;
  - tout autre passage, y compris vers le même statut, donne `PASSAGE_INTERDIT` : Nouvelle → En cours passe seulement par la prise en charge, et En cours → Nouvelle seulement par « Libérer » ;
  - une ligne d'historique `changement_statut` (ancien → nouveau statut réel) ;
  - les dates sont écrites par le déclencheur existant (AD-22), jamais par la fonction.
- **`classer_sans_suite(p_demande_id uuid, p_note text)`** :
  - mêmes contrôles d'en-tête ;
  - seulement depuis Nouvelle (`PASSAGE_INTERDIT` sinon) ;
  - note obligatoire, avec les règles de la story 2.2 (1 à 2 000 caractères, au moins un caractère visible ; `DONNEES_INVALIDES` sinon) ;
  - en un bloc : statut Traitée sans responsable, la note dans `notes`, et **une seule** ligne d'historique `classement_sans_suite` (Nouvelle → Traitée), sans le texte de la note ;
  - `EXECUTE` à `authenticated` seulement, comme `changer_statut`.
- **Historique** (`lib/domaine.ts`) :
  - `changement_statut` : « [nom] a changé le statut : En cours → Traitée » (existant) ;
  - `classement_sans_suite` : « Classée sans suite par [nom] : Nouvelle → Traitée » (auteur au milieu de la phrase, comme la prise en charge) ;
  - les anciennes lignes sans valeurs restent lisibles.
- **Actions serveur** `changerStatut` et `classerSansSuite` dans `lib/actions/demandes.ts` : même modèle que `prendreEnCharge` et `ajouterNote` (session, Zod, `ResultatAction`, `refresh()`).
- **Panneau d'actions**, partie « Statut » sous le badge de statut :
  - seulement le bouton permis pour le statut affiché, pour tout membre actif ;
  - une fois l'action réussie, sans recharger la page : badge, historique et boutons à jour ;
  - toasts : « Demande marquée comme traitée. », « Demande rouverte. » (ou, si elle revient en Nouvelle : « Demande rouverte. Son responsable n'est plus actif : elle revient en Nouvelle. »), « Demande classée sans suite. » ;
  - erreur : toast rouge avec le message (`PASSAGE_INTERDIT` → « Ce changement de statut n'est pas autorisé. »), puis détail rafraîchi.
- **Fenêtre « Classer sans suite »** (UX-DR6, UX-DR9, EXPERIENCE.md §5) :
  - fenêtre modale, titre « Classer sans suite » ;
  - texte : « La demande passera à Traitée sans être traitée. Indiquez la raison (spam, doublon…) : elle sera ajoutée aux notes internes. » ;
  - zone libellée « Raison du classement », avec un compteur « N / 2 000 » ;
  - « Annuler » à gauche, avec le focus à l'ouverture ; bouton destructeur « Classer sans suite » à droite, qui affiche « Classement… » pendant l'envoi ;
  - raison vide : « Écrivez la raison du classement. » sous la zone, sans appel au serveur ;
  - focus gardé dans la fenêtre, Échap ferme, focus rendu au bouton d'origine ;
  - fermée après une réussite ; saisie conservée en cas d'erreur.
- La liste des demandes montre le nouveau statut (elle lit la base : aucun changement attendu).

**Never :**
- Pas de « Libérer » ni d'« Attribuer à… » (stories suivantes).
- Aucune écriture directe de `traitee_le` ou `mis_a_jour_le`.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Traitée | En cours → « Marquer comme traitée » | Badge vert Traitée, historique « … a changé le statut : En cours → Traitée », `traitee_le` rempli | — |
| Rouvrir | Traitée, responsable actif | En cours, même responsable, historique Traitée → En cours | — |
| Rouvrir, responsable inactif | Traitée, responsable désactivé | Nouvelle sans responsable, historique Traitée → Nouvelle, toast dédié | — |
| Classer sans suite | Nouvelle + raison | Traitée sans responsable, note visible, une ligne « Classée sans suite par … » | — |
| Raison vide | Fenêtre, zone vide | « Écrivez la raison du classement. », rien d'envoyé | — |
| Passage interdit | Appel direct : Nouvelle → Traitée par `changer_statut`, En cours → Nouvelle, même statut, classer une demande En cours | Rien ne change | `PASSAGE_INTERDIT` |
| Statut inconnu | `p_statut = 'fermee'` | Rien ne change | `PASSAGE_INTERDIT` |
| Double clic ou onglet périmé | Statut déjà changé ailleurs | Toast d'erreur, détail rafraîchi | `PASSAGE_INTERDIT` |
| Boutons | Chaque statut | Seul le passage permis est proposé | — |
| Membre désactivé ou visiteur | Appel direct | Refusé | `DROIT_INSUFFISANT` / droit refusé |

</frozen-after-approval>

## Code Map

- `components/nova/actions-demande.tsx` -- `BoutonPrendreEnCharge` : modèle (garde « en vol », `useTransition`, toasts). Y ajouter les boutons de statut et la fenêtre.
- `components/nova/notes.tsx` -- modèle de la zone de texte avec compteur et message sous le champ.
- `app/equipe/demandes/[reference]/page.tsx` -- colonne `aside` : Responsable (avec « Prendre en charge »), Statut, Priorité, Catégorie ; la partie Statut reçoit ses boutons.
- `lib/actions/demandes.ts` (`prendreEnCharge`, `ajouterNote`), `lib/schemas/traitement.ts` (`schemaTexteNote`, à réutiliser pour la raison), `lib/server/appeler.ts` (`ResultatAction`).
- `lib/domaine.ts` (`PHRASES_HISTORIQUE`, `AVANT_AUTEUR_HISTORIQUE`, `TYPES_PASSAGE_OMIS_SI_INCONNU`, libellés de statut), `components/nova/historique.tsx`.
- `supabase/migrations/20261103000003_demandes.sql` -- déclencheur des dates (l.91-116) : ne pas toucher ; `20261103000014_prendre_en_charge.sql` -- modèle de fonction (lecture verrouillée, codes) ; `20261103000015_notes.sql` -- règle du texte d'une note (classe d'espaces Unicode, à réutiliser à l'identique).
- `radix-ui` (déjà installé) -- base possible de la fenêtre (Dialog : focus gardé, Échap) ; ajouter `components/ui/dialog.tsx` au besoin.
- `tests/securite/*`, `tests/outils/*` -- droits attendus ; données `TEST-` (préfixe `TEST-<étiquette sans tiret>-<8 hex>`).

## Tasks & Acceptance

**Execution :**
- [ ] `supabase/migrations/20261103000016_statuts.sql` -- `changer_statut`, `classer_sans_suite`, droits
- [ ] `lib/schemas/traitement.ts`, `lib/actions/demandes.ts` -- actions `changerStatut`, `classerSansSuite`
- [ ] `lib/domaine.ts` -- phrase de classement sans suite
- [ ] `components/ui/dialog.tsx` (si besoin), `components/nova/actions-demande.tsx`, `app/equipe/demandes/[reference]/page.tsx` -- boutons de statut et fenêtre
- [ ] `tests/story-2-3/statuts.test.ts` -- base : tous les cas de la matrice, dates par le déclencheur, une seule ligne d'historique, note du classement, droits
- [ ] `tests/story-2-3/action.test.ts` -- actions, schéma, phrases
- [ ] `tests/story-2-3/statuts.spec.ts` -- navigateur : critères 1 à 4, fenêtre (focus, Échap, raison vide), axe ; ordinateur et téléphone
- [ ] `tests/securite/*` -- listes mises à jour
- [ ] `docs/carnet-ia.md` -- ligne de la story 2.3

**Acceptance Criteria :**
- Given la migration appliquée, when on suit les critères 1 à 4 de la story 2.3 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Rouvrir une demande classée sans suite affiche « Son responsable n'est plus actif » alors qu'elle n'en a jamais eu | medium | Corrigé (patch) : message dédié, testé. |
| Focus perdu sur `<body>` après chaque changement de statut (bouton démonté) | medium | Corrigé (patch) : focus placé sur la partie Statut. |
| Refus attendu pendant que la fenêtre est ouverte : `refresh()` la démonte, erreur et focus perdus | medium | Corrigé (patch) : fenêtre fermée et toast rouge pour ces refus. |
| Erreur serveur affichée sous la raison avec `aria-invalid` (et en double) | low | Corrigé (patch) : message sous le champ réservé aux erreurs de saisie. |
| Règle du texte d'une note recopiée trois fois ; caractères invisibles bruts dans le SQL et les tests | medium | Corrigé (patch) : `prive.texte_note_valide`, échappements `\uXXXX`. |
| Calcul du texte avant le contrôle du membre (AD-15) | low | Corrigé (patch). |
| Prédicat de statut des UPDATE non vérifié ; désactivation simultanée du responsable | low | Corrigé (patch) : nombre de lignes vérifié, `for share`. |
| `default: return null` sans contrôle d'exhaustivité ; paramètre mal nommé | low | Corrigé (patch). |
| Liste des droits de `service_role` peut-être incomplète | low | Corrigé (patch) si la liste existe. |
| Réseau coupé sur les boutons de statut, toast de la fenêtre, raison trop longue : non testés à l'écran | medium | Corrigé (patch) : tests navigateur ajoutés. |
| Fenêtre sans test de composant (Vitest) | low | Reporté : même besoin que la story 2.2 (montage de composant client absent). |
| Test « onglet périmé » qui change le statut par SQL direct | low | Rejeté : simule un autre onglet ; le test vérifie bien le refus et l'historique. |
| Boutons secondaires et destructeur stylés à la main | low | Rejeté : pas de défaut visible ; une variante de `Bouton` pourra venir avec l'epic 2. |
| Carnet et spec absents du diff | false | Exclus volontairement du diff de relecture. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0016. **Si refusée par les permissions, le signaler : la session principale la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Dans l'aperçu : marquer traitée, rouvrir, classer sans suite (raison vide refusée).
- Ne rien commiter avant la vérification à l'écran.
