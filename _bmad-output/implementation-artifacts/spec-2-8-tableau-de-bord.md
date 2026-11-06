---
title: 'Story 2.8 — Voir le tableau de bord et le compteur de nouvelles demandes'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: 'e78ab54776a8448c2b8c32ef3c5c275997a16360'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** en arrivant sur `/equipe`, un membre ne voit qu'un « Bonjour » : rien ne lui dit ce qui attend une intervention, ni dans la page ni dans le menu.

**Approach :** remplacer l'accueil par un tableau de bord (5 cartes chiffrées cliquables, « Mes demandes en cours », « Saisir une demande ») et ajouter dans le menu le nombre de demandes à prendre en charge. Tous les chiffres sont des comptages de la vue `demandes_liste` à travers les filtres de `lib/filtres.ts`, comme la liste (AD-25). Aucune migration.

## Boundaries & Constraints

**Always :**
- **Cartes** (dans cet ordre, chacune est un lien vers `adresseListe("/equipe/demandes", filtres, 1)` des **mêmes** filtres que son comptage) :
  1. « À prendre en charge » `{statut: "nouvelle", responsable: "aucun"}` — mise en avant (bordure ou fond d'accent) ;
  2. « Priorité Haute non traitées » `{statut: "non_traitees", priorite: "haute"}` ;
  3. « Nouvelle » `{statut: "nouvelle"}` ; 4. « En cours » `{statut: "en_cours"}` ; 5. « Traitée » `{statut: "traitee"}`.
  Nombre formaté par `formaterNombre`. Nom accessible du lien : « [libellé] : [nombre] ».
- **« Mes demandes en cours »** : les 5 dernières (tri par défaut de la liste) de `{statut: "en_cours", responsable: "moi"}`, réutilisant l'affichage d'une ligne de la liste (référence, objet, badges, lien vers le détail) ; lien « Tout voir » vers la liste de ces filtres ; s'il n'y en a aucune : « Aucune demande en cours à votre nom. »
- **En-tête** : le `h1` « Bonjour [prénom] » est gardé tel quel ; lien principal « Saisir une demande » en haut à droite (`/equipe/demandes/nouvelle`, même style que dans la liste).
- **Vide** : si Nouvelle + En cours + Traitée = 0, les cartes et « Mes demandes en cours » sont remplacées par « Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients. » et un bouton « Copier le lien » qui copie `window.location.origin + "/"` (retour « Lien copié » / « Copie impossible », comme `CopierReference`).
- **Chargement** : squelettes des 5 cartes (Suspense dans la page, pas de `loading.tsx` au niveau `/equipe`, qui s'appliquerait aux sous-pages).
- **Erreur** de lecture : bandeau `role="alert"` « Impossible de charger le tableau de bord. » + `BoutonReessayer`, comme les autres pages.
- **Compteur du menu** : nombre `{statut: "nouvelle", responsable: "aucun"}` calculé dans `app/equipe/layout.tsx` et passé à `MenuEquipe` ; affiché à côté de « Demandes » et à côté du bouton « Menu » sous 1 024 px ; masqué à 0 ou en cas d'erreur ; texte pour les lecteurs d'écran « [n] à prendre en charge ». Le nom accessible du lien « Demandes » reste exactement « Demandes » (le compteur est hors du lien).
- Le comptage passe par une fonction exportée de `lib/demandes.ts` qui applique `conditionsDesFiltres` (aucune condition écrite à la main) ; requêtes en parallèle ; client porteur de la session.

**Never :**
- Pas de temps réel ni de rafraîchissement automatique (mis à jour au chargement de page).
- Pas de nouvelle vue, fonction SQL ni migration.

## I/O & Edge-Case Matrix

| Scénario | État | Résultat attendu |
|---|---|---|
| Carte cliquée | « À prendre en charge : 3 » | Liste filtrée dont le total vaut 3 |
| Prise en charge | Compteur du menu à n | Après rechargement : n − 1 ; masqué à 0 |
| Aucune demande | Base vide | Message vide + « Copier le lien » |
| Aucune demande à mon nom | Demandes existantes | Cartes + « Aucune demande en cours à votre nom. » |
| Lecture en échec | Erreur réseau ou base | Bandeau + « Réessayer » ; compteur du menu masqué |
| Collaborateur | Demandes d'autres membres | Mêmes chiffres que l'administrateur (tout le monde voit tout) |

</frozen-after-approval>

## Code Map

- `app/equipe/page.tsx` -- aujourd'hui seulement `h1` « Bonjour {prenom} » via `lireProfil()` ; à remplacer par le tableau de bord (garder le `h1` : `tests/story-1-4/connexion.spec.ts:97,132`).
- `app/equipe/layout.tsx` -- `force-dynamic`, lit le profil, rend `<MenuEquipe nom libelleRole estAdmin />` : y calculer le compteur.
- `components/nova/menu-equipe.tsx` -- `RUBRIQUES`, composant `Lien`, barre `lg:hidden` avec bouton « Menu ». `tests/story-2-6/saisie.spec.ts:117` cherche le lien « Demandes » avec `exact: true` : ne pas mettre le compteur dans le nom du lien.
- `lib/filtres.ts` -- `Filtres`, `conditionsDesFiltres(filtres, membreId)`, `adresseListe`, `RESPONSABLE_AUCUN`, `RESPONSABLE_MOI`, `TRI_PAR_DEFAUT` : réutiliser, ne pas dupliquer.
- `lib/demandes.ts` -- `requeteFiltree` (privée, l.131), `compter` (privée), `membreConnecte`, `lireDemandesAvec`/`lireDemandes` : ajouter un comptage exporté (`select("id", { count: "exact", head: true })` + mêmes conditions) et lire « mes demandes en cours » avec `lireDemandes(1, filtres)` limité à 5 lignes.
- `components/nova/liste-demandes.tsx` (`ListeDemandes`, `adresseDetail`), `components/nova/badges.tsx`, `lib/format.ts` (`formaterNombre`), `app/equipe/demandes/page.tsx` (`MESSAGE_AUCUNE_DEMANDE` l.41, `CLASSE_LIEN_SAISIR`), `app/equipe/demandes/loading.tsx` (squelettes), `components/nova/reessayer.tsx`.
- `components/copier-reference.tsx` -- `copierTexte()` (repli `execCommand`) : l'extraire pour le partager avec « Copier le lien ».
- Pas de shadcn `Card`/`Skeleton` installé : cartes en `div`/`a` Tailwind (fond blanc, bordure `#E2E8F0`, `rounded-lg`, ombre légère, DESIGN.md).
- Tests : `tests/outils/comptes.ts`, `tests/outils/demandes.ts`, modèle `tests/story-2-5/recherche.spec.ts` ; base partagée : jamais de nombre exact absolu, comparer carte et total de la liste filtrée (`getByTestId("total")`) ou des écarts.

## Tasks & Acceptance

**Execution :**
- [x] `lib/demandes.ts` -- comptage filtré exporté et lecture des 5 dernières « mes demandes en cours »
- [x] `lib/tableau-de-bord.ts` -- définition des 5 cartes (libellé, filtres) et lecture parallèle des chiffres ; le compteur du menu réutilise la définition de la carte 1
- [x] `components/copier-reference.tsx` → extraire `copierTexte` (ex. `lib/copier.ts`) ; `components/nova/copier-lien.tsx` -- bouton « Copier le lien »
- [x] `components/nova/tableau-de-bord.tsx` -- cartes, squelettes, « Mes demandes en cours », état vide
- [x] `app/equipe/page.tsx` -- tableau de bord (Suspense, erreur)
- [x] `app/equipe/layout.tsx`, `components/nova/menu-equipe.tsx` -- compteur
- [x] `tests/story-2-8/tableau-de-bord.test.ts` -- comptage = total de la liste pour chaque carte, adresses des cartes, « moi », échec de lecture
- [x] `tests/story-2-8/tableau-de-bord.spec.ts` -- critères 1 à 3 (carte = total de la liste filtrée, compteur −1 après prise en charge), axe ; ordinateur et téléphone (compteur à côté de « Menu »)
- [x] `tests/story-2-8/etats.test.tsx` -- rendu de l'état vide (critère 4 sans vider la base partagée), de « aucune demande à mon nom » et de l'erreur
- [x] `docs/carnet-ia.md` -- ligne de la story 2.8

**Acceptance Criteria :**
- Given la story 2.8 d'`epics.md`, when on suit ses critères 1 à 4 à l'écran, then chacun est visible.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Compteur du menu périmé après une navigation par lien (mise en page non relue) ; différent de la carte sur `/equipe` | medium | Confirmé par la doc Next (« Layouts do not re-render on navigation »). Corrigé (patch) : valeur initiale de la mise en page, relue par une action serveur à chaque changement de page. Écart assumé : petite action ajoutée, la spec ne l'excluait pas. |
| Compteur attendu après le profil : un aller-retour de plus sur chaque page | low | Corrigé (patch) : lectures en parallèle. |
| `MESSAGE_AUCUNE_DEMANDE` dans un module `server-only` ; ligne vide et commentaire orphelins | low | Corrigé (patch) : message déplacé dans `lib/domaine.ts`. |
| `vide` jamais calculé à vrai par un test | medium | Corrigé (patch) : tests avec client simulé (tout à 0 ; seulement Traitée). |
| Test « sans session » sans assertion si la lecture échoue | low | Corrigé (patch). |
| Test navigateur du critère 3 : compteur exigé visible avant de créer une demande | low | Corrigé (patch) : demande créée d'abord. |
| « Copier le lien » : adresse copiée et libellés jamais testés au clic | medium | Reporté : état vide inatteignable sur la base partagée, pas de banc de composants (vitest en `node`). |
| Comptage « À prendre en charge » fait deux fois sur `/equipe` | low | Rejeté : une requête de comptage de plus, sans tort visible. |
| Squelette limité aux cartes | low | Rejeté : conforme à EXPERIENCE.md (« Squelettes des 5 cartes »). |
| `CopierLien` recopie la logique d'état de `CopierReference` | low | Rejeté : aucun tort nommé aujourd'hui ; refonte plus large qu'une correction. |
| Test de source « aucune condition à la main » fragile | low | Rejeté : vitest tourne toujours depuis la racine. |
| Chemin `/equipe/demandes` défini à trois endroits | low | Rejeté : `RUBRIQUES` contenait déjà la chaîne ; renommage improbable. |
| `lireDemandesAvec` réutilisé pour 5 lignes ; `.slice` redondant | low | Rejeté : sans effet visible. |
| Mise en page sans test du compteur `null` | low | Rejeté : `lireCompteurMenu` renvoie `null` sur erreur (testé) et le menu masque `null` (testé). |
| `docs/carnet-ia.md` absent du diff | false | Exclu volontairement du diff de relecture ; le fichier est bien modifié. |
| Lecture du compteur sans délai maximal | low | Rejeté : le profil lu juste avant a le même risque ; cas improbable. |
| `taillePage` ≤ 0 | false | Aucun appelant ne passe une telle valeur (constantes 25 et 5). |
| `CopierLien` démonté pendant la copie | low | Rejeté : sans effet pour l'utilisateur (React 19 ignore la mise à jour). |
| Compteur NaN ou décimal | false | `count` de PostgREST est toujours un entier. |
| Nettoyage hors `finally` dans un test | low | Rejeté : ne joue que si le test a déjà échoué ; `afterAll` nettoie par préfixe. |

## Verification

**Commands :**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Dans l'aperçu : cartes et chiffres, clic sur « À prendre en charge » = même total dans la liste, compteur du menu qui baisse après une prise en charge, vue téléphone.
- Ne rien commiter avant la vérification à l'écran.
