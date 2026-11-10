// En-tête et squelette de la page « Paramètres » (story 5.3), partagés par la
// page et son chargement (même mise en page : rien ne saute à l'affichage).
// Sans état : rendus côté serveur.

/** Titre et phrase d'introduction de la page. */
export function EnTeteParametres() {
  return (
    <>
      <h1 className="mb-1.5 text-2xl font-semibold leading-[1.3]">Paramètres</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Ces informations sont affichées aux demandeurs sur le formulaire public, la page de
        confirmation et l&apos;email de confirmation.
      </p>
    </>
  );
}

/** Champs squelettes du formulaire (chargement). */
export function SqueletteParametres() {
  return (
    <div aria-hidden="true" className="max-w-[560px] space-y-4" data-testid="squelette-parametres">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-11 animate-pulse rounded-md bg-muted" />
        </div>
      ))}
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
