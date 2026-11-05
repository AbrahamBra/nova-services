---
title: 'Story 2.5 — Rechercher et filtrer les demandes'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'a14f4fbdaca4489ba5a5b99f535a799c7c2fb1d7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** pour retrouver une demande, l'équipe doit faire défiler toute la liste, page par page.

**Approach :**
- Au-dessus de la liste, une barre avec une recherche texte et cinq filtres : Statut, Priorité, Catégorie, Canal, Responsable.
- Les filtres se combinent et sont gardés dans l'adresse de la page.
- Toute la lecture passe par `lib/filtres.ts` et la vue `demandes_liste` (AD-25). Le tableau de bord (2.8) réutilisera ce même chemin.
- La recherche trouve un mot partiel, sans tenir compte des majuscules ni des accents, grâce à une colonne normalisée maintenue par la base.

## Boundaries & Constraints

**Always :**
- **Recherche** (FR-12) :
  - porte sur la référence, le nom, la société, l'email et l'objet ;
  - mot partiel, sans majuscules ni accents : « dupont » trouve « Dupont » et « Dupont-Aïdi », « aidi » trouve « Aïdi » ;
  - une **colonne normalisée** sur `demandes` (minuscules, sans accents), tenue à jour par la base (colonne générée ou déclencheur, avec une fonction de normalisation immuable dans `prive`), indexée pour la recherche partielle (`pg_trgm` si disponible) ;
  - la saisie est normalisée de la même façon ; les caractères `%`, `_` et `\` sont cherchés tels quels ;
  - la colonne n'est **pas** lisible directement par les membres : la vue `demandes_liste` l'expose seulement pour filtrer, ou la recherche passe par une fonction. Au choix de l'implémentation, tant que la RLS des membres actifs s'applique.
- **Filtres dans l'adresse** (`lib/filtres.ts`, AD-25) :
  - `q` (texte, 100 caractères au plus) ;
  - `statut` (`nouvelle`, `en_cours`, `traitee`, `non_traitees` = Nouvelle et En cours) ;
  - `priorite` (`basse`, `normale`, `haute`) ;
  - `categorie` (identifiant) ;
  - `canal` (`formulaire`, `telephone`, `email`) ;
  - `responsable` (`aucun` = sans responsable, `moi` = le membre connecté, ou l'identifiant d'un membre) ;
  - et `page`. Une valeur invalide est ignorée, sans erreur. Changer un filtre ramène à la page 1.
- **Barre** (EXPERIENCE.md §5, §9.4) :
  - champ « Rechercher une référence, un nom, une société, un email, un objet… », lancé 300 ms après la dernière frappe ou à l'appui sur Entrée ;
  - cinq listes déroulantes : Statut (Tous, Non traitées, Nouvelle, En cours, Traitée), Priorité, Catégorie (toutes les catégories, y compris les désactivées), Canal, Responsable (Tous, Sans responsable, Mes demandes, puis les membres par nom) ;
  - chaque changement met l'adresse à jour sans recharger la page. Le bouton retour du navigateur revient aux filtres précédents ;
  - « Effacer les filtres » apparaît dès qu'un filtre est actif.
- **Sans résultat** : « Aucune demande ne correspond à ces filtres. » avec le bouton « Effacer les filtres ». Le message de la liste vide sans filtre (story 1.5) ne change pas.
- **Retour depuis le détail** : le lien d'une ligne et « ← Retour aux demandes » gardent **tous** les paramètres (filtres et page), pas seulement `page`.
- **Charge et performance (NFR-7)** :
  - commande `npm run donnees:charge` : crée 2 000 demandes fictives `TEST-charge-…` sur la base de développement, avec un garde-fou sur l'environnement, et les efface avec `--vider` ;
  - commande `npm run mesure:liste` : mesure la lecture filtrée (recherche + filtres combinés) avec la session d'un compte de test, et affiche le temps. Attendu : moins de 2 secondes.
  - Ces deux commandes ne tournent pas dans la CI : 2 000 lignes de plus dans la base partagée fausseraient les tests de pagination. Le résultat de la mesure est noté dans le carnet IA.
- Le compteur total et la pagination de la story 1.5 s'appliquent à la liste filtrée.

**Never :**
- Pas de tri au choix ni de filtre par date (hors périmètre).
- Pas de tableau de bord (story 2.8), qui réutilisera `lib/filtres.ts`.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Référence complète | `q=NOVA-2026-0042` | Seule cette demande | — |
| Mot partiel, accents | `q=dupont` ; `q=aidi` | « Dupont » et « Dupont-Aïdi » ; « Aïdi » | — |
| Filtres combinés | `statut=non_traitees&priorite=haute` | Nouvelle ou En cours, et Haute ; filtres dans l'adresse | — |
| Sans responsable / Mes demandes | `responsable=aucun` / `moi` | Demandes sans responsable / dont je suis responsable | — |
| Catégorie, canal, responsable précis | Un filtre chacun | Seules les demandes correspondantes | — |
| Aucun résultat | Filtres sans correspondance | Message + « Effacer les filtres » | — |
| Caractères spéciaux | `q=%`, `q=_`, `q='` | Cherchés tels quels, aucune erreur | — |
| Valeur invalide | `statut=fermee`, `categorie=abc`, `page=-1` | Ignorée | — |
| Retour depuis le détail | Filtres actifs, ouvrir une demande, revenir | Mêmes filtres, même page | — |
| Membre désactivé ou visiteur | Lecture de la liste ou de la colonne normalisée | Rien | droit refusé |

</frozen-after-approval>

## Code Map

