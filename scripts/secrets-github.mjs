// Copie des valeurs Supabase vers les secrets du dépôt GitHub. À lancer par
// Abraham :
//   npm run secrets:github
//       projet de DÉVELOPPEMENT (.env.local) → DEV_SUPABASE_URL,
//       DEV_SUPABASE_PUBLISHABLE_KEY, DEV_SUPABASE_SECRET_KEY,
//       DEV_SUPABASE_DB_URL (tâche « Tests », réveil, restauration de test) ;
//   npm run secrets:github -- --production
//       PRODUCTION : lit UNIQUEMENT .env.scripts-production.local et envoie SEULEMENT
//       PROD_SUPABASE_DB_URL (sauvegarde nocturne et réveil, story 3.2).
// Les valeurs ne sont jamais affichées : elles passent directement à `gh`.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chargerEnvironnement, FICHIER_PRODUCTION } from "./charger-environnement.mjs";

/**
 * Secrets GitHub à envoyer → variable lue. En production, SEULEMENT
 * PROD_SUPABASE_DB_URL ; jamais un secret DEV_*.
 * @param {"developpement" | "production"} environnement
 * @returns {Record<string, string>}
 */
export function correspondances(environnement) {
  return environnement === "production"
    ? { PROD_SUPABASE_DB_URL: "SUPABASE_DB_URL" }
    : {
        DEV_SUPABASE_URL: "NEXT_PUBLIC_SUPABASE_URL",
        DEV_SUPABASE_PUBLISHABLE_KEY: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        DEV_SUPABASE_SECRET_KEY: "SUPABASE_SECRET_KEY",
        DEV_SUPABASE_DB_URL: "SUPABASE_DB_URL",
      };
}

function principal() {
  const environnement = chargerEnvironnement("secrets:github", { productionPermise: true });
  const fichier = environnement === "production" ? FICHIER_PRODUCTION : ".env.local";

  // La sauvegarde nocturne n'accepte que le pooler en mode session (port 5432
  // de *.pooler.supabase.com) : refus ici plutôt qu'une sauvegarde rouge.
  const POOLER_SESSION = /^postgres(ql)?:\/\/.+@[^@/:?]+\.pooler\.supabase\.com:5432\//;
  if (environnement === "production" && !POOLER_SESSION.test(process.env.SUPABASE_DB_URL ?? "")) {
    console.error(
      `Refusé : SUPABASE_DB_URL de ${FICHIER_PRODUCTION} doit être l'adresse du pooler en mode session (port 5432 de pooler.supabase.com). Rien n'a été envoyé.`,
    );
    process.exit(1);
  }

  let erreurs = 0;
  for (const [secret, variable] of Object.entries(correspondances(environnement))) {
    const valeur = process.env[variable];
    if (!valeur) {
      console.error(`${variable} est vide dans ${fichier} : secret ${secret} non envoyé.`);
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
}

// Lancé directement (npm run secrets:github) : pas quand un test importe
// `correspondances`.
const lanceDirectement =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (lanceDirectement) principal();
