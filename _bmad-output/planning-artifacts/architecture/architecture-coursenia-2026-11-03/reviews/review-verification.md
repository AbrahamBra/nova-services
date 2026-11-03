# Revue « vérification » — architecture.md (Nova Services)

- **Angle :** chaque décision engagée a-t-elle été vérifiée sur le web ou dans le projet, et non affirmée de mémoire ? (versions, existence et adéquation des outils, défauts actuels du modèle de départ)
- **Date de la revue :** 03/11/2026
- **Spine relue :** `../architecture.md` (non modifiée) ; journal `../.memlog.md`
- **Méthode :** `npm view` (03/11/2026), documentation officielle (nextjs.org, supabase.com, docs.netlify.com, docs.sentry.io, resend.com, ui.shadcn.com), `npx shadcn@4.23.0 init --help`.

## Synthèse

| Gravité | Nombre |
|---|---|
| Critique | 1 |
| Haute | 5 |
| Moyenne | 4 |
| Basse | 3 |

Les versions npm du §1 sont exactes (re-vérifiées : next 16.4.4, create-next-app 16.4.4, @supabase/ssr 0.12.7, @sentry/nextjs 11.10.0, shadcn 4.23.0, tailwindcss 4.3.4, resend 6.37.0). Les problèmes viennent surtout des **défauts et limites des services**, non vérifiés ou vérifiés seulement par des sources tierces.

---

## V-1 — Sentry 11 collecte par défaut corps HTTP et adresse IP (contredit AD-14) — **CRITIQUE**

- **Affirmé dans la spine :** AD-14 et §2 : « Sentry reçoit le type d'erreur, l'écran et la référence de la demande, jamais un nom, un email, un téléphone ou une description » ; §1 « installation guidée pour Next.js ».
- **Constaté :** depuis la v11 du SDK JavaScript, l'option `dataCollection` remplace `sendDefaultPii` et devient le comportement par défaut. Dans ce mode, le SDK **envoie l'adresse IP** de l'utilisateur et **collecte les corps des requêtes entrantes et sortantes** (et des réponses) par défaut. Le formulaire public (nom, email, téléphone, description) serait donc envoyé à Sentry à chaque erreur dans une action serveur. Le guide Next.js (assistant `npx @sentry/wizard@latest -i nextjs`) active aussi Session Replay et `tracesSampleRate: 1.0`. Par ailleurs, la région de données Sentry (US ou UE) se choisit à la création de l'organisation et n'est pas mentionnée, alors que Supabase est volontairement à Paris.
- **Sources :**
  - https://blog.sentry.io/datacollection-control-panel
  - https://docs.sentry.io/platforms/javascript/guides/remix/data-management/data-collected/
  - https://docs.sentry.io/platforms/javascript/guides/nextjs/
- **Correction proposée :** ajouter à AD-14 une règle de configuration obligatoire dans `instrumentation-client.ts`, `sentry.server.config.ts` et `sentry.edge.config.ts` : `dataCollection: { userInfo: false, cookies: false, httpBodies: [] }`, pas de Session Replay (ou masquage total), `beforeSend` qui retire `request.data` et les paramètres d'URL, et un test automatique qui vérifie ces options. Créer l'organisation Sentry dans la **région UE** (sentry.io, région « EU » à la création).

## V-2 — Durée de session de 8 heures : réglage réservé à l'offre Pro — **HAUTE**

- **Affirmé dans la spine :** §4.1 « déconnexion après 8 heures … (réglages de Supabase Auth, NFR-9) » ; hypothèse 3 « réglables dans Supabase Auth ; à vérifier ».
- **Constaté :** la page officielle des sessions indique que « Time-box user sessions » et « Inactivity timeout » sont disponibles **uniquement à partir de l'offre Pro**. La page tarifs liste « Session timeouts » et « Single session per user » comme fonctions Pro. De plus, même en Pro, les sessions ne sont pas coupées à l'heure exacte (effet au prochain rafraîchissement, durée réelle = délai + expiration du JWT, 1 h par défaut).
- **Sources :**
  - https://supabase.com/docs/guides/auth/sessions
  - https://supabase.com/pricing
