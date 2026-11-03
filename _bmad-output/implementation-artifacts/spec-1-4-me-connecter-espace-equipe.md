---
title: 'Story 1.4 — Me connecter à l''espace équipe'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'be13bfe35a4ca51dac87e22f795f753103c4eebc'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-coursenia-2026-11-03/EXPERIENCE.md'
  - '{project-root}/node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md'
  - '{project-root}/node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** l'équipe n'a aucun moyen de se connecter. Il n'existe ni comptes ni espace réservé, et rien ne protège les futures pages internes.

**Approach :** créer la table `membres` (source unique des rôles et des états, AD-3) et les fonctions de droits. Ajouter une page `/connexion` avec une action serveur (aucun client Supabase dans le navigateur), puis `proxy.ts` pour rafraîchir la session et renvoyer vers la connexion. Prévoir un espace `/equipe` avec son menu latéral et une page d'accueil « Bonjour [prénom] », et une zone `/equipe/admin` réservée aux administrateurs. Des scripts créent le premier administrateur et les comptes de test.

## Boundaries & Constraints

**Always :**
- `membres` : `id` = identifiant du compte Supabase Auth, nom, email (minuscules, unique), rôle (`collaborateur` | `administrateur`), état (`invite` | `actif` | `desactive`), dates. RLS activée. Aucun droit direct pour `anon`, `authenticated` ni `service_role` (AD-2, migration 0004).
- Clés étrangères vers `membres` ajoutées sur `demandes.responsable_id`, `demandes.saisie_par_id` et `historique.auteur_id`.
- `prive.est_membre_actif()` et `prive.est_admin()` : `SECURITY DEFINER STABLE`, lisent `membres` via `auth.uid()` ; utilisées par toutes les futures règles RLS (AD-3). Le rôle n'est jamais lu dans les métadonnées Auth.
- `mon_profil()` : renvoie au membre connecté **actif** son nom, son rôle et son état, et rien d'autre ; `null` sinon. `EXECUTE` à `authenticated`.
- `creer_membre(id, nom, email, role, etat)` : `EXECUTE` à `service_role` seul ; état `actif` à la création réservé aux scripts (les invitations, story 4.1, passeront par `invite`). Aucun déclencheur sur `auth.users` (AD-17).
- Connexion par action serveur : `signInWithPassword` avec le client serveur (clé publiable, cookies), puis `mon_profil()`. Si le compte n'est pas un membre actif : déconnexion immédiate et **même** message que pour un mauvais mot de passe : « Email ou mot de passe incorrect. ». Ce message ne révèle jamais si l'email existe.
- Après connexion : retour à l'adresse demandée seulement si elle commence par `/equipe` (sinon `/equipe`).
- `proxy.ts` (Next 16, voir le guide local) : rafraîchit la session (`getClaims()`) ; toute adresse `/equipe/*` sans session renvoie vers `/connexion?retour=…` (AD-28).
- `app/equipe/layout.tsx` vérifie le membre actif ; `app/equipe/admin/layout.tsx` vérifie le rôle administrateur, sinon « Vous n'avez pas accès à cette page. » avec un retour à l'accueil. Chaque action serveur revérifie la session (AD-1).
- Menu latéral bleu marine (UX-DR3) : **seulement les rubriques qui existent** (Accueil ; groupe « Administration » avec une page provisoire, visible des seuls administrateurs) ; en bas, nom, rôle et « Se déconnecter ». Sous 1 024 px, le menu se replie derrière un bouton « Menu ».
- Accueil `/equipe` : « Bonjour [prénom] », le prénom étant le premier mot du nom.
- Lien discret « Espace équipe » en bas du formulaire public.
- **Scripts :**
  - `scripts/premier-admin.ts` : demande le nom, l'email et le mot de passe (saisie masquée) à la personne qui le lance ; rien n'est écrit dans le code ni affiché.
  - `scripts/comptes-de-test.ts` : crée `TEST-Admin` et `TEST-Collaborateur` en développement, avec des mots de passe aléatoires écrits **seulement** dans `.env.local`, jamais affichés.
  - Les deux scripts refusent de tourner hors `developpement` (option `--production` réservée à la story 3.1).
- Les tests automatiques créent et suppriment leurs propres comptes `TEST-…` : ils n'utilisent ni le compte d'Abraham ni les comptes de test persistants.

**Never :**
- Pas de blocage après 5 échecs ni de limite de 8 h (story 1.9), pas de mot de passe oublié ni d'invitation (epic 4), pas de liste de demandes (story 1.5).
- Aucun client Supabase dans le navigateur ; aucun rôle dans les métadonnées Auth.

