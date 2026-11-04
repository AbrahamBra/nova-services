---
title: 'Story 1.9 — Sécuriser la connexion'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '104f6f72bcbd0cd49975520029e5e4f30556b0fb'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-coursenia-2026-11-03/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** on peut essayer autant de mots de passe qu'on veut sur la page de connexion, et une session de l'équipe reste ouverte sans limite de durée.

**Approach :**
- Compter les tentatives de connexion par empreinte HMAC de l'email et de l'IP. Après 5 échecs de suite en 15 minutes, refuser toute connexion, même avec le bon mot de passe, et noter le blocage au journal.
- `proxy.ts` ferme les sessions ouvertes depuis plus de 8 h.
- Un script `npm run journal` affiche le journal de la base de développement.

## Boundaries & Constraints

**Always :**
- **Blocage (AD-21) :**
  - Il vise la même empreinte d'email (domaine `email`) **ou** la même empreinte d'IP (domaine `ip`), calculées par `lib/server/empreintes.ts`. L'IP est lue par `lib/server/adresse-ip.ts`. L'email est passé en minuscules, sans espaces.
  - « De suite » : on compte les échecs des 15 dernières minutes postérieurs à la dernière réussite de la même empreinte.
  - **Décision d'Abraham (relecture) :** pour l'empreinte d'IP, une réussite n'efface que les échecs du **même email** ; les échecs sur d'autres emails depuis cette IP continuent de compter (sinon un compte valide permettrait d'essayer des emails sans fin).
- **Comptage dans la base, sans course :**
  - Avant `signInWithPassword`, une fonction SQL prend un verrou sur les deux empreintes. Si 5 échecs sont déjà comptés, elle refuse (`CONNEXION_BLOQUEE`). Sinon, elle enregistre la tentative comme un échec par défaut et renvoie son identifiant.
  - Après la réponse d'Auth, une seconde fonction marque la tentative réussie, ou constate qu'elle vient de déclencher le blocage. Dans ce cas, elle écrit **une seule** ligne de journal de type `connexion`, auteur système, sans email ni IP en clair. Les détails disent ce qui est bloqué (`email`, `ip` ou les deux).
  - Un compte qui n'est pas un membre actif compte comme un échec.
  - Les tentatives de plus d'un jour sont effacées au passage.
  - Ces fonctions sont réservées à `service_role`. `tentatives_connexion` a la RLS activée et aucun droit pour personne.
- **Messages :**
  - Au 5ᵉ échec, puis pendant le blocage : « Trop de tentatives. Réessayez dans 15 minutes. » (code `CONNEXION_BLOQUEE` dans `lib/erreurs.ts`, test de concordance).
  - Avant ce 5ᵉ échec, le message reste « Email ou mot de passe incorrect. ».
- **Limite de 8 h (AD-21) :**
  - `lib/supabase/proxy.ts` lit l'heure de connexion dans les claims de la session (horodatage `amr` de la méthode `password`, qui ne change pas quand le jeton est rafraîchi). À vérifier en pratique, et à noter dans les Implementation Notes.
  - Au-delà de 8 h, ou si cette heure est introuvable : la session est fermée (`signOut`, cookies effacés), puis l'utilisateur est renvoyé vers `/connexion` avec un paramètre qui affiche le message d'expiration.
  - **Décision d'Abraham :** ce message est un bandeau d'information au-dessus du formulaire : « Votre session a expiré. Reconnectez-vous. »
  - Les appels d'action serveur ne sont pas redirigés, mais leur session est fermée de la même façon.
- **Mot de passe de 8 caractères minimum :** réglage Supabase, posé par Abraham dans le tableau de bord. Un test vérifie que la création d'un compte avec 7 caractères est refusée.
- **`npm run journal` :**
  - lit `journal` avec `SUPABASE_DB_URL`, garde-fou `SUPABASE_ENVIRONNEMENT=developpement` ;
  - affiche les 20 dernières lignes : date à l'heure de Paris, type, auteur (« Système » ou nom du membre), détails.
