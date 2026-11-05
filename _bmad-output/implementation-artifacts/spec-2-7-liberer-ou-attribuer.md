---
title: 'Story 2.7 — Libérer ou attribuer une demande'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '41ff1b9081cf0bac7ecda4d19060d50f6bffa40b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** une demande prise en charge reste bloquée si son responsable ne peut pas la traiter, et l'administrateur ne peut pas confier une demande à quelqu'un.

**Approach :**
- Deux fonctions SQL, `liberer` et `attribuer`, chacune en un bloc avec sa ligne d'historique.
- Dans le panneau d'actions du détail :
  - « Libérer » pour le responsable ou un administrateur, sur une demande En cours ;
  - « Attribuer à… » pour un administrateur, qui ouvre une fenêtre de choix du membre.

## Boundaries & Constraints

**Always :**
- **`liberer(p_demande_id)`** (`SECURITY DEFINER`, `search_path = ''`, membre actif en première instruction, ligne lue `FOR UPDATE`) :
  - demande En cours, appelant responsable **ou** administrateur → statut `nouvelle`, `responsable_id` null, une ligne `liberation` (auteur l'appelant, ancienne valeur = l'ancien responsable) ;
  - collaborateur non responsable → `DROIT_INSUFFISANT` ;
  - déjà Nouvelle sans responsable (double clic) → réussite, sans nouvelle ligne ;
  - Traitée → `PASSAGE_INTERDIT` ; inconnue → `DEMANDE_INTROUVABLE`.
