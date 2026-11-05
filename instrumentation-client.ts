import * as Sentry from "@sentry/nextjs";
import { optionsSentry, sentryActif } from "@/lib/sentry/options";

// Suivi des erreurs dans le navigateur (AD-14). Sans NEXT_PUBLIC_SENTRY_DSN,
// rien n'est initialisé. L'environnement est recopié au build depuis
// SUPABASE_ENVIRONNEMENT (next.config.ts).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (sentryActif(dsn)) {
  Sentry.init(
    optionsSentry({
      dsn,
      environnement: process.env.NEXT_PUBLIC_SUPABASE_ENVIRONNEMENT,
      version: process.env.NEXT_PUBLIC_APP_VERSION,
    }),
  );
}

// Demandé par le SDK pour suivre les changements de page ; sans suivi des
// performances (tracesSampleRate: 0), rien n'est envoyé.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