- Tests : uniquement des comptes `TEST-` jetables, et une IP de test propre à chaque test (`x-nova-ip-test`).

**Never :**
- Jamais d'email, de mot de passe ou d'IP en clair dans la base, le journal, les traces ou les erreurs.
- Pas de déblocage manuel, pas de « mot de passe oublié » (stories suivantes), pas de limite sur le formulaire public (story 1.8).

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| 4 échecs | 4 mauvais mots de passe | « Email ou mot de passe incorrect. » à chaque fois | — |
| 5ᵉ échec | 5ᵉ mauvais mot de passe | « Trop de tentatives… » ; une ligne de journal `connexion` | `CONNEXION_BLOQUEE` |
| Bon mot de passe bloqué | Bon mot de passe pendant le blocage | Refusé, même message ; pas de nouvelle ligne de journal | `CONNEXION_BLOQUEE` |
| Réussite entre deux | 3 échecs, une réussite, puis 3 échecs | Pas de blocage | — |
| Autre IP, même email | Email bloqué, autre IP | Refusé | `CONNEXION_BLOQUEE` |
| Même IP, autre email | 5 échecs sur des emails différents depuis une IP | IP bloquée | `CONNEXION_BLOQUEE` |
| Après 15 minutes | Échecs de plus de 15 min | Connexion à nouveau possible | — |
| Tentatives simultanées | 10 essais en parallèle, même email | Au plus 5 essais transmis à Auth | `CONNEXION_BLOQUEE` pour les autres |
| Session de 8 h | Connexion de plus de 8 h | Session fermée, retour à `/connexion` avec le message | — |
| Heure de connexion absente | Claims sans horodatage | Traité comme expiré | — |
| Base inspectée | `tentatives_connexion`, `journal` | Empreintes seulement | — |

</frozen-after-approval>

## Code Map

- `lib/actions/comptes.ts` -- action `connexion` : Zod → `signInWithPassword` → `profilDuClient` (membre actif sinon `fermerSession` + `refus`). Y ajouter les deux appels SQL autour d'Auth (clé secrète via `creerClientService` + `appeler`, comme `lib/actions/demandes.ts`).
- `lib/server/empreintes.ts` (domaine `email` déjà prévu), `lib/server/adresse-ip.ts` (`lireAdresseIp(await headers())`) -- à réutiliser tels quels.
- `supabase/migrations/20261103000011_envois_formulaire.sql` -- modèle : verrou `pg_advisory_xact_lock(hashtextextended(...))`, contrôle d'empreinte `^[0-9a-f]{64}$`, droits.
- `supabase/migrations/20261103000009_emails_journal.sql` -- `journal` et `prive.ecrire_journal(type, details, auteur_id default null)` ; type `connexion` déjà permis.
- `lib/supabase/proxy.ts` -- `mettreAJourSession` : `getClaims()` puis redirection ; ajouter la limite de 8 h après `getClaims`, sans rien placer entre la création du client et cet appel.
- `app/connexion/page.tsx`, `components/formulaire-connexion.tsx` -- message d'expiration (lire le paramètre côté serveur).
- `lib/erreurs.ts`, `tests/story-1-3/codes-erreur.test.ts` -- codes et concordance.
- `scripts/commun.ts`, `scripts/donnees.ts`, `package.json` -- modèle de script avec garde-fou (`node --conditions=react-server …`).
- `tests/outils/comptes.ts` (`creerCompteTest`, `supprimerComptesTest`, `avecBase`), `tests/outils/ip-test.ts`, `tests/story-1-4/*` -- comptes jetables et tests de connexion existants (leur donner une IP de test aléatoire).
- `tests/securite/*` -- listes de droits et de fonctions attendues.

## Tasks & Acceptance

