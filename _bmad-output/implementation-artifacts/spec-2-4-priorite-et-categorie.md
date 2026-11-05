---
title: 'Story 2.4 — Fixer la priorité et corriger la catégorie'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '4f3e124a5a95522ea64632a900bb34d2cf6043f5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** la priorité reste « Normale » pour toujours, et une catégorie mal choisie par le demandeur ne peut pas être corrigée.

**Approach :**
- Dans le panneau d'actions du détail, la Priorité et la Catégorie deviennent des listes modifiables. Le choix d'une valeur l'enregistre aussitôt.
- Les fonctions SQL `changer_priorite` et `changer_categorie` enregistrent le changement en un bloc, avec une ligne d'historique (ancienne → nouvelle valeur).

## Boundaries & Constraints

**Always :**
- **Fonctions SQL `changer_priorite(p_demande_id uuid, p_priorite text)` et `changer_categorie(p_demande_id uuid, p_categorie_id uuid)`** (AD-4, AD-15, AD-18) :
  - `SECURITY DEFINER`, `search_path = ''` ; membre actif en première instruction (`DROIT_INSUFFISANT`) ;
  - lisent la demande verrouillée (`FOR UPDATE`) ; `DEMANDE_INTROUVABLE` si elle n'existe pas ;
  - permises **quel que soit le statut** (règle 3 du PRD) ;
  - priorité : seulement `basse`, `normale`, `haute` (`DONNEES_INVALIDES` sinon) ;
  - catégorie : seulement une catégorie **active** existante (`CATEGORIE_INVALIDE` sinon). Une demande dont la catégorie a été désactivée la garde tant qu'on ne la change pas (règle 9) ;
  - même valeur qu'avant : succès sans modification ni ligne d'historique ;
  - sinon, une ligne d'historique `changement_priorite` (codes) ou `changement_categorie` (identifiants, AD-19) ;
  - `mis_a_jour_le` est écrit par le déclencheur existant (AD-22) ;
  - `EXECUTE` à `authenticated` seulement.
- **Actions serveur** `changerPriorite` et `changerCategorie` dans `lib/actions/demandes.ts`, sur le modèle des actions des stories 2.1 à 2.3 (session, Zod, `ResultatAction`, `refresh()`, focus géré).
- **Panneau d'actions** (EXPERIENCE.md §9.5 : « Priorité : liste Basse / Normale / Haute » ; « Catégorie : modifiable par l'équipe ») :
  - **Priorité** : liste déroulante libellée « Priorité » (Basse, Normale, Haute), valeur actuelle choisie, sous le badge actuel ;
  - **Catégorie** : liste déroulante libellée « Catégorie » avec les catégories actives, dans l'ordre des formulaires. Si la catégorie actuelle est désactivée, elle apparaît en tête, choisie et suivie de « (désactivée) », mais elle n'est pas proposée comme nouvelle valeur ;
  - un changement de valeur envoie aussitôt l'action ; la liste est désactivée pendant l'envoi ;
  - réussite : toast « Priorité modifiée : Haute. » ou « Catégorie modifiée : Problème technique. » ; badge, historique et liste mis à jour sans recharger la page ;
  - erreur : toast rouge, valeur précédente remise dans la liste, détail rafraîchi.
- **Historique** : « [nom] a changé la priorité : Normale → Haute » et « [nom] a changé la catégorie : Demande d'information → Problème technique ». Les catégories s'affichent avec leur **nom actuel** (règle 9) ; c'est déjà le cas dans `lib/detail-demande.ts`, à vérifier.
- La liste des demandes affiche la nouvelle priorité et la nouvelle catégorie (elle lit la base).

**Never :**
- Pas de gestion des catégories (ajout, renommage, désactivation : epic 5).
- Pas de priorité choisie par le demandeur (règle 5).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Priorité Haute | Normale → Haute | Badge rouge « Haute » dans le détail et la liste ; ligne « Normale → Haute » | — |
| Catégorie corrigée | Information → Problème technique | Nouvelle catégorie dans le détail et la liste ; ligne d'historique avec les deux noms | — |
| Même valeur | Haute → Haute (appel direct) | Rien ne change, aucune ligne | — |
| Priorité inconnue | `urgente` (appel direct) | Refusée | `DONNEES_INVALIDES` |
| Catégorie désactivée ou inconnue | Appel direct | Refusée | `CATEGORIE_INVALIDE` |
| Catégorie actuelle désactivée | Demande d'une catégorie désactivée | Affichée « (désactivée) » et choisie ; les autres catégories actives sont proposées | — |
| Demande Traitée | Changement de priorité | Accepté | — |
| Catégorie renommée | Ancienne ligne d'historique | Nom actuel affiché | — |
| Membre désactivé ou visiteur | Appel direct | Refusé | `DROIT_INSUFFISANT` / droit refusé |
| Erreur réseau | Pendant l'envoi | Toast rouge, valeur précédente remise | `ERREUR_INATTENDUE` |

