"use client";

import { BoutonReessayer } from "@/components/nova/reessayer";

// Écran affiché après l'erreur volontaire (story 3.3). L'erreur elle-même a
// déjà été envoyée à Sentry par le serveur (onRequestError) ; sans DSN,
// rien n'est envoyé et l'écran est le même. La référence (`digest`) permet
// de retrouver l'événement dans Sentry.
export default function ErreurTest({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold leading-[1.3]">Test du suivi des erreurs</h1>
      <div
        role="alert"
        className="mt-6 flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="font-medium">L&apos;erreur de test a été envoyée au suivi des erreurs.</p>
          {error?.digest && (
            <p className="mt-1 text-sm text-muted-foreground">Référence : {error.digest}</p>
          )}
        </div>
        <BoutonReessayer onReessayer={() => retry()} />
      </div>
    </div>
  );
}
