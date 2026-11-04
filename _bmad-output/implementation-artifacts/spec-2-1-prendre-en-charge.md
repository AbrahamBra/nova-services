---
title: 'Story 2.1 — Prendre en charge une demande'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '0ec93658f04f81b1d93b9f413cc4e8c4bb306876'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** le détail d'une demande est en lecture seule. Personne ne peut dire « je m'en occupe », et deux membres risquent de traiter la même demande.

**Approach :**
- Un bouton « Prendre en charge » dans un panneau d'actions du détail, à droite (en dessous sur téléphone).
- Il appelle la fonction SQL `prendre_en_charge`. En un seul bloc, elle rend le membre responsable, passe la demande En cours et écrit une ligne d'historique.
- Un message bref (toast) confirme l'action ou donne la raison du refus.

## Boundaries & Constraints

**Always :**
- **Fonction SQL `prendre_en_charge(p_demande_id uuid)`** (AD-4, AD-15) :
  - `SECURITY DEFINER`, `search_path = ''` ;
  - en première instruction, membre actif (`prive.est_membre_actif()`), sinon `DROIT_INSUFFISANT` ;
  - **modification conditionnelle** : `statut = 'nouvelle'` et sans responsable → `en_cours`, `responsable_id` = le membre, `mis_a_jour_le = now()` ;
  - si rien n'est modifié :
    - demande introuvable : `DEMANDE_INTROUVABLE` ;
    - demande déjà En cours : `DEJA_PRISE`, avec le nom du responsable dans le détail JSON de l'erreur (AD-20) ;
    - demande Traitée : `PASSAGE_INTERDIT` ;
  - **une seule** ligne d'historique : `prise_en_charge`, auteur membre, `nouvelle` → `en_cours` (règle 6 du PRD) ;
  - `EXECUTE` à `authenticated` seulement.
- **Action serveur** `prendreEnCharge` dans `lib/actions/demandes.ts` : avec la **session** du membre (jamais la clé secrète), via `appeler`. Elle renvoie le résultat typé (AD-7) et rafraîchit le détail.
- **Panneau d'actions** (EXPERIENCE.md §5, §9.5) :
  - « Prendre en charge » seulement si la demande est Nouvelle, pour tout membre actif (collaborateur ou administrateur) ;
  - bouton désactivé pendant l'envoi (« Prise en charge… ») ;
  - après la réussite, sans recharger la page : le responsable affiché devient le membre, le badge passe à En cours, la ligne « Prise en charge par [nom] : Nouvelle → En cours » s'ajoute à l'historique, et le bouton disparaît.
- **Toasts** : un composant unique, réutilisable par toutes les actions de l'epic 2.
  - Message court en bas à droite (en haut sur téléphone), annoncé aux lecteurs d'écran.
  - Une réussite disparaît après 5 secondes ; une erreur reste jusqu'à ce qu'on la ferme.
  - Réussite : « Vous êtes responsable de cette demande. ».
  - `DEJA_PRISE` : « Déjà prise en charge par [nom]. », puis le détail est rafraîchi pour montrer le vrai responsable.
  - Autres erreurs : message de `lib/erreurs.ts`.
- **Historique** : la phrase de `prise_en_charge` dans `lib/domaine.ts` devient « Prise en charge par [nom] : Nouvelle → En cours » (statuts traduits en libellés).
- Codes `DEJA_PRISE`, `PASSAGE_INTERDIT`, `DROIT_INSUFFISANT` dans `lib/erreurs.ts`, s'ils manquent, avec le test de concordance.

**Never :**
- Pas d'attribution, de libération ni de changement de statut (stories suivantes).
- Aucun client Supabase dans le navigateur.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Prise en charge | Demande Nouvelle, membre actif | En cours, responsable = membre, une ligne d'historique, toast de réussite | — |
| Déjà prise | Demande En cours (prise par Karim) | Toast « Déjà prise en charge par Karim Benali. », détail rafraîchi | `DEJA_PRISE` |
| Simultanée | Deux membres en même temps | Un seul responsable, une seule ligne d'historique | `DEJA_PRISE` pour l'autre |
| Traitée | Appel direct sur une demande Traitée | Rien ne change | `PASSAGE_INTERDIT` |
| Introuvable | Identifiant inconnu | Rien ne change | `DEMANDE_INTROUVABLE` |
| Membre désactivé ou visiteur | Appel direct | Refusé | `DROIT_INSUFFISANT` / droit refusé |
| Bouton | Demande En cours ou Traitée | Pas de bouton « Prendre en charge » | — |
| Base injoignable | Erreur pendant l'appel | Toast d'erreur, rien ne change à l'écran | `ERREUR_INATTENDUE` |

</frozen-after-approval>

## Code Map