**Execution :**
- [x] `supabase/migrations/20261103000012_tentatives_connexion.sql` -- table, RLS sans droit, deux fonctions (début verrouillé et fin avec journal), effacement au-delà d'un jour
- [x] `lib/actions/comptes.ts` -- empreintes, appels SQL autour d'Auth, `CONNEXION_BLOQUEE`
- [x] `lib/erreurs.ts` -- code `CONNEXION_BLOQUEE`
- [x] `lib/supabase/proxy.ts` -- limite de 8 h, fermeture et redirection
- [x] `app/connexion/page.tsx`, `components/formulaire-connexion.tsx` -- message d'expiration
- [x] `scripts/journal.ts`, `package.json` -- `npm run journal`
- [x] `tests/story-1-9/blocage.test.ts` -- base : tous les cas de la matrice, journal unique, droits, aucune donnée en clair
- [x] `tests/story-1-9/session.test.ts` -- proxy : moins de 8 h conservée, plus de 8 h fermée, horodatage absent ; mot de passe de 7 caractères refusé
- [x] `tests/story-1-9/connexion.spec.ts` -- navigateur : 5 échecs → message, bon mot de passe refusé ensuite ; axe
- [x] tests existants -- IP de test aléatoire pour les connexions ; listes de sécurité mises à jour
- [x] `docs/carnet-ia.md` -- ligne de la story 1.9

**Acceptance Criteria :**
- Given la migration appliquée et le réglage de 8 caractères posé, when on suit les critères 1 et 2 de la story 1.9 d'`epics.md`, then chacun est visible (écran et `npm run journal`).
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

