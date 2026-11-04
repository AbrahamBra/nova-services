import * as Sentry from "@sentry/nextjs";
import { optionsSentry, sentryActif } from "@/lib/sentry/options";

// Suivi des erreurs côté edge (proxy.ts) (AD-14), chargé par instrumentation.ts.
// Sans NEXT_PUBLIC_SENTRY_DSN, rien n'est initialisé.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (sentryActif(dsn)) {
  Sentry.init(
    optionsSentry({
      dsn,
      environnement: process.env.SUPABASE_ENVIRONNEMENT,
      version: process.env.NEXT_PUBLIC_APP_VERSION,
    }),
  );
}