- `app/equipe/demandes/[reference]/page.tsx` -- détail (story 1.6) : la colonne `aside` (l.182-196) affiche Responsable, Statut, Priorité, Catégorie ; y placer le panneau d'actions. La lecture se fait avec la session, via `lib/detail-demande.ts`.
- `lib/detail-demande.ts` -- lecture du détail et de l'historique, et noms des membres cités ; à réutiliser, sans rien changer à la lecture.
- `components/nova/historique.tsx`, `lib/domaine.ts` (l.75-165 : types, auteurs et phrases de l'historique) -- seule la phrase de `prise_en_charge` change.
- `components/nova/badges.tsx`, `components/nova/bouton.tsx`, `components/ui/button.tsx` -- badges et bouton existants.
- `lib/actions/demandes.ts` -- actions sur les demandes ; y ajouter la partie traitement. Modèle de session : `lib/actions/comptes.ts` (`creerClientServeur`).
- `lib/server/appeler.ts` -- `appeler` et `Resultat` ; vérifier comment lire le détail JSON d'une erreur P0001 (nom du responsable), et l'étendre au minimum si besoin.
- `lib/erreurs.ts`, `tests/story-1-3/codes-erreur.test.ts` -- codes et concordance.
- `supabase/migrations/20261103000003_demandes.sql` (table `demandes`, `prive.ecrire_historique`), `20261103000005_membres.sql` (`prive.est_membre_actif()`), `20261103000011_envois_formulaire.sql` (modèle d'en-tête et de droits d'une fonction).
- `tests/securite/*` -- listes de fonctions exécutables par rôle (AD-15) à compléter.
- `tests/outils/comptes.ts`, `tests/outils/demandes.ts` -- comptes `TEST-` jetables et demandes d'essai ; base partagée : ne dépendre que de ses propres données.

## Tasks & Acceptance

**Execution :**
- [ ] `supabase/migrations/20261103000014_prendre_en_charge.sql` -- fonction, droits
- [ ] `lib/erreurs.ts` -- codes manquants
- [ ] `lib/actions/demandes.ts` -- action `prendreEnCharge`
- [ ] `components/nova/toasts.tsx` (et son fournisseur dans la mise en page de l'espace équipe) -- toasts
- [ ] `components/nova/actions-demande.tsx`, `app/equipe/demandes/[reference]/page.tsx` -- panneau d'actions
- [ ] `lib/domaine.ts` -- phrase de prise en charge
- [ ] `tests/story-2-1/prendre-en-charge.test.ts` -- base : tous les cas de la matrice, simultanéité (deux sessions en parallèle), une seule ligne d'historique, droits
- [ ] `tests/story-2-1/action.test.ts` -- action et toasts : réussite, `DEJA_PRISE` avec le nom, erreur inattendue
- [ ] `tests/story-2-1/prise-en-charge.spec.ts` -- navigateur : critères 1 à 3 (deux contextes de navigateur pour le 3), bouton absent hors Nouvelle, toast annoncé, axe ; ordinateur et téléphone
- [ ] `tests/securite/*` -- `prendre_en_charge` attendue pour `authenticated`
- [ ] `docs/carnet-ia.md` -- ligne de la story 2.1

**Acceptance Criteria :**
- Given la migration appliquée et les données d'essai chargées, when on suit les critères 1 à 3 de la story 2.1 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Le responsable qui reclique lit « Déjà prise en charge par [son propre nom]. » | medium | Corrigé (patch) : succès sans nouvelle ligne d'historique. |
| Course entre la modification ratée et la lecture qui choisit le code | low | Corrigé (patch) : lecture verrouillée (`FOR UPDATE`). |
| Lignes `prise_en_charge` à l'ancien format (identifiant de membre) affichées « … : ? » ; fixture 1.6 à l'ancien format | medium | Corrigé (patch) : phrase sans passage si les valeurs ne sont pas des statuts ; fixture et test mis à jour. |
| Bouton affiché pour une demande Nouvelle qui aurait un responsable | low | Corrigé (patch) : même condition que la base. |
| Double clic avant le nouvel affichage : deux appels | low | Corrigé (patch) : garde « en vol » ; commentaire sur le rôle corrigé. |
| Rafraîchissement après une erreur inattendue, contraire au commentaire ; aucun après `DROIT_INSUFFISANT` | low | Corrigé (patch), vérifié par les tests unitaires. |
| Champ `detail` de `Resultat` transmissible au navigateur par une future action | low | Corrigé (patch) : type de résultat d'action sans `detail`. |
| Toast de réussite sans pause au survol ou au focus (WCAG 2.2.1) ; erreurs empilées sans limite | medium | Corrigé (patch) : pause, doublons ignorés, 3 au plus ; tests avec horloge simulée. |
| Échec réseau du bouton jamais testé | low | Corrigé (patch) : test navigateur avec requête interrompue. |
| Phrase d'historique dépendante d'une espace en tête (`trimStart`) | low | Rejeté : couvert par les tests de phrase ; sans effet visible. |
| Attentes réelles (6 à 8 s) dans le test navigateur des toasts | low | Rejeté : remplacé en partie par le test à horloge simulée ; le test navigateur reste valable. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0014 appliquée. **Si refusée par les permissions, le signaler : Abraham la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Dans l'aperçu, prise en charge d'une demande d'essai ; second navigateur → « Déjà prise en charge par… ».
- Ne rien commiter avant la vérification à l'écran.
