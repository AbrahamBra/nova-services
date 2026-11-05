---
title: 'Story 2.6 — Saisir une demande reçue par téléphone ou par email'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '59d2fdcbdcce2638a4573f9463bb225b2ae69fd5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** les demandes reçues par téléphone ou par email n'entrent pas dans l'application. Elles restent dans des carnets et des boîtes mail.

**Approach :**
- Une page `/equipe/demandes/nouvelle`, accessible par « Saisir une demande » dans le menu et en haut de la liste.
- Elle reprend le formulaire public, avec le canal en premier, un email facultatif et un rappel à la place de la case de consentement.
- La fonction SQL `saisir_demande` enregistre la demande en un bloc : même numérotation, historique « Saisie par [nom] (téléphone) ».
- Si un email est renseigné, la confirmation part comme pour le formulaire public (AD-13).

## Boundaries & Constraints

**Always :**
- **Fonction `saisir_demande(p_cle_envoi, p_canal, p_nom, p_email, p_telephone, p_societe, p_categorie_id, p_objet, p_description)`** (AD-4, AD-6, AD-15, AD-26) :
  - `SECURITY DEFINER`, `search_path = ''` ; membre actif en première instruction (`DROIT_INSUFFISANT`) ;
  - mêmes règles de champs que `deposer_demande` (espaces retirés, longueurs, catégorie active, email bien formé s'il est renseigné), avec ces différences :
    - canal `telephone` ou `email` obligatoire ;
    - email facultatif, mais au moins un email ou un téléphone (`COORDONNEES_REQUISES`) ;
    - pas de consentement ;
  - **même compteur de références** que le dépôt public (AD-6) ;
  - idempotente par `cle_envoi` : un second envoi renvoie la même demande (AD-26) ;
  - `saisie_par_id` = le membre ; `etat_email` vaut `sans_email` sans email, `en_attente` sinon ;
  - une ligne d'historique `creation`, auteur membre, valeur = le canal ;
  - renvoie la référence et les données de l'email, comme `deposer_demande` ;
  - `EXECUTE` à `authenticated` seulement. Pas d'empreinte d'IP ni de limite d'envois (pas d'anti-spam).
- **Action `saisir`** dans `lib/actions/demandes.ts` :
  - Zod, avec un schéma partagé avec l'écran (AD-8) ;
  - appel de `saisir_demande` avec la **session** du membre ;
  - si un email est renseigné : envoi par `lib/server/emails.ts`, puis `noter_resultat_email`, comme l'action `deposer` (mode démonstration compris). Un email non envoyé ne fait jamais échouer la saisie ;
  - renvoie la référence. Erreurs : messages sous les champs, ou bandeau général.
- **Page `/equipe/demandes/nouvelle`** (EXPERIENCE.md §9.6) :
  - titre « Saisir une demande » ;
  - **Canal** en premier : « Téléphone » ou « Email », obligatoire, sans valeur par défaut (« Choisissez le canal. ») ;
  - puis les champs du formulaire public : nom, email (facultatif), téléphone (facultatif), société (facultative), catégorie, objet, description avec compteur ;
  - le rappel « Pensez à informer le demandeur de l'usage de ses données. », sans case de consentement, sans champ piège ;
  - bouton « Enregistrer la demande », qui affiche « Enregistrement… » pendant l'envoi ;
  - erreurs sous les champs, focus sur le premier champ en erreur, saisie conservée (UX-DR7) ;
  - ni email ni téléphone : « Indiquez au moins un email ou un téléphone. » sous le champ Email ;
  - réussite : ouverture du détail de la nouvelle demande et toast « Demande NOVA-2026-0043 enregistrée. » ;
  - page réservée aux membres actifs, comme le reste de l'espace équipe.
- **Liens** : « Saisir une demande » dans le menu de l'espace équipe, et en haut de la liste des demandes.
- **Historique** : la création par un membre s'affiche « Saisie par [nom] (téléphone) » ou « (email) », avec l'auteur au milieu de la phrase. La création par le formulaire public garde sa phrase.

