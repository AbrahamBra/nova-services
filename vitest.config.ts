import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const racine = fileURLToPath(new URL(".", import.meta.url));

// Charge .env.local (et .env) dans process.env : variables du projet
// Supabase de développement, saisies par Abraham. En CI, elles viennent des
// secrets GitHub et ont priorité.
const variables = loadEnv("test", racine, "");
for (const [cle, valeur] of Object.entries(variables)) {
  if (process.env[cle] === undefined) process.env[cle] = valeur;
}

export default defineConfig({
  resolve: {
    alias: {
      "@": racine,
      // `server-only` refuse d'être importé hors de Next.js : neutralisé
      // pour les tests, qui tournent côté serveur.
      "server-only": fileURLToPath(
        new URL("./tests/outils/server-only-vide.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    globalSetup: ["./tests/garde-environnement.ts"],
    // Beaucoup de tests appellent la vraie base de développement par le
    // réseau, en parallèle : 5 s par défaut ne suffit pas sur la machine de
    // GitHub chargée (délais dépassés aléatoires).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