- **`attribuer(p_demande_id, p_membre_id)`** (mêmes en-têtes) :
  - administrateur actif seulement (`DROIT_INSUFFISANT` sinon, vérifié en premier) ;
  - membre cible actif, sinon `MEMBRE_INVALIDE` (nouveau code, message « Ce membre n'est pas actif. ») ;
  - demande Nouvelle (avec ou sans responsable) ou En cours → statut `en_cours`, `responsable_id` = cible ; **une seule** ligne `attribution` (ancienne = ancien responsable ou null, nouvelle = cible) ;
  - cible déjà responsable d'une demande En cours → réussite, sans nouvelle ligne ;
  - Traitée → `PASSAGE_INTERDIT` ; inconnue → `DEMANDE_INTROUVABLE`.
- Les deux renvoient `{ id, statut, responsable_id }` ; `EXECUTE` à `authenticated` seulement.
- **Actions** `liberer` et `attribuer` dans `lib/actions/demandes.ts`, sur le modèle de `prendreEnCharge` : Zod (uuid), session du membre, `refresh()` après réussite ou `DROIT_INSUFFISANT`.
- **Écran** (panneau « Responsable » du détail, EXPERIENCE.md §9.5) :
  - « Libérer » (bouton secondaire, sans fenêtre de confirmation : l'action se défait) si la demande est En cours **et** (je suis le responsable **ou** administrateur). Toast « Demande libérée. Elle revient en Nouvelle. » ;
  - « Attribuer à… » si je suis administrateur **et** la demande n'est pas Traitée. Fenêtre (shadcn) : titre « Attribuer la demande », liste des membres **actifs** par nom, sans le responsable actuel, bouton « Attribuer » et « Annuler », focus gardé puis rendu, Échap ferme. Toast « Demande attribuée à [nom]. » ;
  - un collaborateur ne voit jamais « Attribuer à… », ni « Libérer » sur une demande dont il n'est pas responsable.
- **Historique** : « [auteur] a attribué la demande à [nom] » (phrase existante) ; « [auteur] a libéré la demande » (existante).

**Never :**
- Pas d'attribution à un membre désactivé ou en attente d'invitation.
- Pas de libération d'une demande Traitée (on la rouvre d'abord).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Libérer, responsable | En cours, moi responsable | Nouvelle, sans responsable, ligne `liberation` | — |
| Libérer, admin non responsable | En cours d'un autre | Idem | — |
| Libérer, collaborateur non responsable | Appel direct | Refusé, rien ne change | `DROIT_INSUFFISANT` |
| Attribuer une Nouvelle | Admin, cible collaborateur actif | En cours, cible responsable, une ligne `attribution` | — |
| Réattribuer | Admin, En cours d'un autre | Nouvelle cible responsable, une ligne | — |
| Attribuer, collaborateur | Appel direct | Refusé | `DROIT_INSUFFISANT` |
| Cible désactivée ou inconnue | Admin | Refusé | `MEMBRE_INVALIDE` |
| Demande Traitée | Libérer ou attribuer | Refusé | `PASSAGE_INTERDIT` |
| Double clic | Même appel deux fois | Une seule ligne d'historique | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261103000014_prendre_en_charge.sql` -- modèle exact (en-tête, `FOR UPDATE`, idempotence, retour, droits) ; `20261103000016_statuts.sql` (`rouvrir` : remise sans responsable). `prive.est_membre_actif()`, `prive.est_admin()`, `prive.ecrire_historique(demande, type, auteur, ancienne, nouvelle)`. Types `attribution` et `liberation` déjà autorisés dans `historique`.
- `lib/actions/demandes.ts` (`prendreEnCharge` : modèle d'action), `lib/schemas/traitement.ts` (schémas), `lib/erreurs.ts` (+ `MEMBRE_INVALIDE`, concordance testée).
- `lib/domaine.ts` -- `PHRASES_HISTORIQUE.attribution` / `.liberation` et `NATURE_VALEUR_HISTORIQUE` (`membre`) existent déjà : ne pas changer les phrases.
- `components/nova/actions-demande.tsx` -- `BoutonPrendreEnCharge`, `FenetreClasserSansSuite` (AlertDialog : modèle de fenêtre, focus, Échap), toasts via `components/nova/toasts.tsx`.
- `app/equipe/demandes/[reference]/page.tsx` (bloc `<Info libelle="Responsable">`) -- conditions d'affichage. Le rôle vient de `lib/session.ts` (`lireProfil`, `estAdmin`) ; `Profil` n'a pas d'identifiant : l'ajouter (`sub` des claims ou `mon_profil`) pour savoir si je suis responsable.
- `lib/options-filtres.ts` -- lecture des membres avec la session (`id, nom, etat`) : réutiliser pour la liste des membres actifs de la fenêtre.
- `tests/securite/*` -- listes des fonctions exécutables par rôle ; `tests/story-2-1/*` -- modèles de tests base, action, navigateur.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000022_liberer_attribuer.sql` -- fonctions, droits
- [x] `lib/erreurs.ts`, `lib/schemas/traitement.ts`, `lib/actions/demandes.ts` -- code, schémas, actions `liberer` et `attribuer`
- [x] `lib/session.ts` -- identifiant du membre dans le profil
- [x] `components/nova/actions-demande.tsx`, `app/equipe/demandes/[reference]/page.tsx` -- « Libérer », fenêtre « Attribuer à… »
- [x] `tests/story-2-7/liberer-attribuer.test.ts` -- base : matrice, historique, droits, concurrence
- [x] `tests/story-2-7/action.test.ts` -- actions et schémas
- [x] `tests/story-2-7/liberer-attribuer.spec.ts` -- navigateur : critères 1 à 4, axe ; ordinateur et téléphone
- [x] `tests/securite/*` -- listes mises à jour
- [x] `docs/carnet-ia.md` -- ligne de la story 2.7

**Acceptance Criteria :**
- Given la migration appliquée, when on suit les critères 1 à 4 de la story 2.7 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| `attribuer` vérifie le membre avant le statut : onglet périmé (Traitée + membre désactivé) → message faux, fenêtre ouverte | medium | Corrigé (patch, migration 0023) : statut vérifié avant le membre. |
| `liberer` renvoie une réussite à n'importe quel membre sur une Nouvelle sans responsable | medium | Corrigé (patch, 0023) : réussite idempotente seulement si l'appelant est administrateur ou l'auteur de la dernière libération ; sinon refus. |
| `MEMBRE_INVALIDE` : focus envoyé sur une liste encore désactivée | low | Corrigé (patch) : focus après la fin de l'envoi. |
| `lireMembresActifs` passe par `lireOptionsFiltres` (échec des catégories → attribution indisponible) ; type `MembreActif` défini dans un composant client et en double | low | Corrigé (patch) : requête dédiée sur `membres` actifs, type dans `lib/`. |
| Profil illisible : « Libérer » et « Attribuer à… » disparaissent sans message | low | Corrigé (patch) : état « indisponible ». |
| Refus attendu dans la fenêtre : focus perdu si la fenêtre disparaît au rafraîchissement | maybe-false | Corrigé (patch) : focus rendu directement, comme `BoutonLiberer` ; test ajouté. |
| Branches d'erreur de la fenêtre (membre désactivé, demande Traitée) non testées | medium | Corrigé (patch) : tests navigateur. |
| `lireProfil` : identifiant (`sub`) non testé | low | Corrigé (patch) : test unitaire. |
| `liberer` et `attribuer` simultanés non testés | low | Corrigé (patch) : test base. |
| Nouvelle avec responsable (liberer, filtre de la fenêtre) | false | Aucun chemin ne crée cet état (`rouvrir` retire le responsable, `prendre_en_charge` le refuse). |
| Historique sans le passage de statut | false | Voulu : une seule ligne par attribution ou libération (spec, phrases existantes). |
| Réponse `attribuer` avec un autre responsable que demandé | false | La fonction renvoie toujours `p_membre_id` après réussite. |
| Fenêtre vide quand le seul membre actif est le responsable | low | Rejeté : message « Aucun autre membre actif. » affiché ; cas rare. |
| Boutons voisins actifs pendant un envoi | low | Rejeté : la base tranche, toast clair. |
| Refus en double dans les actions ; code défensif SQL ; tests de droits EXECUTE en double | low | Rejetés : aucun tort nommé, ou défense voulue. |
| États « membres indisponibles » / « aucun membre » non testés | low | Reporté : pas de banc de test de composants (comme 2.2–2.6). |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0022 (développement seulement)
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Dans l'aperçu : libérer comme responsable ; attribuer puis réattribuer comme administrateur ; collaborateur sans « Attribuer à… ».
- Ne rien commiter avant la vérification à l'écran.
