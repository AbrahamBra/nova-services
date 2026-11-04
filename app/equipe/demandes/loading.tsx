// Chargement de la liste (EXPERIENCE.md §5, UX-DR4) : 8 lignes squelettes à
// la forme du tableau (ou des cartes sur téléphone), jamais d'écran blanc.

const NOMBRE_LIGNES_SQUELETTE = 8;

function Barre({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-sm bg-muted ${className}`} />;
}

export default function ChargementDemandes() {
  const lignes = Array.from({ length: NOMBRE_LIGNES_SQUELETTE }, (_, i) => i);
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Chargement des demandes…
      </p>
      <h1 className="mb-5 text-2xl font-semibold leading-[1.3]">Demandes</h1>

      <div className="hidden rounded-lg border border-border bg-surface sm:block">
        <div className="h-10 border-b border-border bg-background" />
        {lignes.map((i) => (
          <div
            key={i}
            data-squelette="ligne"
            className="flex items-center gap-4 border-b border-muted px-3 py-4 last:border-b-0"
          >
            <Barre className="h-4 w-32" />
            <Barre className="h-4 w-28" />
            <Barre className="h-4 flex-1" />
            <Barre className="h-5 w-20 rounded-full" />
            <Barre className="h-5 w-16" />
          </div>
        ))}
      </div>

      <div className="space-y-3 sm:hidden">
        {lignes.map((i) => (
          <div
            key={i}
            data-squelette="carte"
            className="space-y-2 rounded-lg border border-border bg-surface p-4"
          >
            <Barre className="h-4 w-36" />
            <Barre className="h-4 w-3/4" />
            <Barre className="h-5 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
