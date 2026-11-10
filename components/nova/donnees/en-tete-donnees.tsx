// En-tête et squelette de la page « Données personnelles » (story 5.4),
// partagés par la page et son chargement (même mise en page : rien ne saute
// à l'affichage). Sans état : rendus côté serveur.

/** Titre et phrase d'introduction de la page. */
export function EnTeteDonnees() {
  return (
    <>
      <h1 className="mb-1.5 text-2xl font-semibold leading-[1.3]">Données personnelles</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Respectez les droits des demandeurs sur leurs données.
      </p>
    </>
  );
}

/** Titre et explication du bloc « Droit à l'effacement ». */
export function EnTeteEffacement({ id }: { id?: string }) {
  return (
    <>
      <h2 id={id} className="mb-1 text-lg font-semibold leading-[1.4]">
        Droit à l&apos;effacement
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Retrouvez toutes les demandes d&apos;une personne par son adresse email, puis effacez-les
        définitivement, avec leur historique et leurs notes.
      </p>
    </>
  );
}

/** Bloc squelette (chargement). */
export function SqueletteDonnees() {
  return (
    <div aria-hidden="true" className="rounded-lg border border-border bg-surface p-5" data-testid="squelette-donnees">
      <div className="mb-2 h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="mb-4 h-4 w-full max-w-md animate-pulse rounded bg-muted" />
      <div className="max-w-[560px] space-y-1.5">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-11 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="mt-4 h-11 w-32 animate-pulse rounded-md bg-muted" />
    </div>
  );
}
