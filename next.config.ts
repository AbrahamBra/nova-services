import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import paquet from "./package.json" with { type: "json" };

// Version affichée en bas des pages internes (AD-11, story 3.1) : « v » +
// la version de package.json (lu à côté de ce fichier), au build. Jamais
// saisie à la main : une valeur NEXT_PUBLIC_APP_VERSION posée ailleurs est
// remplacée par celle-ci.
const VERSION_APPLICATION = `v${paquet.version}`;

/**
 * Garde-fou de construction sur Netlify (story 3.1) : la production vise la
 * base de production, les prévisualisations et branches la base de
 * développement, et IP_DE_TEST_AUTORISEE n'y existe jamais. Renvoie le
 * problème, ou null (hors Netlify : toujours null).
 */
export function problemeContexteNetlify(env: Record<string, string | undefined>): string | null {
  if (env.NETLIFY !== "true") return null;
  if (env.IP_DE_TEST_AUTORISEE !== undefined && env.IP_DE_TEST_AUTORISEE !== "") {
    return "IP_DE_TEST_AUTORISEE ne doit jamais être posée sur Netlify (elle contourne l'anti-spam).";
  }
  const attendu = env.CONTEXT === "production" ? "production" : "developpement";
  if (env.SUPABASE_ENVIRONNEMENT !== attendu) {
    return `Contexte Netlify « ${env.CONTEXT ?? "(absent)"} » : SUPABASE_ENVIRONNEMENT doit valoir « ${attendu} » (valeur actuelle : « ${env.SUPABASE_ENVIRONNEMENT ?? "(absent)"} »). Corrigez les variables Netlify de ce contexte.`;
  }
  return null;
}

const probleme = problemeContexteNetlify(process.env);
if (probleme) throw new Error(`Construction arrêtée : ${probleme}`);

const nextConfig: NextConfig = {
  // Pas de badge « N » de Next.js en développement : il prend le focus clavier
  // avant les éléments de la page et fausse les tests d'accessibilité
  // (parcours au clavier de la story 1.3). Il n'existe pas en production.
  devIndicators: false,
  // Environnement des erreurs envoyées par le navigateur (AD-14) : recopié
  // de SUPABASE_ENVIRONNEMENT, sans nouvelle variable à remplir.
  env: {
    NEXT_PUBLIC_SUPABASE_ENVIRONNEMENT: process.env.SUPABASE_ENVIRONNEMENT ?? "",
    NEXT_PUBLIC_APP_VERSION: VERSION_APPLICATION,
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
// le jeton SENTRY_AUTH_TOKEN ; jamais en local. Pas encore activé : aucun
// SENTRY_AUTH_TOKEN n'est saisi dans Netlify (décision de la story 3.1).
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