**Never :**
- Pas de saisie au nom d'un autre membre, pas de responsable choisi à la saisie.
- Pas de canal « formulaire » dans cette page.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Téléphone sans email | Canal Téléphone, nom, téléphone, demande | Toast « Demande NOVA-… enregistrée. », détail avec canal Téléphone, historique « Saisie par … (téléphone) », état email `sans_email` | — |
| Email renseigné | Canal Email, email autorisé | Email de confirmation envoyé (ou `non_envoye_demo`) | — |
| Ni email ni téléphone | Les deux vides | « Indiquez au moins un email ou un téléphone. » | `COORDONNEES_REQUISES` |
| Canal absent ou `formulaire` | Appel direct | Refusé | `DONNEES_INVALIDES` |
| Double clic | Même `cle_envoi` | Une seule demande | — |
| Beaucoup de saisies | 10 saisies de suite | Toutes acceptées (pas d'anti-spam) | — |
| Visiteur | Page ou action sans connexion | Page : retour à la connexion ; action / fonction : refusée | droit refusé |
| Membre désactivé | Appel direct | Refusé | `DROIT_INSUFFISANT` |
| Champs trop longs ou catégorie inactive | Appel direct | Refusés | `DONNEES_INVALIDES` / `CATEGORIE_INVALIDE` |

</frozen-after-approval>

## Code Map

- `components/formulaire-depot.tsx`, `lib/schemas/depot.ts` -- formulaire et schéma publics : champs, compteur, messages, focus ; à réutiliser au maximum (sans champ piège ni consentement).
- `lib/actions/demandes.ts` (`deposer` : appel, email, `noter_resultat_email` ; `prendreEnCharge` : modèle avec la session), `lib/server/emails.ts`, `lib/server/appeler.ts`.
- `supabase/migrations/20261103000011_envois_formulaire.sql` (dernière version de `deposer_demande` : compteur, contrôles, retour), `20261103000010_*` (états d'email), `20261103000016_statuts.sql` (modèle d'en-tête de fonction pour membre).
- `lib/domaine.ts` (`creation` : phrase, `AVANT_AUTEUR_HISTORIQUE`), `components/nova/historique.tsx`.
- `components/nova/menu-equipe.tsx`, `app/equipe/demandes/page.tsx` -- liens « Saisir une demande ».
- `components/nova/toasts.tsx` -- toast après la redirection vers le détail (le fournisseur est dans la mise en page de l'espace équipe).
- `lib/categories.ts` -- catégories actives lues avec la session.
- `lib/erreurs.ts` -- code `COORDONNEES_REQUISES` et concordance ; `tests/securite/*`.

## Tasks & Acceptance

**Execution :**
- [ ] `supabase/migrations/20261103000020_saisir_demande.sql` -- fonction, droits
- [ ] `lib/erreurs.ts`, `lib/schemas/saisie.ts`, `lib/actions/demandes.ts` -- code, schéma, action `saisir`
- [ ] `app/equipe/demandes/nouvelle/page.tsx`, `components/formulaire-saisie.tsx` -- page et formulaire
- [ ] `components/nova/menu-equipe.tsx`, `app/equipe/demandes/page.tsx` -- liens
- [ ] `lib/domaine.ts` -- phrase « Saisie par … (canal) »
- [ ] `tests/story-2-6/saisie.test.ts` -- base : cas de la matrice, compteur partagé, historique, état email, droits
- [ ] `tests/story-2-6/action.test.ts` -- action, schéma, email envoyé ou non
- [ ] `tests/story-2-6/saisie.spec.ts` -- navigateur : critères 1 à 4, accès sans connexion, axe ; ordinateur et téléphone
- [ ] `tests/securite/*` -- listes mises à jour
- [ ] `docs/carnet-ia.md` -- ligne de la story 2.6

**Acceptance Criteria :**
- Given la migration appliquée, when on suit les critères 1 à 4 de la story 2.6 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Second envoi (même clé) : email envoyé à l'adresse du formulaire rejoué, pas à celle enregistrée ; email vidé au rejeu → jamais envoyé | medium | Corrigé (patch, migration 0021) : `saisir_demande` renvoie l'email enregistré ; l'action envoie à cette adresse. |
| Recherche par `cle_envoi` non limitée au membre : la demande d'un autre (ou du formulaire public) renvoyée comme « enregistrée » | medium | Corrigé (patch, 0021) : filtre `saisie_par_id = membre`. |
| Commentaire SQL faux sur l'envoi simultané (les deux appels envoient, Resend déduplique) | low | Corrigé (patch) : commentaire. |
| Données de l'email absentes : reste `en_attente`, contrairement à `deposer` | medium | Corrigé (patch) : `echec` / `donnees_absentes`, comme `deposer`. |
| `DROIT_INSUFFISANT` : bandeau « Réessayer » sans `refresh()` | low | Corrigé (patch) : `refresh()` comme les autres actions. |
| `router.refresh()` remplace la clé anti-doublon | low | Corrigé (patch) : clé gardée dans l'état du composant. |
| `categorieRefusee` jamais effacée si la catégorie reste listée | low | Corrigé (patch). |
| Rappel sur l'usage des données non relié pour les lecteurs d'écran | low | Corrigé (patch) : `aria-describedby` sur le bouton. |
| Second envoi encore `en_attente` non testé | medium | Corrigé (patch) : test d'action. |
| Catégorie désactivée après l'affichage non testée dans le navigateur | medium | Corrigé (patch) : test comme 1.3. |
| Pas de test navigateur du chemin email | low | Corrigé (patch). |
| Email de confirmation sans mention sur les données | low | Rejeté : l'intention fixe « la confirmation part comme pour le formulaire public ». |
| Modifications ignorées au rejeu de la même clé | false | Comportement voulu (AD-26 : un second envoi renvoie la même demande). |
| Test du compteur partagé non concurrent | low | Rejeté : le verrou de l'upsert date de 1.3 ; test concurrent coûteux. |
| Pas de test de composant `FormulaireSaisie` | low | Reporté : pas de banc de test de composants client (comme 2.2–2.5). |
| Pas de passage « téléphone » | false | `playwright.config.ts` lance chaque spec sur les projets ordinateur et téléphone. |
| Menu : pas de test des pages admin | low | Rejeté : improbable ; la règle du préfixe le plus long est testée. |
| Espaces Unicode non retirés par la base | low | Rejeté : même règle que `deposer_demande` (spec : mêmes règles de champs). |
| Aides de champs importées depuis `formulaire-depot.tsx` | low | Rejeté : aucun tort nommé. |
| Aucune catégorie active / lecture des catégories en échec après refresh | low | Rejeté : improbable, sans perte de données réelle en usage normal. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0020 (développement seulement). **Si refusée par les permissions, le signaler : la session principale la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- Dans l'aperçu : saisie par téléphone sans email ; ni email ni téléphone refusé.
- Ne rien commiter avant la vérification à l'écran.