</frozen-after-approval>

## Code Map

- `app/equipe/demandes/[reference]/page.tsx` (l.215-218 : Info Priorité, Info Catégorie) -- y placer les deux listes ; la page doit aussi lire les catégories actives (comme le formulaire public).
- `components/nova/actions-demande.tsx` -- modèle des actions (garde « en vol », toasts, focus sur la zone après succès) ; y ajouter `ChoixPriorite` et `ChoixCategorie`.
- `components/ui/native-select.tsx`, `components/formulaire-depot.tsx` -- liste déroulante native et lecture des catégories actives (ordre `ordre`).
- `lib/actions/demandes.ts`, `lib/schemas/traitement.ts`, `lib/server/appeler.ts` -- modèle des actions et schémas.
- `lib/domaine.ts` (`PRIORITES`, libellés, `changement_priorite` / `changement_categorie` : phrases et natures déjà prévues), `lib/detail-demande.ts` (noms des catégories citées, l.196-214), `components/nova/badges.tsx`.
- `supabase/migrations/20261103000016_statuts.sql` -- modèle de fonction (lecture verrouillée, `ROW_COUNT`) ; `20261103000002_categories_parametres.sql` -- table `categories` (`actif`, `ordre`).
- `tests/securite/*`, `tests/outils/*` -- droits ; données `TEST-` (préfixe `TEST-<étiquette sans tiret>-<8 hex>`). Les tests ne désactivent jamais une catégorie partagée : créer une catégorie `TEST-` jetable pour le cas « désactivée ».

## Tasks & Acceptance

**Execution :**
- [ ] `supabase/migrations/20261103000017_priorite_categorie.sql` -- deux fonctions, droits
- [ ] `lib/schemas/traitement.ts`, `lib/actions/demandes.ts` -- deux actions
- [ ] `components/nova/actions-demande.tsx`, `app/equipe/demandes/[reference]/page.tsx` -- deux listes
- [ ] `tests/story-2-4/priorite-categorie.test.ts` -- base : cas de la matrice, historique, droits
- [ ] `tests/story-2-4/action.test.ts` -- actions et schémas
- [ ] `tests/story-2-4/priorite-categorie.spec.ts` -- navigateur : critères 1 à 3 (détail et liste), erreur réseau, axe ; ordinateur et téléphone
- [ ] `tests/securite/*` -- listes mises à jour
- [ ] `docs/carnet-ia.md` -- ligne de la story 2.4

**Acceptance Criteria :**
- Given la migration appliquée, when on suit les critères 1 à 3 de la story 2.4 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Page d'équipe lisant les catégories avec la clé secrète ; lecture même si la demande est introuvable ; commentaires périmés | medium | Corrigé (patch) : catégories lues avec la session (droit de lecture de `ordre` pour les membres actifs). |
| Catégorie actuelle dite « (désactivée) » par déduction ; liste vide ou nom manquant | medium | Corrigé (patch) : vrai drapeau `actif`, repli « Liste des catégories indisponible. », test de page. |
| Valeur en attente jamais effacée ; pas de `key` par demande | medium | Corrigé (patch). |
| Toast « modifiée » alors que rien n'a changé (`modifiee: false`) | low | Corrigé (patch). |
| Erreur inattendue ou réponse perdue : ancienne valeur remise sans vérifier | low | Corrigé (patch) : page rafraîchie pour montrer la vraie valeur. |
| Libellés doublés pour les lecteurs d'écran | low | Corrigé (patch) : `aria-labelledby`. |
| Priorité validée après le verrou | low | Corrigé (patch). |
| Historique inversé pour deux changements simultanés (`now()` de transaction) | low | Corrigé (patch) : `clock_timestamp()` dans `prive.ecrire_historique`, testé. |
| Tests : ordre des catégories, garde « 2 catégories », `changerCategorie`, refus attendu, erreur réseau sur la catégorie, demande Traitée, double changement | medium | Corrigé (patch) : tests ajoutés. |
| Verrou `for share` contre une désactivation simultanée non testé | low | Reporté : demande deux transactions coordonnées ; la règle est testée en séquence. |
| Liste des priorités répétée (SQL, CHECK, `lib/domaine.ts`) | low | Rejeté : codes fermés de l'AD-18, recopiés volontairement et vérifiés par les tests. |
| Carnet et spec absents du diff | false | Exclus volontairement du diff de relecture. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0017. **Si refusée par les permissions, le signaler : la session principale la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Dans l'aperçu : priorité Haute et catégorie corrigée, visibles dans le détail, la liste et l'historique.
- Ne rien commiter avant la vérification à l'écran.
