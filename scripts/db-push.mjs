// Applique les migrations de supabase/migrations/ sur la base désignée par
// SUPABASE_DB_URL (lue dans .env.local), avec la CLI Supabase :
//   supabase db push --db-url <SUPABASE_DB_URL>
// L'adresse n'est jamais affichée : elle contient le mot de passe de la base.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    "SUPABASE_DB_URL manquant : renseignez l'adresse de connexion de la base dans .env.local.",
  );
  process.exit(1);
}

// Garde-fou : seul le projet de développement est accepté, sauf demande
// explicite avec --production.
const args = process.argv.slice(2);
const production = args.includes("--production");
const argsCli = args.filter((arg) => arg !== "--production");
const environnement = process.env.SUPABASE_ENVIRONNEMENT;
if (environnement !== "developpement" && !production) {
  console.error(
    `Migrations refusées : SUPABASE_ENVIRONNEMENT vaut ${
      environnement ? `« ${environnement} »` : "(absent)"
    } au lieu de « developpement ». Pour viser volontairement une autre base, ajoutez --production (npm run db:push -- --production).`,
  );
  process.exit(1);
}

console.log(
  `Application des migrations sur le projet « ${environnement ?? "environnement non précisé"} »…`,
);

// Appel direct de la CLI (sans shell) : les caractères spéciaux du mot de
// passe ne sont pas interprétés.
const cli = require.resolve("supabase/dist/supabase.js");
const resultat = spawnSync(
  process.execPath,
  [cli, "db", "push", "--db-url", url, ...argsCli],
  { stdio: "inherit" },
);

if (resultat.error) {
  console.error(`Impossible de lancer la CLI Supabase : ${resultat.error.message}`);
  process.exit(1);
}
if (resultat.signal) {
  console.error(`La CLI Supabase a été interrompue (signal ${resultat.signal}).`);
  process.exit(1);
}

process.exit(resultat.status ?? 1);
