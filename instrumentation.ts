import * as Sentry from "@sentry/nextjs";

// Instrumentation de Next.js : charge Sentry selon l'environnement
// d'exécution (AD-14). Voir lib/sentry/options.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Erreurs des pages, des mises en page et des actions serveur : envoyées à
// Sentry (sans effet si Sentry n'est pas initialisé).
export const onRequestError = Sentry.captureRequestError;
