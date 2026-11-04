---
title: 'Story 1.5 — Voir toutes les demandes avec leur statut'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '426638bcc82f4ecf82ecca2e7ff84686d52d4a92'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/mockups/key-liste-demandes.html'
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** les demandes sont enregistrées, mais l'équipe ne peut pas les voir. C'est le besoin le plus important d'Abraham : toutes les demandes au même endroit, avec leur statut.

**Approach :** ajouter la page `/equipe/demandes` (EXPERIENCE.md §9.4, maquette `key-liste-demandes.html`). Elle lit une vue `demandes_liste` qui respecte les règles RLS et ouvre uniquement aux membres actifs la lecture des colonnes nécessaires. Elle trie les demandes de la plus récente à la plus ancienne et les découpe en pages de 25. Des commandes de développement remplissent la base avec environ 40 demandes d'essai couvrant tous les cas, puis la vident.

## Boundaries & Constraints

**Always :**
- **Lecture réservée aux membres actifs :**
  - règles RLS de lecture sur `demandes`, `categories` et `membres` pour `authenticated`, conditionnées par `prive.est_membre_actif()` (AD-2, AD-3) ;
  - droits **par colonne** : sur `demandes`, toutes les colonnes affichées, mais **jamais** `jeton_confirmation` ni `cle_envoi` ; sur `membres`, seulement `id`, `nom` et `etat` (ni email ni rôle) ; sur `categories`, `id`, `nom` et `actif` ;
  - le visiteur (`anon`) et `service_role` ne gagnent aucun droit.
