// Chargement du détail (EXPERIENCE.md §5, UX-DR4) : squelette des blocs
// (en-tête, description, demandeur, historique, colonne d'information),
// jamais d'écran blanc.

function Barre({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-sm bg-muted ${className}`} />;
}

function Bloc({ lignes }: { lignes: string[] }) {
  return (
    <div data-squelette="bloc" className="space-y-3 rounded-lg border border-border bg-surface p-4 md:p-5">
      <Barre className="h-5 w-32" />
      {lignes.map((largeur, i) => (
        <Barre key={i} className={`h-4 ${largeur}`} />
      ))}
    </div>
  );
}

export default function ChargementDetail() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Chargement de la demande…
      </p>
      <Barre className="mb-5 h-4 w-40" />
      <div className="mb-5 space-y-2">
        <Barre className="h-4 w-36" />
        <Barre className="h-7 w-3/4" />
        <Barre className="h-5 w-64" />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5">
        <div className="flex flex-col gap-4">
          <Bloc lignes={["w-full", "w-full", "w-2/3"]} />
          <Bloc lignes={["w-1/2", "w-2/3", "w-1/2"]} />
          <Bloc lignes={["w-full", "w-5/6"]} />
        </div>
        <Bloc lignes={["w-1/2", "w-24", "w-20", "w-2/3"]} />
      </div>
    </div>
  );
}
