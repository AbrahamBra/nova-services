import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Pas de badge « N » de Next.js en développement : il prend le focus clavier
  // avant les éléments de la page et fausse les tests d'accessibilité
  // (parcours au clavier de la story 1.3). Il n'existe pas en production.
  devIndicators: false,
  // Environnement des erreurs envoyées par le navigateur (AD-14) : recopié
  // de SUPABASE_ENVIRONNEMENT, sans nouvelle variable à remplir.
  env: {
    NEXT_PUBLIC_SUPABASE_ENVIRONNEMENT: process.env.SUPABASE_ENVIRONNEMENT ?? "",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Cartes du code source envoyées à Sentry seulement au build Netlify, avec
// le jeton SENTRY_AUTH_TOKEN (story 3.1) ; jamais en local.
const envoyerCartes = Boolean(process.env.SENTRY_AUTH_TOKEN) && process.env.NETLIFY === "true";

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: envoyerCartes ? process.env.SENTRY_AUTH_TOKEN : undefined,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !envoyerCartes },
  release: { create: envoyerCartes },
});