- **Correction proposée :** remplacer « réglage Supabase » par une décision ferme : la limite de 8 heures est appliquée par l'application, dans `proxy.ts` (voir V-5). On lit l'heure de connexion dans les claims (`getClaims()`, champ `amr[].timestamp`, à confirmer dans la story) ; au-delà de 8 h, `signOut()` et redirection vers la connexion. Ajouter un test. Retirer l'hypothèse 3 pour ce point.

## V-3 — « Blocage après 5 échecs de connexion » n'existe pas dans Supabase Auth — **HAUTE**

- **Affirmé dans la spine :** §4.1 « blocage temporaire après 5 échecs de connexion (réglages de Supabase Auth, NFR-9) » ; hypothèse 3 « sinon, on les applique dans l'action de connexion » ; AD-1 « Seule la connexion utilise le client Supabase dans le navigateur ».
- **Constaté :** Supabase Auth ne propose **aucun verrouillage de compte après N échecs**, quelle que soit l'offre. Il n'y a que des limites de débit **par adresse IP** (point `/token` : 150 requêtes par 5 minutes, réglables) et un CAPTCHA optionnel. Contradiction interne : si la connexion se fait dans le navigateur (AD-1), le serveur ne voit pas les échecs et ne peut pas les compter.
- **Sources :**
  - https://supabase.com/docs/guides/auth/rate-limits
  - https://supabase.com/docs/guides/auth/sessions
