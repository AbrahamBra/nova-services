// Copie les valeurs du projet Supabase de DÉVELOPPEMENT (.env.local) vers les
// secrets du dépôt GitHub, pour la tâche « Tests ». À lancer par Abraham :
//   npm run secrets:github
// Les valeurs ne sont jamais affichées : elles passent directement à `gh`.

import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

if (process.env.SUPABASE_ENVIRONNEMENT !== "developpement") {
  console.error("Refusé : .env.local doit viser le projet de développement (SUPABASE_ENVIRONNEMENT=developpement).");
  process.exit(1);
}

const correspondances = {
  DEV_SUPABASE_URL: "NEXT_PUBLIC_SUPABASE_URL",
  DEV_SUPABASE_PUBLISHABLE_KEY: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  DEV_SUPABASE_SECRET_KEY: "SUPABASE_SECRET_KEY",
  DEV_SUPABASE_DB_URL: "SUPABASE_DB_URL",
};

let erreurs = 0;
for (const [secret, variable] of Object.entries(correspondances)) {
  const valeur = process.env[variable];
  if (!valeur) {
    console.error(`${variable} est vide dans .env.local : secret ${secret} non envoyé.`);
    erreurs++;
    continue;
  }
  const resultat = spawnSync("gh", ["secret", "set", secret], {
    input: valeur,
    stdio: ["pipe", "ignore", "inherit"],
    shell: false,
  });
  if (resultat.status === 0) {
    console.log(`Secret ${secret} enregistré sur GitHub.`);
  } else {
    console.error(`Échec pour ${secret}.`);
    erreurs++;
  }
}

process.exit(erreurs ? 1 : 0);