- **Heure de connexion (vérifiée sur nova-dev, 04/11/2026) :** les claims de `getClaims()` contiennent `amr: [{ method: "password", timestamp }]` (secondes). Après `refreshSession()`, `iat` change mais `amr[].timestamp` reste identique : c'est bien l'heure de connexion. Test automatique : `tests/story-1-9/session.test.ts` (« vrai Supabase Auth »). `amr` au format texte (`["password"]`) ou sans horodatage → session expirée. Pas de cookie signé nécessaire (architecture §10, point 3). Depuis la relecture : l'horodatage le plus récent de toutes les entrées `amr` est retenu (sessions ouvertes par un lien, epic 4).
- **Mot de passe de 8 caractères :** réglage actif sur nova-dev (`updateUser` avec 7 caractères → `weak_password`). L'API d'administration (`auth.admin.createUser`) ne l'applique pas (vérifié : 7 caractères acceptés) et l'inscription libre est désactivée ; le test porte donc sur le choix du mot de passe par le membre connecté. Les créations par la clé secrète (scripts, invitations à venir) doivent vérifier la longueur elles-mêmes (`premier-admin.ts` le fait).
- **Comptage (corrigé par la migration 0013) :** `commencer_connexion` enregistre la tentative avant Auth (`reussie` = null, compte comme un échec) ; `terminer_connexion` la passe à `true`/`false`, une seule fois, ou la supprime (`null`) en cas d'erreur serveur (Auth 5xx/429/exception, `mon_profil` en erreur) : une panne ne bloque personne. Domaine IP : une réussite n'efface que les échecs du même email depuis cette IP. Le blocage dure 15 minutes à partir de l'échec qui l'a déclenché (`bloque_email_le` / `bloque_ip_le`) ; ensuite, 5 nouveaux échecs bloquent à nouveau, avec une nouvelle ligne de journal (une par épisode). Détails du journal : `{ evenement: "connexion_bloquee", bloque: "email" | "ip" | "email_et_ip", duree_minutes: 15 }`.
- **Proxy :** la session expirée est fermée par `signOut({ scope: "local" })`, puis les cookies `sb-` sont retirés de la requête et effacés dans la réponse même si Auth ne répond pas. Redirection vers `/connexion?expiree=1` (avec `retour` pour `/equipe/*`) ; sur `/connexion?expiree=1`, pas de nouvelle redirection (pas de boucle).
- **Tests de l'action :** Auth y est simulé (la base reste réelle) : de vraies connexions en série dépassent la limite d'appels d'Auth (429) et font échouer les autres tests. Les vraies connexions sont couvertes par `session.test.ts` et `connexion.spec.ts`.
- **`HMAC_SECRET` absent de `.env.local` :** en développement, la clé de repli change à chaque redémarrage du serveur, ce qui remet les blocages à zéro. Sans effet en production (secret obligatoire).

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| Une réussite depuis une IP efface toute la série d'échecs de cette IP : essais d'emails sans fin avec un compte valide | high | Décision d'Abraham ; corrigé (patch) : pour l'IP, seule une réussite du même email efface ses échecs. |
| Fenêtre glissante : blocage parfois levé en quelques secondes, message « 15 minutes » faux ; second épisode non journalisé | medium | Corrigé (patch) : blocage fixe de 15 minutes après l'échec déclencheur ; une ligne de journal par épisode. |
| Panne d'Auth (5xx, 429) ou de `mon_profil` comptée comme échec : l'équipe bloquée pendant un incident | medium | Corrigé (patch) : erreur serveur non comptée, message d'erreur serveur conservé ; branches testées. |
| Échec d'enregistrement d'une réussite ignoré sans trace | low | Corrigé (patch) : trace sans email ni IP. |
| Seul l'`amr` `password` donne l'heure de connexion : sessions d'invitation ou de récupération (epic 4) fermées aussitôt | low | Corrigé (patch) : horodatage le plus récent parmi tous les `amr`. |
| `retour` perdu sur `/connexion` quand la session expire | low | Corrigé (patch). |
| Test de confidentialité comparé à la nouvelle IP : ne vérifie rien | low | Corrigé (patch). |
| Verrou jamais prouvé par un test (essais simultanés passent sans lui) | medium | Corrigé (patch) : test déterministe à deux connexions. |
| Limite de 8 h appliquée par l'application seulement ; un cookie volé reste utilisable directement auprès de Supabase | medium | Reporté : limite de session de Supabase réservée à l'offre payante (AD-21). |
| Blocage volontaire du compte d'un membre ; journal sans identifiant du membre ; pas de déblocage | medium | Reporté : déblocage et identification à décider (epic 5, journal). |
| Tentatives effacées seulement à la connexion suivante | medium | Reporté : `purger_technique` nocturne prévue (AD-23). |
| `HMAC_SECRET` ou en-tête Netlify absent en production : connexion de l'équipe impossible | medium | Reporté : même point que la story 1.8 (3.1, 3.3). |
| Action serveur après expiration : pas de message d'expiration | low | Rejeté : la navigation suivante renvoie à la connexion avec le message ; l'action revérifie la session. |
| Chaîne complète d'expiration non testée dans le navigateur | low | Rejeté : redirection couverte par le test du proxy, bandeau par le test navigateur. |
| `?expiree=0` ou paramètre répété | low | Rejeté : adresses jamais produites par l'application. |
| Clé de repli de développement : blocages perdus au redémarrage | low | Rejeté : développement seulement, documenté. |
| Connexions simultanées d'un bureau comptées en cours comme échecs | low | Rejeté : une tentative en cours dure moins d'une seconde. |
| Ordre de la série par date de début plutôt que de fin | low | Rejeté : écart de quelques millisecondes. |
| `docs/carnet-ia.md` absent du diff | false | Fichier modifié (ligne 1.9 présente) ; seulement exclu du diff de relecture. |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0012 appliquée. **Si refusée par les permissions, le signaler : Abraham la lancera.**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` -- tout vert

**Manual checks :**
- 5 mauvais mots de passe sur un compte `TEST-` dans l'aperçu, puis le bon : refusé ; `npm run journal` montre la ligne.
- Ne rien commiter avant la vérification à l'écran.