- **Correction proposée :** décider maintenant : la connexion passe par une **action serveur** (`signInWithPassword` avec le client serveur `@supabase/ssr`), et non par le navigateur. Une table `tentatives_connexion` (empreinte de l'email, date), écrite par une fonction SQL, compte les échecs : au 5e échec en 15 minutes, l'action refuse pendant N minutes sans appeler Supabase. Corriger AD-1 (le navigateur n'utilise plus du tout Supabase) et ajouter la table au §3.

## V-4 — Clés Supabase `anon` / `service_role` en fin de vie (fin 2026) — **HAUTE**

- **Affirmé dans la spine :** AD-9 et §2 « clé de service », rôles `anon`, `authenticated` ; le journal de décisions ne mentionne pas le type de clés.
- **Constaté :** Supabase remplace les clés JWT historiques par des **clés publiables** (`sb_publishable_…`) et **secrètes** (`sb_secret_…`), et annonce la dépréciation des clés `anon` et `service_role` « d'ici fin 2026 ». Le guide officiel Next.js utilise déjà `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, sans mention de `ANON_KEY`. Un projet démarré en novembre 2026 sur les anciennes clés devra migrer dans quelques semaines. Les rôles Postgres `anon` et `authenticated` restent valables pour les règles RLS.
- **Sources :**
  - https://supabase.com/docs/guides/api/api-keys
  - https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
  - https://supabase.com/docs/guides/auth/server-side/nextjs
- **Correction proposée :** dans AD-9, imposer les nouvelles clés et nommer les variables : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (si encore utile, voir V-3), `SUPABASE_SECRET_KEY` (lue seulement dans `lib/server/`). Désactiver les clés historiques dans les deux projets. Préciser que les rôles `anon` et `authenticated` restent les rôles Postgres utilisés par les règles RLS.

## V-5 — Next.js 16 : `middleware.ts` est devenu `proxy.ts`, absent de la spine — **HAUTE**

- **Affirmé dans la spine :** AD-1 « via `@supabase/ssr` » ; §7 ne contient aucun fichier de proxy ou middleware.
- **Constaté :** Next.js 16 renomme la convention `middleware.ts` en **`proxy.ts`** (fonction exportée `proxy`, exécution Node.js par défaut ; `middleware.ts` est déprécié et avoir les deux fichiers provoque une erreur de build). Le guide officiel Supabase pour Next.js utilise `proxy.ts`, qui appelle `supabase.auth.getClaims()` pour rafraîchir et vérifier la session à chaque requête. Sans ce fichier, les cookies de session ne sont pas rafraîchis et les pages serveur voient des sessions expirées. La doc Next.js rappelle aussi que le proxy ne protège pas les actions serveur : chaque action doit vérifier la session.
- **Sources :**
  - https://supabase.com/docs/guides/auth/server-side/nextjs
  - https://nextjs.org/docs/app/getting-started/proxy
  - https://nextjs.org/docs/app/getting-started/mutating-data
- **Correction proposée :** ajouter `proxy.ts` (racine) et `lib/supabase/proxy.ts` (`updateSession`) au §7. Ajouter à AD-1 : « le rafraîchissement de session se fait dans `proxy.ts` avec `getClaims()` ; chaque action serveur relit la session elle-même ». Le contrôle des 8 heures (V-2) y est placé.

## V-6 — Netlify gratuit : 300 crédits par mois avec arrêt du site, 15 crédits par mise en production — **HAUTE**

- **Affirmé dans la spine :** §8 « Netlify | Gratuite | … deviendrait payant si les crédits mensuels gratuits sont dépassés ».
- **Constaté :** l'offre gratuite a 300 crédits par mois et une **limite stricte**. Une mise en production réussie coûte **15 crédits**, soit 20 au maximum par mois avant tout trafic. S'y ajoutent les calculs serveur (10 crédits par Go-heure), la bande passante (20 crédits par Go) et les requêtes (2 crédits pour 10 000). Quand les crédits sont épuisés, **tous les sites sont mis en pause** (« Site not available ») jusqu'au cycle suivant, et l'offre gratuite **ne permet pas d'acheter des crédits**. Ce n'est donc pas « deviendrait payant », c'est **une panne de production**. Points confirmés : les prévisualisations de branches et les retours arrière ne coûtent rien, et l'usage commercial est autorisé sur l'offre gratuite.
- **Sources :**
  - https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
  - https://www.netlify.com/pricing/
  - https://www.netlify.com/blog/introducing-netlify-free-plan
- **Correction proposée :** au §8, remplacer la ligne Netlify par : « 300 crédits par mois, limite stricte ; épuisés = site hors ligne jusqu'au mois suivant ». Ajouter à AD-11 une règle : les mises en production sont regroupées (au plus ~10 par mois) ; on travaille sur des branches (prévisualisations gratuites), on ne fusionne pas chaque petit changement dans `main`, et on suit la consommation de crédits chaque semaine. Prévoir le plan B (offre payante Personal) dans les risques.

## V-7 — `create-next-app` 16 active par défaut Cache Components (et AGENTS.md) — **MOYENNE**

- **Affirmé dans la spine :** §1 « `create-next-app` (TypeScript, Tailwind, App Router) » ; §11 « Mise en cache et optimisation : laissées pour plus tard ».
- **Constaté :** les « recommended defaults » actuels sont : TypeScript, ESLint, pas de React Compiler, Tailwind CSS, pas de `src/`, App Router, **Cache Components**, **AGENTS.md**, **Agent feedback**, et Turbopack activé par défaut. Avec Cache Components, le rendu partiel (PPR) est actif : toute lecture de `cookies()` (donc toute page qui lit la session Supabase) doit être placée sous `<Suspense>`, sinon le build échoue. La doc demande aussi de régler `partialPrefetching` explicitement. La mise en cache n'est donc pas « pour plus tard » : elle est active dès le départ.
- **Sources :**
  - https://nextjs.org/docs/app/api-reference/cli/create-next-app
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents
- **Correction proposée :** fixer la commande exacte au §1, par exemple `npx create-next-app@16.4 nova --yes` en gardant les défauts, puis ajouter une convention : « les pages de l'espace équipe lisent la session dans un composant enveloppé de `<Suspense>` ; pas de `use cache` sur des données liées à une personne ». Autre option : désactiver avec `--no-cache-components` et le justifier en une phrase. Décider aussi du sort d'AGENTS.md (utile ici) et de l'« Agent feedback » (à désactiver si non souhaité).

## V-8 — Sauvegarde depuis GitHub Actions : IPv6, pooler, Docker et schéma `auth` — **MOYENNE**

- **Affirmé dans la spine :** AD-12 « une tâche GitHub Actions exporte chaque nuit la base … (données et comptes) » ; hypothèse 4.
- **Constaté :** la connexion directe Supabase (`db.<ref>.supabase.co`) n'a **qu'une adresse IPv6**, et les machines GitHub Actions sont listées par Supabase parmi les environnements **IPv4 seulement**. Il faut donc la chaîne du **pooler en mode session** (port 5432, utilisateur `postgres.<ref>`). La commande officielle `supabase db dump` lance `pg_dump` **dans un conteneur Docker** : c'est disponible sur `ubuntu-latest`, mais impossible sur le PC d'Abraham (hypothèse 1, pas de Docker). Pour la restauration locale, il faut donc `psql`, ou faire la restauration dans GitHub Actions. Le vidage de structure exclut les schémas gérés (`auth`, `storage`) ; seul le vidage `--data-only` contient les lignes `auth.users`. La procédure officielle comprend trois fichiers : rôles, structure et données.
- **Sources :**
  - https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP
  - https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
  - https://supabase.com/docs/reference/cli/supabase-db-dump
- **Correction proposée :** préciser dans AD-12 : connexion par le **pooler en mode session** (secret GitHub `SUPABASE_DB_URL_POOLER`), trois fichiers (`roles.sql`, `schema.sql`, `data.sql --use-copy --data-only`), chiffrement puis artefact conservé 30 jours. La **restauration de test** (OPS-4) est faite **dans un workflow GitHub Actions** vers le projet dev, puisque le PC n'a pas Docker.

## V-9 — « La sauvegarde évite aussi la mise en pause » : non garanti — **MOYENNE**

- **Affirmé dans la spine :** AD-12 « Prevents : … la mise en pause du projet » ; journal « évite aussi la mise en pause ».
- **Constaté :** la doc officielle parle d'une activité suffisante de **requêtes utilisateur sur la base** pendant la semaine (quelques requêtes par jour, sans garantie). Rien ne confirme qu'un `pg_dump` nocturne compte. Le projet **dev** n'est pas sauvegardé, il peut donc être mis en pause, ce qui ferait échouer les tests en CI (hypothèse 1).
- **Sources :**
  - https://supabase.com/docs/guides/platform/free-project-pausing
  - https://supabase.com/kb/faqs/platform/free-project-pausing
- **Correction proposée :** ajouter une tâche GitHub Actions planifiée qui fait une vraie requête par l'API (par exemple `select` sur `categories` avec la clé publiable) chaque jour, **sur les deux projets**. Garder l'email d'avertissement de Supabase comme alerte. Retirer « évite la mise en pause » du rôle de la sauvegarde.

## V-10 — shadcn 4.23 : bibliothèque de base (Radix, Base UI, Aria) à choisir explicitement — **MOYENNE**

- **Affirmé dans la spine :** §1 « shadcn/ui | CLI 4.23 » ; « puis `shadcn init` ».
- **Constaté :** `shadcn init` 4.23 propose `--base base|radix|aria` et un mode `--defaults` qui vaut `--template=next --preset=base-nova`, soit **Base UI** et non Radix. Les API diffèrent (`render={…}` avec Base UI, `asChild` avec Radix). Si ce choix n'est pas fixé, les stories générées par l'IA mélangeront les deux styles. La CLI 4 sait aussi créer le projet Next elle-même (`init -t next`).
- **Sources :**
  - `npx shadcn@4.23.0 init --help` (exécuté le 03/11/2026)
  - https://ui.shadcn.com/docs/installation/next
  - https://ui.shadcn.com/docs/changelog/2026-03-cli-v4
- **Correction proposée :** au §1, écrire la commande exacte, par exemple `npx shadcn@4.23 init --base radix` (ou `base`), avec la raison en une phrase (Radix est la plus documentée). Ajouter la convention « composants shadcn : base X uniquement ».

## V-11 — Netlify : retour arrière limité aux déploiements des 30 derniers jours — **BASSE**

- **Affirmé dans la spine :** AD-11 « Publish deploy sur la version précédente dans Netlify ».
- **Constaté :** confirmé. « Publish deploy » republie un déploiement précédent instantanément, sans nouveau build et sans crédit. Mais Netlify **supprime les déploiements après 30 jours** sur l'offre gratuite (90 jours en payant). La protection contre le décalage de versions (skew protection) est désactivée par défaut (`NETLIFY_NEXT_SKEW_PROTECTION=true`), ce qui compte pour les actions serveur pendant une mise en ligne. L'adaptateur OpenNext de Netlify prend en charge Next.js 16, y compris Cache Components et Server Actions.
- **Sources :**
  - https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview
  - https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
  - https://www.netlify.com/changelog/next-js-16-deploy-on-netlify.md
- **Correction proposée :** ajouter à AD-11 : « retour arrière possible sur les déploiements de moins de 30 jours ; au-delà, redéployer l'étiquette Git ». Activer `NETLIFY_NEXT_SKEW_PROTECTION=true`. Vérifier `proxy.ts` sur une prévisualisation dès la première story : sur Netlify, le middleware passe par les Edge Functions et le proxy Node n'a pas accès à `fs`.

## V-12 — SMTP Resend dans Supabase : limite par défaut de 30 emails par heure — **BASSE**

- **Affirmé dans la spine :** AD-13, §1 « Resend … se branche directement sur Supabase ».
- **Constaté :** confirmé. Le SMTP personnalisé est inclus dans l'offre gratuite de Supabase. Réglages Resend : `smtp.resend.com`, port 465, utilisateur `resend`, mot de passe = clé API, avec un **domaine vérifié obligatoire**. Les invitations depuis l'API admin **exigent** un SMTP personnalisé. Une fois le SMTP enregistré, Supabase impose **30 emails par heure** (modifiable). Resend gratuit : 3 000 par mois et 100 par jour (confirmé).
- **Sources :**
  - https://supabase.com/docs/guides/auth/auth-smtp
  - https://resend.com/docs/send-with-supabase-smtp
  - https://resend.com/pricing
- **Correction proposée :** préciser dans AD-13 les paramètres SMTP et la limite de 30 par heure (suffisante pour environ 10 membres). La clé API Resend utilisée par Supabase devrait être une clé à part, limitée à l'envoi.

## V-13 — Points vérifiés et confirmés (pour mémoire) — **BASSE**

- **Constaté :**
  - Supabase gratuit (source officielle, plus seulement des sources tierces) : 2 projets actifs, 500 Mo, pause après 7 jours, pas de sauvegarde automatique, journaux d'API conservés 1 jour. Région **Paris `eu-west-3`** disponible.
  - Blocage d'un compte : `auth.admin.updateUserById(id, { ban_duration: '876000h' })`, débloquer avec `'none'`. Le jeton d'accès déjà émis reste valable jusqu'à son expiration (1 h), ce que couvre AD-3, qui vérifie `membres` à chaque requête.
  - Les Server Functions / Server Actions restent le mécanisme recommandé pour les modifications (doc mise à jour le 15/10/2026). Avertissement officiel : elles sont joignables par POST direct, donc chaque action doit vérifier la session, ce qui est cohérent avec AD-2. API utiles en Next 16 : `refresh()`, `updateTag`, `revalidatePath`.
  - Sentry Developer gratuit : 5 000 erreurs par mois, 1 utilisateur, 30 jours, alertes email. `@sentry/nextjs` 11.10 déclare `next ^16` en dépendance paire et exige Node ≥ 20.19 (version Node à fixer sur Netlify).
  - L'adaptateur Netlify (`@netlify/plugin-nextjs` 5.16.5, OpenNext) est fourni automatiquement ; Netlify déconseille de le figer.
- **Sources :**
  - https://supabase.com/pricing
  - https://supabase.com/docs/guides/platform/regions
  - https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
  - https://nextjs.org/docs/app/getting-started/mutating-data
  - https://sentry.io/pricing/
  - https://docs.sentry.io/platforms/javascript/guides/nextjs/
- **Correction proposée :** dans le journal de décisions, remplacer « sources tierces 2026 » par les liens officiels. Fixer `NODE_VERSION=22` (ou ≥ 20.19) dans `netlify.toml`.
