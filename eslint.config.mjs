import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Méthode BMAD et outils (non applicatifs) :
    "_bmad/**",
    "_bmad-output/**",
    ".claude/**",
    // Rapports de tests :
    "playwright-report/**",
    "test-results/**",
    // Fichiers générés par Netlify pendant la construction (extensions,
    // déclarations Deno) : ce ne sont pas nos sources (story 3.1).
    ".netlify/**",
  ]),
]);

export default eslintConfig;