- Vue `demandes_liste` en `security_invoker = true`. Elle ajoute aux demandes le nom de la catégorie et le nom du responsable ; aucune vue matérialisée.
- La page lit avec la **session** de la personne connectée (client serveur), jamais avec la clé secrète. Elle n'est jamais mise en cache.
- `lib/filtres.ts` : tri par date de création décroissante, pages de 25, numéro de page dans l'adresse (`?page=2`) ; sert ensuite à la recherche, aux filtres et au tableau de bord (AD-25).
- **Affichage :**
  - colonnes : Référence · Date · Demandeur (nom et société) · Objet · Catégorie · Canal · Statut · Priorité · Responsable (« — » si aucun) ;
  - toute la ligne ouvre le détail, et la référence est un vrai lien vers `/equipe/demandes/[référence]` (le détail arrive en story 1.6 : le lien peut mener à une page « introuvable » d'ici là) ;
  - libellés et dates via `lib/domaine.ts` et `lib/format.ts` (heure de Paris) ;
  - en bas : « 1–25 sur N », avec Précédent et Suivant.
- Badges (UX-DR2) : statut en pilule (Nouvelle bleu, En cours orange, Traitée vert), priorité en rectangle (Haute rouge, Normale et Basse gris), **toujours avec le mot**.
- États (UX-DR4) : 8 lignes squelettes au chargement ; bandeau « Le serveur ne répond pas… » avec « Réessayer » en cas d'erreur ; état vide « Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients. » quand la base n'en contient aucune.
- Affichage selon la largeur (UX-DR8) : tableau complet sur ordinateur ; tableau réduit (référence, objet, statut, priorité, date) sur tablette ; une carte par demande sur téléphone.
- Menu : ajouter la rubrique « Demandes » ; le menu n'affiche toujours que les rubriques qui existent.
- **Données d'essai** (`supabase/seed.sql`, commandes `npm run donnees:remplir` et `npm run donnees:vider`) :
  - environ 40 demandes, dont l'objet commence par `TEST-` ;
  - tous les statuts, priorités, canaux et états d'email, et des responsables parmi `TEST-Admin` et `TEST-Collaborateur` (identifiants retrouvés par leur email dans `.env.local`) ;
  - des demandeurs « Dupont » et « Dupont-Aïdi », et 3 demandes de `jean.dupont@example.com` ;
  - des demandes traitées il y a plus de 2 ans, et une demande rouverte puis traitée récemment ;
  - une ligne d'historique `creation` pour chaque demande ;
  - références au bon format, sans entrer en conflit avec le compteur des vraies demandes.

  `donnees:vider` supprime les demandes dont l'objet ou le nom commence par `TEST-`, avec leur historique. Les deux commandes refusent de tourner hors `developpement`.
- Droits par colonne vérifiés par les tests de sécurité (report de la story 1.1).

**Never :**
- Pas de recherche ni de filtres (story 2.5), pas de tableau de bord ni de compteur (story 2.8), pas de bouton « Saisir une demande » (story 2.6), pas de page de détail (story 1.6).
- Aucune lecture avec la clé secrète ; aucun droit pour `anon`.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Liste normale | Membre actif, données d'essai chargées | Tableau trié du plus récent au plus ancien, 9 colonnes, badges avec le mot | — |
| Pagination | 40 demandes | Page 1 : « 1–25 sur 40 » ; « Suivant » mène à `?page=2` : « 26–40 sur 40 » | — |
| Page hors bornes | `?page=99` ou `?page=abc` | Dernière page valide, ou page 1 | — |
| Aucune demande | Base vidée | Message d'état vide | — |
| Visiteur | Lecture de `demandes_liste` ou de `demandes` avec la clé publiable sans session | Rien | Droit refusé |
| Compte désactivé | Session d'un membre `desactive` | Aucune ligne (et renvoi vers la connexion par la mise en page) | — |
| Collaborateur sur `membres` | Lecture de `email` ou `role` d'un autre membre | Refusé | Droit de colonne absent |
| Colonnes secrètes | Lecture de `jeton_confirmation` ou `cle_envoi` par un membre | Refusé | Droit de colonne absent |
| Base injoignable | Erreur de lecture | Bandeau « Le serveur ne répond pas… » et « Réessayer » | `ERREUR_INATTENDUE` |
| Téléphone | Largeur < 640 px | Une carte par demande, menu replié | — |

</frozen-after-approval>

## Code Map

- `lib/supabase/serveur.ts` -- client serveur avec la session : à utiliser pour lire la vue.
- `lib/session.ts`, `app/equipe/layout.tsx` -- profil du membre et garde de l'espace équipe : ne pas les dupliquer.
- `components/nova/menu-equipe.tsx` -- liste des rubriques : ajouter « Demandes ».
- `lib/domaine.ts` -- libellés des statuts, priorités, canaux et états d'email ; `lib/format.ts` -- dates à l'heure de Paris et nombres.
- `lib/erreurs.ts`, `components/nova/reessayer.tsx` -- message et bouton de l'état d'erreur.
- `supabase/migrations/20261103000003_demandes.sql` -- colonnes de `demandes` (dont `jeton_confirmation`, `cle_envoi` à ne jamais exposer), déclencheur des dates (sur mise à jour seulement : une insertion directe peut fixer `traitee_le`).
- `supabase/migrations/20261103000004_*`, `…0005_membres.sql` -- `service_role` sans droit direct ; `prive.est_membre_actif()` disponible pour `authenticated`.
- `scripts/commun.ts`, `scripts/db-push.mjs` -- chargement de `.env.local` et garde-fou d'environnement à reprendre pour `donnees:*`.
- `tests/securite/droits-anon.test.ts`, `droits-service-role.test.ts` -- listes de droits attendus à compléter (droits de colonne compris).
- `tests/outils/comptes.ts` -- comptes `TEST-…` jetables pour les tests.
- **Attention :** la base de développement est partagée par des tests qui tournent en parallèle. Les tests de la liste ne doivent pas dépendre du nombre exact de demandes en base : ils créent leurs propres demandes `TEST-…` et vérifient leur présence, leur ordre relatif et le format de la pagination.

## Tasks & Acceptance

**Execution :**
- [ ] `supabase/migrations/20261103000007_lecture_demandes.sql` -- règles RLS de lecture, droits par colonne, vue `demandes_liste` (`security_invoker`)
- [ ] `lib/filtres.ts` -- tri, pagination, lecture de `?page=`
- [ ] `lib/demandes.ts` (`server-only`) -- lecture paginée de la vue avec la session ; résultat typé
- [ ] `app/equipe/demandes/page.tsx`, `app/equipe/demandes/loading.tsx` -- page, squelettes, états vide et erreur
- [ ] `components/nova/badges.tsx` -- badges de statut et de priorité
- [ ] `components/nova/liste-demandes.tsx`, `components/nova/pagination.tsx` -- tableau, cartes sur téléphone, pagination
- [ ] `components/nova/menu-equipe.tsx` -- rubrique « Demandes »
- [ ] `supabase/essai/demandes-essai.sql`, `scripts/donnees.ts`, `package.json` -- données d'essai et commandes `donnees:remplir` / `donnees:vider`
- [ ] `tests/securite/*` -- droits attendus mis à jour ; détection des droits par colonne
- [ ] `tests/story-1-5/lecture.test.ts` -- base : membre actif lit la vue, désactivé ne lit rien, visiteur refusé, colonnes interdites refusées, `membres` limité à `id`/`nom`/`etat`
- [ ] `tests/story-1-5/filtres.test.ts` -- pagination (bornes, page invalide)
- [ ] `tests/story-1-5/liste.spec.ts` -- navigateur : colonnes, ordre, badges avec le mot, pagination « 1–25 sur N », cartes sur téléphone, tableau réduit sur tablette, état d'erreur, axe
- [ ] `docs/carnet-ia.md` -- ligne de la story 1.5 (colonne d'Abraham à compléter)

**Acceptance Criteria :**
- Given la migration appliquée et `npm run donnees:remplir` lancé, when Abraham suit les critères 1 à 4 de la story 1.5 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

- Le déclencheur `demandes_dates` agit aussi à l'**insertion** (il fixe `traitee_le` à « maintenant ») : `supabase/essai/demandes-essai.sql` (déplacé hors du chemin de seed de la CLI, `[db.seed]` désactivé) le suspend le temps de l'insertion (`disable trigger`, dans la transaction du script) pour garder les dates passées ; l'historique d'essai est inséré directement avec ses dates.
- Références d'essai prises au compteur de l'année de la demande (comme `deposer_demande`) : aucun conflit, au prix de numéros consommés sur `nova-dev`.
- `donnees:remplir` remplace d'abord les demandes d'essai existantes (objet `TEST-…`) : relancé deux fois, il en laisse toujours 40.
- Droits par colonne sur `demandes` : toutes les colonnes sauf `jeton_confirmation` et `cle_envoi` (le détail de la story 1.6 en a besoin).
- État d'erreur, état vide et squelettes vérifiés par un rendu serveur avec lecture simulée (`tests/story-1-5/page-etats.test.tsx`), une panne de base ne pouvant pas être provoquée sans risque dans le navigateur sur une base partagée.
- Rubrique du menu active aussi sur ses sous-pages (préfixe), sauf l'accueil.

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| `supabase/seed.sql` exécuté automatiquement par `supabase db reset` | medium | Corrigé (patch) : déplacé dans `supabase/essai/`, `[db.seed]` désactivé. Le bloc gelé cite encore l'ancien chemin (renégociation par Abraham). |
| Une ligne mal formée bloque toute la liste ; date illisible fait planter le rendu | medium | Corrigé (patch) : ligne ignorée et tracée sans donnée personnelle. |
| Page hors bornes affichée sous une mauvaise adresse | low | Corrigé (patch) : redirection vers l'adresse canonique. |
| Pagination visible sur une seule page ; boutons désactivés muets | low | Corrigé (patch). |
| Tableau sans nom accessible | low | Corrigé (patch) : `aria-label="Demandes"`. |
| Tests instables sur la base partagée (rangs, comptage) | medium | Corrigé (patch) : lignes retrouvées par référence, redirection vérifiée. |
| Rubrique « Accueil » non vérifiée hors de sa page | low | Corrigé (patch). |
| Garde-fou des données : environnement absent ou inconnu non testé | low | Corrigé (patch). |
| Outils de test : catégorie absente, préfixe trop large | low | Corrigé (patch). |
| Numéros de référence consommés et `donnees:vider` pendant des tests | low | Corrigé (patch) : documenté dans le script et le README. |
| Liens vers un détail inexistant | false | Accepté par l'intention : le détail arrive en story 1.6. |
| Membre non actif : état vide au lieu d'un refus | low | Rejeté : la mise en page renvoie vers la connexion avant tout affichage. |
| `position: relative` sur `<tr>` (anciens WebKit) | low | Rejeté : navigateurs récents seulement. |
| Index composite pour le tri | low | Rejeté : volumes faibles ; à mesurer en story 2.5 (NFR-7). |
| Vue exposant des colonnes non lues (email…) | low | Rejeté : nécessaires au détail (1.6) et à la recherche (2.5), réservées aux membres actifs. |
| Course entre comptage et lecture | low | Rejeté : rare, sans perte de données. |
| Chemin de réussite de `donnees:remplir` non testé automatiquement | medium | Reporté : vérifié à la main ; un test automatique viderait les données des autres tests. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0007 appliquée. **Si refusée par les permissions, le signaler : Abraham la lancera.**
- `npm run donnees:remplir`, puis `npm run donnees:vider`, puis `npm run donnees:remplir` -- se terminent sans erreur et ne touchent pas aux demandes réelles. Même consigne si la commande est refusée.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Liste vue dans l'aperçu avec les données d'essai, sur ordinateur et en largeur téléphone.
- Ne rien commiter : Abraham vérifie d'abord à l'écran.
