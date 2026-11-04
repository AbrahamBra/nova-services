---
title: 'Story 1.8 — Bloquer les envois en masse'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '7bee528700ad3c0bb1b25be171b489ab8c6d93ce'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-coursenia-2026-11-03/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** le formulaire public accepte un nombre illimité d'envois. Un robot ou une personne malveillante peut remplir la base de fausses demandes.

**Approach :** deux protections, toutes deux vérifiées côté serveur.
1. Un **champ piège**, invisible pour les humains, que les robots remplissent.
2. Une **limite de 5 envois en 10 minutes par adresse internet**. L'adresse IP n'est jamais stockée en clair : seulement une empreinte HMAC, effacée au-delà d'une heure.

Le comptage et l'enregistrement se font dans la même fonction SQL : deux envois simultanés ne peuvent pas dépasser la limite.

## Boundaries & Constraints

**Always :**
- **Ordre dans l'action `deposer`** (AD-16) : champ piège → validation Zod → appel de `deposer_demande` avec l'empreinte d'IP.
- **Le champ piège :**
  - invisible à l'écran, ignoré par les lecteurs d'écran (`aria-hidden`), hors du parcours clavier (`tabindex="-1"`), sans saisie automatique ;
  - **choix de construction :** s'il est rempli, rien n'est enregistré et la page affiche un message neutre, « Votre demande n'a pas pu être envoyée. Réessayez plus tard. », sans indiquer la raison.