- `lib/filtres.ts` -- tri, pagination, `lireNumeroPage`, `adresseAvecPage` (story 1.5) : y ajouter la lecture et l'écriture des filtres de l'adresse, et leur traduction en requête.
- `lib/demandes.ts` (`lireDemandesAvec`, `lireDemandes`, `lireLigne`) -- lecture paginée avec la session ; à étendre aux filtres.
- `app/equipe/demandes/page.tsx`, `components/nova/liste-demandes.tsx`, `components/nova/pagination.tsx` -- liste, lien vers le détail (paramètres conservés) ; y ajouter la barre (composant client).
- `app/equipe/demandes/[reference]/page.tsx` -- lien « ← Retour aux demandes » : doit garder tous les paramètres.
- `supabase/migrations/20261103000007_lecture_demandes.sql` -- vue `demandes_liste`, RLS et droits par colonne ; `20261103000003_demandes.sql` -- table et déclencheur.
- `lib/categories.ts` (2.4, lecture avec la session), membres lisibles (`id, nom, etat`) -- options des filtres.
- `scripts/donnees.ts`, `scripts/commun.ts`, `supabase/essai/demandes-essai.sql`, `package.json` -- modèle des commandes de données avec garde-fou.
- `tests/story-1-5/*` -- liste et pagination existantes, à garder vertes ; `tests/securite/*` -- droits.

## Tasks & Acceptance

**Execution :**
- [ ] `supabase/migrations/20261103000018_recherche.sql` -- fonction de normalisation, colonne normalisée, index, vue `demandes_liste` (ou fonction de recherche), droits
- [ ] `lib/filtres.ts`, `lib/demandes.ts` -- filtres de l'adresse et requête
- [ ] `components/nova/filtres-demandes.tsx`, `app/equipe/demandes/page.tsx`, `components/nova/liste-demandes.tsx`, `app/equipe/demandes/[reference]/page.tsx` -- barre, message sans résultat, paramètres conservés
- [ ] `scripts/charge.ts`, `scripts/mesure-liste.ts`, `package.json` -- `donnees:charge` et `mesure:liste`
- [ ] `tests/story-2-5/filtres.test.ts` -- lecture et écriture des paramètres, valeurs invalides
- [ ] `tests/story-2-5/recherche.test.ts` -- base : normalisation, recherche partielle et accents, chaque filtre et leurs combinaisons, caractères spéciaux, droits
- [ ] `tests/story-2-5/recherche.spec.ts` -- navigateur : critères 1 à 4, recherche après 300 ms, retour arrière, axe ; ordinateur et téléphone
- [ ] `tests/securite/*` -- listes mises à jour
- [ ] `docs/carnet-ia.md` -- ligne de la story 2.5, avec la mesure NFR-7

**Acceptance Criteria :**
- Given la migration appliquée, when on suit les critères 1 à 4 de la story 2.5 d'`epics.md`, then chacun est visible à l'écran.
- Given 2 000 demandes chargées par `donnees:charge`, when `npm run mesure:liste`, then la liste filtrée est lue en moins de 2 secondes, puis la charge est effacée.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| `rechercher_demandes` (definer) contourne la RLS réelle et matérialise tout avant les filtres | high | Corrigé (patch, migration 0019) : la fonction rend les identifiants ; la vue (RLS) filtre, trie et pagine. |
| Normalisation incomplète (lettres accentuées manquantes, tiret, espaces doublés) | medium | Corrigé (patch) : NFD + marques retirées, tirets et apostrophes en espace, espaces réduits ; JS et SQL alignés. |
| `pg_trgm` déjà installé ailleurs : migration en échec | low | Corrigé (patch) : schéma réel vérifié. |
| Champ de recherche : retour à l'ancien texte, saisie écrasée, minuterie qui annule un retour arrière | medium | Corrigé (patch). |
| Une entrée d'historique par pause de frappe | low | Corrigé (patch) : `replace` pour la frappe, `push` pour Entrée et les listes. |
| Pas d'état « chargement » ni annonce du total | low | Corrigé (patch) : `aria-busy`, total en `role="status"`. |
| État d'erreur sans barre ni sortie ; options indisponibles affichées « introuvable » | medium | Corrigé (patch). |
| Mesure : lecture de la charge en échec lue comme 0 ; cas larges absents | low | Corrigé (patch). |
| Barre oblique inverse perdue dans le carnet | low | Corrigé (patch). |
| Tests : recherche puis liste, délai de 300 ms réellement vérifié, page hors bornes filtrée | medium | Corrigé (patch). |
| « Mes demandes » quand la session est illisible : erreur générique | low | Reporté : nécessite une session cassée ; l'utilisateur voit une erreur, pas de fausses données. |
| Recherche par téléphone | low | Rejeté : hors des champs de FR-12 (référence, nom, société, email, objet). |
| Mesure limitée à la lecture des données (pas le rendu de la page) | low | Rejeté : la lecture filtrée est la partie qui dépend du volume ; noté dans le carnet. |
| `FiltresDemandes` sans test de composant | low | Reporté : même besoin que les stories 2.2 et 2.3. |
| Carnet et spec absents du diff | false | Exclus volontairement du diff de relecture. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0018. **Si refusée par les permissions, le signaler : la session principale la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert
- `npm run donnees:charge`, `npm run mesure:liste`, `npm run donnees:charge -- --vider` -- par la session principale, hors CI

**Manual checks :**
- Dans l'aperçu : recherche « dupont », filtres combinés, retour depuis le détail.
- Ne rien commiter avant la vérification à l'écran.
