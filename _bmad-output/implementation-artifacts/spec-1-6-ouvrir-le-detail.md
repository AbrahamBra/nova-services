---
title: 'Story 1.6 — Ouvrir le détail d''une demande'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'e94d8a3a97e0796a748f464356832aa4ebf275c1'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/mockups/key-detail-demande.html'
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** dans la liste, cliquer sur une demande mène à une page « introuvable ». L'équipe ne peut pas lire le contenu d'une demande, ni ses coordonnées, ni son historique.

**Approach :** créer la page `/equipe/demandes/[référence]` (EXPERIENCE.md §9.5, maquette `key-detail-demande.html`), en lecture seule. Elle affiche le contenu tel qu'il a été saisi, le demandeur, l'état de l'email de confirmation et l'historique. L'historique passe par un composant unique, qui traduit les codes en phrases. Les actions (prendre en charge, statut…) arriveront à l'epic 2.

## Boundaries & Constraints

**Always :**
- Lecture avec la **session** du membre connecté (jamais la clé secrète), via `demandes_liste` ou une lecture équivalente qui respecte RLS. Ajouter à `historique` une règle RLS et des droits par colonne de lecture pour les membres actifs (`prive.est_membre_actif()`). Rien pour `anon` ni `service_role`. `jeton_confirmation` et `cle_envoi` ne sont jamais lus.
- **En-tête :** référence, objet, badges de statut et de priorité (composants de la story 1.5), « Reçue le 03/11/2026 à 08:47 via Formulaire » (heure de Paris, libellé du canal).
- **Colonne principale :**
  - description telle que saisie, retours à la ligne conservés, affichée comme du texte (aucun HTML interprété) ;
  - demandeur : nom, société (si renseignée), email en lien `mailto:`, téléphone en lien `tel:` ou « Non renseigné » ;
  - historique, du plus ancien au plus récent.