## I/O & Edge-Case Matrix

| Scénario | Entrée / État | Résultat attendu | Erreur |
|---|---|---|---|
| Connexion admin | Bon email et mot de passe, membre actif administrateur | `/equipe`, « Bonjour [prénom] », menu avec Administration, nom et rôle en bas | — |
| Mauvais mot de passe | Email existant, mauvais mot de passe | « Email ou mot de passe incorrect. », email conservé | — |
| Email inconnu | Email absent | Même message | — |
| Compte désactivé ou invité | Bon mot de passe, état `desactive` ou `invite` | Même message, session fermée | — |
| Page interne sans session | `/equipe` tapée directement | `/connexion?retour=/equipe`, puis retour à `/equipe` après connexion | — |
| Retour vers l'extérieur | `retour=https://exemple.com` | Après connexion : `/equipe` | — |
| Collaborateur sur l'administration | Collaborateur actif sur `/equipe/admin` | « Vous n'avez pas accès à cette page. » | — |
| Déconnexion | « Se déconnecter », puis rechargement d'une page interne | Page de connexion | — |
| `mon_profil` d'un autre | Membre connecté | Uniquement son propre profil | — |
| Appel direct de `creer_membre` | Clé publiable ou session `authenticated` | Refusé | Droit `EXECUTE` absent |

</frozen-after-approval>

## Code Map

