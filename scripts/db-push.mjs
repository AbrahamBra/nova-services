// Applique les migrations de supabase/migrations/ avec la CLI Supabase :
//   supabase db push --db-url <SUPABASE_DB_URL>
//   npm run db:push                    projet de développement (.env.local)
//   npm run db:push -- --production    production : lit UNIQUEMENT
//                                      .env.scripts-production.local (story 3.1)
// Voir scripts/charger-environnement.mjs pour les garde-fous.
// L'adresse n'est jamais affichée : elle contient le mot de passe de la base.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chargerEnvironnement, FICHIER_PRODUCTION, OPTION_PRODUCTION } from "./charger-environnement.mjs";

const require = createRequire(import.meta.url);

const environnement = chargerEnvironnement("db:push", { productionPermise: true });
const fichier = environnement === "production" ? FICHIER_PRODUCTION : ".env.local";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    `SUPABASE_DB_URL manquant : renseignez l'adresse de connexion de la base dans ${fichier}.`,
  );
  process.exit(1);
}

const argsCli = process.argv.slice(2).filter((arg) => arg !== OPTION_PRODUCTION);

console.log(
  environnement === "production"
    ? `Application des migrations sur le projet de PRODUCTION (${FICHIER_PRODUCTION})…`
    : "Application des migrations sur le projet « developpement »…",
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