- **Colonne d'information** (lecture seule pour l'instant) : responsable (nom ou « Aucun »), statut, priorité, catégorie.
- **Bandeau d'email :** `non_envoye_demo` → « Email non envoyé (mode démonstration) » ; `echec` → « Email de confirmation non envoyé » ; rien pour les autres états.
- **Historique :** les 10 types de l'AD-19 ont chacun leur phrase dans `lib/domaine.ts`, et un composant unique les affiche. Exemple : « Demandeur (formulaire) a créé la demande », avec la date et l'heure de Paris. Les noms des membres sont lus dans `membres` (colonne `nom`) ; les valeurs (statut, priorité, catégorie) sont traduites en libellés.
- **« ← Retour aux demandes »** ramène à la même page de la liste (paramètre `page` conservé).
- **Référence inconnue ou mal formée :** « Demande introuvable. » avec un lien vers la liste (pas d'erreur serveur).
- Erreur de lecture : bandeau « Le serveur ne répond pas… » avec « Réessayer ». Squelettes au chargement.
- Deux colonnes sur ordinateur, une seule sur téléphone (UX-DR8). La rubrique « Demandes » du menu reste active sur cette page.
- Corriger au passage le débordement de la colonne « Responsable » de la liste à 1 440 px (report de la story 1.5).

**Never :**
- Aucune action ni écriture (prise en charge, statut, priorité, note : epic 2).
- Pas de notes internes (story 2.2).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Détail normal | Clic sur une ligne de la liste | Toutes les informations saisies, badges, « Reçue le … via … », historique « Demandeur (formulaire) a créé la demande » | — |
| Sans téléphone ni société | Champs vides | « Non renseigné » pour le téléphone ; ligne société absente | — |
| Email en mode démonstration | `etat_email = non_envoye_demo` | Bandeau « Email non envoyé (mode démonstration) » | — |
| Email en échec | `etat_email = echec` | Bandeau « Email de confirmation non envoyé » | — |
| Description avec `<script>` et retours à la ligne | Texte saisi | Affiché tel quel, retours à la ligne visibles, aucun script exécuté | — |
| Référence inconnue | `/equipe/demandes/NOVA-2026-999999` | « Demande introuvable. » et lien vers la liste | — |
| Référence mal formée | `/equipe/demandes/abc` | « Demande introuvable. » | — |
| Retour à la liste | Venu de `?page=2` | « ← Retour aux demandes » ramène à `?page=2` | — |
| Visiteur ou membre désactivé | Lecture directe de `historique` | Rien | Droit refusé |
| Base injoignable | Erreur de lecture | Bandeau « Réessayer » | `ERREUR_INATTENDUE` |

</frozen-after-approval>

## Code Map

- `app/equipe/demandes/page.tsx`, `lib/demandes.ts`, `lib/filtres.ts` -- lecture paginée de la liste avec la session ; `lireLigne` (validation tolérante d'une ligne) à réutiliser ; `adresseAvecPage` pour le lien de retour.
- `components/nova/liste-demandes.tsx` -- la ligne entière et la référence mènent déjà vers `/equipe/demandes/[référence]` : y ajouter le paramètre de page pour le retour. Corriger ici le débordement de la colonne « Responsable ».
- `components/nova/badges.tsx` -- badges de statut et de priorité à réutiliser.
- `lib/domaine.ts` -- codes et libellés ; y ajouter les phrases des 10 types d'historique (AD-19). `lib/format.ts` -- dates à l'heure de Paris.
- `supabase/migrations/20261103000003_demandes.sql` -- table `historique` (colonnes `auteur_type`, `auteur_id`, `type`, `ancienne_valeur`, `nouvelle_valeur`, dates).
- `supabase/migrations/20261103000007_lecture_demandes.sql` -- modèle des règles de lecture et des droits par colonne à reproduire pour `historique`.
- `tests/securite/*` -- listes de droits attendus à compléter.
- `tests/outils/demandes.ts`, `tests/outils/comptes.ts` -- création de données et de comptes `TEST-…` jetables. La base est partagée : ne dépendre que de ses propres données.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000008_lecture_historique.sql` -- RLS et droits par colonne de lecture sur `historique` pour les membres actifs
- [x] `lib/domaine.ts` -- phrases des 10 types d'historique
- [x] `lib/detail-demande.ts` (`server-only`) -- lecture d'une demande par sa référence et de son historique, avec la session ; résultat typé (trouvée, introuvable, erreur)
- [x] `app/equipe/demandes/[reference]/page.tsx`, `loading.tsx` -- page de détail, états introuvable et erreur
- [x] `components/nova/historique.tsx` -- composant unique d'affichage de l'historique
- [x] `components/nova/liste-demandes.tsx` -- lien avec la page courante ; correction du débordement à 1 440 px
- [x] `tests/securite/*` -- droits de lecture de `historique` attendus
- [x] `tests/story-1-6/detail.test.ts` -- base et lecture : membre actif lit sa demande et son historique, désactivé et visiteur refusés, colonnes secrètes jamais lues, référence inconnue → introuvable
- [x] `tests/story-1-6/historique.test.tsx` -- les 10 types produisent leur phrase ; valeurs traduites ; nom du membre affiché
- [x] `tests/story-1-6/detail.spec.ts` -- navigateur : tous les cas de la matrice, deux colonnes sur ordinateur et une sur téléphone, menu « Demandes » actif, axe
- [x] `docs/carnet-ia.md` -- ligne de la story 1.6 (colonne d'Abraham à compléter)

**Acceptance Criteria :**
- Given la migration appliquée et les données d'essai chargées, when on suit les critères 1 à 4 de la story 1.6 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

- Lecture : table `demandes` (colonnes explicites, ni `jeton_confirmation` ni `cle_envoi`) plutôt que `demandes_liste`, qui n'a ni description ni téléphone ; puis `historique`, puis les noms (`membres.id, nom` et `categories.id, nom`) des identifiants cités. Une demande invisible (RLS) est traitée comme introuvable.
- Phrases (AD-19) : `creation` par le demandeur → « Demandeur (formulaire) a créé la demande » ; par un membre (saisie interne, epic 2) → « [nom] a saisi la demande (téléphone) ». `prise_en_charge`, `liberation`, `classement_sans_suite`, `note_ajoutee`, `retour_nouvelle` sans valeur affichée ; statut, priorité, catégorie en « ancienne → nouvelle ». Valeur inconnue : « ? » ; membre inconnu : « Membre de l'équipe ». À confirmer quand l'epic 2 écrira ces types.
- Lien de retour : la liste transmet ses paramètres d'adresse (`?page=2`) au lien du détail, qui les reprend pour « ← Retour aux demandes ».
- Débordement à 1 440 px : largeurs minimales de Demandeur et Objet réduites, nom du responsable sécable ; vérifié par un test Playwright (écart de défilement nul).
- Test ajouté hors liste : `tests/story-1-6/page-etats.test.tsx` (états de la page sans base : erreur, introuvable, bandeaux d'email, texte échappé).

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Titre d'onglet identique pour toutes les demandes | low | Corrigé (patch) : `generateMetadata` avec la référence. |
| Lignes d'historique illisibles masquées sans le dire | medium | Corrigé (patch) : « N événement(s) illisible(s) ». |
| `mailto:` non encodé ; `tel:` sans chiffres | low | Corrigé (patch). |
| Canal inconnu : « a saisi la demande (?) » | low | Corrigé (patch). |
| Double contrôle du format de référence | low | Corrigé (patch). |
| Compte invité non testé | low | Corrigé (patch). |
| Noms cités seulement dans l'historique non testés ; valeur non UUID | medium | Corrigé (patch) : tests ajoutés. |
| Tests fragiles sur la base partagée (page 1, nettoyage, date de création) | low | Corrigé (patch). |
| Lien de retour : paramètre de page facultatif dans le test 1.5 | low | Corrigé (patch) : URL exacte. |
| Test du débordement à 1 440 px trop faible | low | Corrigé (patch). |
| Référence inconnue en HTTP 200 | low | Rejeté : espace réservé à l'équipe, non indexé. |
| Statut et priorité affichés deux fois | low | Rejeté : conforme à la maquette ; la colonne de droite deviendra des actions (epic 2). |
| Noms masqués par RLS (membre désactivé) | low | Rejeté : la règle de `membres` laisse lire tous les membres aux membres actifs. |
| Index `(demande_id, cree_le, id)` absent | low | Reporté : à mesurer avec NFR-7 (story 2.5). |
| Auteur « demandeur » sur une action d'équipe ; identifiants bigint | low | Rejeté : impossible par les fonctions SQL. |
| Chemins d'échec de `lireDetailAvec` non testés avec un client simulé | medium | Reporté : même besoin qu'en story 1.4. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0008 appliquée. **Si refusée par les permissions, le signaler : Abraham la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Détail vu dans l'aperçu sur une demande d'essai, sur ordinateur et en largeur téléphone.
- Ne rien commiter : vérification à l'écran d'abord.
