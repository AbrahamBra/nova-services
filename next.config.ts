import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pas de badge « N » de Next.js en développement : il prend le focus clavier
  // avant les éléments de la page et fausse les tests d'accessibilité
  // (parcours au clavier de la story 1.3). Il n'existe pas en production.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