- **La limite :**
  - `deposer_demande` reçoit l'empreinte HMAC de l'IP, compte les envois de cette empreinte des 10 dernières minutes, refuse au-delà de 5 (`TROP_D_ENVOIS`), puis enregistre l'envoi dans `envois_formulaire` et efface les empreintes de plus d'une heure, le tout en une seule transaction (verrou sur l'empreinte) ;
  - un renvoi avec la même `cle_envoi` (demande déjà enregistrée) ne compte pas comme un nouvel envoi.
- **Message de refus :** « Trop d'envois depuis votre connexion. Réessayez dans quelques minutes. » Il s'affiche sous forme de bandeau, la saisie est conservée, et aucune page de confirmation n'apparaît.
- **Empreinte :** `lib/server/empreintes.ts` calcule un HMAC-SHA-256 avec `HMAC_SECRET` (lu seulement dans `lib/server/`).
  - En production, si `HMAC_SECRET` manque, le dépôt est refusé et une erreur est tracée.
  - Hors production (développement, CI), si elle manque, une clé aléatoire est tirée au démarrage du serveur, avec un avertissement (les empreintes ne durent qu'une heure : sans conséquence).
- **Adresse IP :**
  - sur Netlify, uniquement l'en-tête `x-nf-client-connection-ip` ;
  - en local, `x-forwarded-for` (premier élément), puis `127.0.0.1` ;
  - **pour les tests seulement** : si la variable `IP_DE_TEST_AUTORISEE=1` est présente (posée par la configuration Playwright, jamais sur Netlify), l'en-tête `x-nova-ip-test` remplace l'IP. Chaque test dépose ainsi avec sa propre IP, sans gêner les autres.
- `envois_formulaire` : RLS activée, aucun droit pour personne ; seule `deposer_demande` y écrit.
- Codes d'erreur dans `lib/erreurs.ts`, avec le test de concordance ; `.env.example` complété (`HMAC_SECRET`, `IP_DE_TEST_AUTORISEE`, sans valeur).

**Never :**
- Jamais d'IP en clair dans la base, les journaux ou les messages d'erreur.
- Pas de limite sur la saisie interne (story 2.6) ni sur la connexion (story 1.9).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Envois normaux | 5 envois en 10 min depuis la même IP | Les 5 sont enregistrés, chacun avec sa confirmation | — |
| 6ᵉ envoi | 6ᵉ envoi dans les 10 min | Bandeau « Trop d'envois depuis votre connexion… », saisie conservée, rien d'enregistré | `TROP_D_ENVOIS` |
| Après 10 minutes | Envois les plus anciens de plus de 10 min | Nouvel envoi accepté | — |
| Autre IP | 6ᵉ envoi depuis une autre IP | Accepté | — |
| Double clic | Même `cle_envoi` renvoyée | Pas compté une seconde fois | — |
| Envois simultanés | 10 envois en parallèle, même IP | Exactement 5 enregistrés | `TROP_D_ENVOIS` pour les autres |
| Champ piège rempli | Valeur dans le champ caché | Rien d'enregistré ; message neutre | — |
| Appel direct | Appel de `deposer_demande` sans passer par la page, avec la clé secrète, au-delà de la limite | Refusé par la base | `TROP_D_ENVOIS` |
| Empreintes anciennes | Empreintes de plus d'une heure | Effacées à l'envoi suivant | — |
| Base inspectée | Lecture de `envois_formulaire` | Seulement des empreintes ; aucune IP en clair | — |

</frozen-after-approval>

## Code Map

- `lib/actions/demandes.ts` -- action `deposer` : Zod, `deposer_demande`, puis email (story 1.7). Y ajouter le champ piège et l'empreinte d'IP (`headers()` de Next).
- `components/formulaire-depot.tsx` -- y ajouter le champ piège et le bandeau de refus (le bandeau d'erreur générale existe déjà).
- `supabase/migrations/20261103000010_email_en_attente_journal.sql` -- dernière version de `deposer_demande` (signature et retour). La remplacer en ajoutant `p_empreinte_ip` ; les anciens appels doivent recevoir une erreur claire, ou la signature est remplacée partout, tests compris.
- `lib/server/` (`appeler.ts`, `emails.ts`, `supabase-service.ts`) -- modèle des modules serveur.
- `lib/erreurs.ts`, `tests/story-1-3/codes-erreur.test.ts` -- codes et concordance.
- `playwright.config.ts` -- `webServer` : y poser `IP_DE_TEST_AUTORISEE=1` (en local et en CI).
- `tests/outils/demandes.ts`, `tests/story-1-3/*`, `tests/story-1-7/*` -- dépôts existants : leur faire envoyer une IP de test aléatoire pour ne pas atteindre la limite.
- `tests/securite/*` -- listes de droits et de fonctions attendues.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000011_envois_formulaire.sql` -- table `envois_formulaire` (empreinte, date, `cle_envoi`), RLS sans droit, `deposer_demande` avec limite atomique et effacement à une heure
- [x] `lib/server/empreintes.ts` -- HMAC, clé de repli hors production, refus en production
- [x] `lib/server/adresse-ip.ts` -- lecture de l'IP selon l'environnement, en-tête de test conditionnel
- [x] `lib/actions/demandes.ts` -- champ piège, empreinte, gestion de `TROP_D_ENVOIS`
- [x] `components/formulaire-depot.tsx` -- champ piège, bandeau de refus
- [x] `lib/erreurs.ts`, `.env.example`, `playwright.config.ts`
- [x] `tests/story-1-8/limite.test.ts` -- base : 5 acceptés puis refus, autre empreinte acceptée, même clé non comptée, envois simultanés, empreintes de plus d'une heure effacées, aucune IP en clair, droits
- [x] `tests/story-1-8/empreintes.test.ts` -- HMAC stable avec la même clé, différent avec une autre ; repli hors production ; refus en production ; lecture de l'IP selon l'environnement
- [x] `tests/story-1-8/anti-spam.spec.ts` -- navigateur : 6ᵉ envoi refusé avec le bandeau et la saisie conservée ; champ piège invisible et hors du parcours clavier ; champ piège rempli → rien d'enregistré ; axe
- [x] tests existants -- IP de test aléatoire pour chaque dépôt ; listes de sécurité mises à jour
- [x] `docs/carnet-ia.md` -- ligne de la story 1.8 (colonne d'Abraham à compléter)

**Acceptance Criteria :**
- Given la migration appliquée, when on suit les critères 1 et 2 de la story 1.8 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Détection « sur Netlify » différente d'empreintes.ts : environnement absent → x-forwarded-for falsifiable | high | Corrigé (patch) : fermé par défaut, en-tête Netlify seul hors développement. |
| Prévisualisation Netlify : NETLIFY peut-être absent à l'exécution → x-forwarded-for | medium | Corrigé (patch) : en développement, x-nf-client-connection-ip prioritaire s'il est présent ; à revérifier sur une prévisualisation (3.1). |
| x-forwarded-for commençant par un élément vide → 127.0.0.1 | low | Corrigé (patch) avec le précédent. |
| Seconde recherche de cle_envoi après le verrou jamais testée | medium | Corrigé (patch) : test déterministe à deux connexions. |
| Champ piège et refus de limite sans trace ; cause de l'exception non tracée | low | Corrigé (patch) : avertissements sans IP ni saisie, nom de l'erreur. |
| Test clavier : 25 Tab sans vérifier qu'on dépasse le champ piège | low | Corrigé (patch). |
| Serveur lancé à la main réutilisé par Playwright → faux « Trop d'envois » | low | Corrigé (patch) : port dédié aux tests. |
| Empreintes effacées seulement au dépôt suivant (pas de purge planifiée) | medium | Reporté : conforme à la matrice (« effacées à l'envoi suivant ») ; purge planifiée à voir avec l'exploitation (3.x). |
| IPv6 : une adresse par client, pas de regroupement /64, formes d'écriture multiples | medium | Reporté : l'intention dit « par adresse internet » ; regroupement /64 à décider avant la mise en ligne. |
| HMAC_SECRET absent en production : formulaire en panne, seule trace console | medium | Reporté : variable à poser sur Netlify (3.1), alerte Sentry (3.3). Clé de repli différente par instance sur une prévisualisation sans secret : même report. |
| Demande supprimée dans l'heure puis même cle_envoi → unique_violation relancée | low | Rejeté : clés aléatoires, aucune suppression de demande dans le produit à ce stade. |
| cree_le = now() (début de transaction) après une attente de verrou | low | Rejeté : attente de quelques millisecondes, sans effet sur une fenêtre de 10 minutes. |
| Remplissage automatique du champ piège par le navigateur | low | Rejeté : `autocomplete=off`, champ hors écran et sans type d'adresse reconnu ; aucun cas observé. |
| Migration et code à déployer ensemble | low | Rejeté : rien n'est encore en production ; la mise en ligne (3.1) applique les migrations avant le code. |
| Bureaux derrière une même IP bloqués à 5 envois | low | Rejeté : seuil fixé par l'intention (AD-16). |
| Test « toutes les lignes sont des empreintes » redondant | low | Rejeté : redondance sans dommage. |
| Champ piège hors écran → défilement horizontal | false | Un décalage à gauche négatif ne crée pas de zone de défilement ; vérifié par le test de mise en page 1.2. |
| Lignes orphelines d'envois après le nettoyage des tests | low | Rejeté : effacées au bout d'une heure par le dépôt suivant. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0011 appliquée. **Si refusée par les permissions, le signaler : Abraham la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- 6 envois de suite dans l'aperçu (sans l'en-tête de test) : le 6ᵉ est refusé.
- Ne rien commiter avant la vérification à l'écran.