- `lib/supabase/serveur.ts` -- client serveur avec cookies (clé publiable) ; à réutiliser pour la connexion et les lectures avec session. Son commentaire annonce que `proxy.ts` rafraîchit la session.
- `lib/server/supabase-service.ts` -- client clé secrète : pour les scripts (API d'administration Auth + `creer_membre`).
- `lib/server/appeler.ts`, `lib/erreurs.ts`, `lib/domaine.ts` (`ROLES`, `ETATS_MEMBRE`) -- à réutiliser ; ne pas recopier les codes.
- `components/nova/bouton.tsx`, `components/ui/*` -- bouton et champs ; envelopper, ne pas modifier.
- `components/formulaire-depot.tsx` -- y ajouter seulement le lien « Espace équipe » en pied de page.
- `supabase/migrations/20261103000003_demandes.sql` -- colonnes `responsable_id`, `saisie_par_id`, `historique.auteur_id` sans clé étrangère (commentaires « story 1.4 »).
- `supabase/migrations/20261103000004_droits_service_role.sql` -- `service_role` sans droit direct sur les tables : y ajouter `membres` dans la nouvelle migration.
- `scripts/db-push.mjs`, `scripts/secrets-github.mjs` -- modèle de chargement de `.env.local` et de garde-fou d'environnement à reprendre pour les scripts.
- `tests/securite/*` -- doivent rester verts ; compléter la liste attendue des fonctions exécutables par rôle.
- `next.config.ts` -- `devIndicators: false` : à garder.

## Tasks & Acceptance

**Execution :**
- [ ] `supabase/migrations/20261103000005_membres.sql` -- table `membres`, RLS, clés étrangères sur `demandes` et `historique`, `prive.est_membre_actif`, `prive.est_admin`, `mon_profil`, `creer_membre`, droits nominatifs, aucun droit direct sur la table pour `service_role`
- [ ] `lib/erreurs.ts` -- message de connexion refusée, et codes éventuels de `creer_membre`
- [ ] `lib/schemas/connexion.ts` -- Zod : email normalisé, mot de passe non vide
- [ ] `lib/actions/comptes.ts` -- actions `connexion` et `deconnexion`
- [ ] `lib/session.ts` (`server-only`) -- lecture du profil du membre connecté via `mon_profil()`
- [ ] `proxy.ts`, `lib/supabase/proxy.ts` -- rafraîchissement de la session et garde de `/equipe/*`
- [ ] `app/connexion/page.tsx`, `components/formulaire-connexion.tsx` -- page de connexion (EXPERIENCE.md §9.12)
- [ ] `app/equipe/layout.tsx`, `components/nova/menu-equipe.tsx` -- espace équipe, menu latéral repliable
- [ ] `app/equipe/page.tsx` -- « Bonjour [prénom] »
- [ ] `app/equipe/admin/layout.tsx`, `app/equipe/admin/page.tsx`, `components/nova/acces-refuse.tsx` -- zone administrateur et page provisoire
- [ ] `components/formulaire-depot.tsx` -- lien « Espace équipe »
- [ ] `scripts/premier-admin.ts`, `scripts/comptes-de-test.ts`, `package.json` -- scripts `admin:creer` et `comptes:test` ; `.env.example` complété (`TEST_ADMIN_EMAIL`, `TEST_ADMIN_MOT_DE_PASSE`, `TEST_COLLAB_EMAIL`, `TEST_COLLAB_MOT_DE_PASSE`, sans valeur)
- [ ] `tests/outils/comptes.ts` -- création et suppression de comptes `TEST-…` jetables pour les tests
- [ ] `tests/story-1-4/membres.test.ts` -- base : `mon_profil` (actif, invité, désactivé, autre membre), droits `EXECUTE`, unicité de l'email, clés étrangères
- [ ] `tests/story-1-4/connexion.spec.ts` -- navigateur : tous les scénarios de la matrice, menu replié sous 1 024 px, axe sur `/connexion`, `/equipe` et la page de refus
- [ ] `docs/carnet-ia.md` -- ligne de la story 1.4 (colonne d'Abraham à compléter)

**Acceptance Criteria :**
- Given la migration appliquée et les comptes créés, when Abraham suit les critères 1 à 4 de la story 1.4 d'`epics.md`, then chacun est visible à l'écran.
- Given tous les tests, when `npm test` et `npm run test:e2e`, then tout est vert.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Constat | Verdict | Preuve / décision |
|---|---|---|
| `retour` avec segments `..` sort de `/equipe` | medium | Corrigé (patch) : adresse résolue par `new URL`, cas testés. |
| Erreur passagère de `getClaims` = déconnexion | medium | Corrigé (patch) : état d'erreur, seule l'absence de session vaut « pas de profil ». |
| Retour à la page demandée non testé ; perdu dans la mise en page | medium | Corrigé (patch) : en-tête interne `x-nova-chemin`, test navigateur. |
| Désactivation ou rétrogradation pendant une session non testée | medium | Corrigé (patch) : tests navigateur. |
| Membre déjà connecté sur `/connexion` | low | Corrigé (patch) : renvoyé vers `/equipe` ou `retour`. |
| Refus d'Auth sans code (400) affiché comme erreur serveur | low | Corrigé (patch). |
| Déconnexion : cookies conservés si le client échoue | low | Corrigé (patch). |
| POST d'action serveur redirigé en 307 par le proxy | low | Corrigé (patch). |
| Menu mobile : focus, Échap, élargissement | low | Corrigé (patch) ; verrouillage du défilement et `inert` reportés. |
| Lien « Espace équipe » dans le `<form>` | low | Corrigé (patch) : pied de page de `app/page.tsx`. |
| Titre « Administration » sur la page de refus | low | Corrigé (patch) : « Accès refusé — Nova Services ». |
| Script des comptes de test : mot de passe perdu, compte existant non vérifié | medium | Corrigé (patch). |
| Script du premier admin : plusieurs admins, retour arrière non vérifié | medium | Corrigé (patch) : migration 0006, option `--encore`. |
| Nettoyage des comptes de test fragile | low | Corrigé (patch). |
| Tests instables avec 6 processus | low | Corrigé (patch) : 3 en local. |
| Version de Node non documentée | low | Corrigé (patch) : `engines` ≥ 22.18. |
| Quatre règles d'email différentes | low | Rejeté : Zod fait foi pour la saisie (décision de la story 1.3). |
| `membres.email` peut diverger de l'email Auth | low | Rejeté : aucun changement d'email prévu dans le produit. |
| Email effacé sans JavaScript | low | Rejeté : l'application exige JavaScript. |
| `allowImportingTsExtensions` global | low | Rejeté : sans effet sur le build (`noEmit`). |
| Chemins d'échec (Auth, `mon_profil`) non testés avec un client simulé | medium | Reporté à la story 1.9 (même action). |
| Rubrique active par égalité exacte | low | Reporté : à revoir quand l'administration aura des sous-pages (epic 4). |

## Verification

**Commands :**
- `npm run db:push -- --yes` -- migration 0005 appliquée. **Si cette commande est refusée par les permissions, ne pas insister : le signaler, Abraham la lancera lui-même.** Idem pour `npm run comptes:test` ; `npm run admin:creer` est toujours lancé par Abraham (il saisit son mot de passe).
- `npm run lint`, `npm run typecheck` -- aucune erreur
- `npm test`, `npm run test:e2e` -- tous verts

**Manual checks :**
- Dans le tableau de bord Supabase, Abraham désactive les inscriptions libres (Authentication → Sign In / Providers → « Allow new users to sign up » désactivé).
- Ne rien commiter : Abraham vérifie d'abord à l'écran.
