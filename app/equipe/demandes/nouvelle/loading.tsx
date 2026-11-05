// Chargement de la saisie interne (EXPERIENCE.md §5) : squelette des champs,
// comme le formulaire public, jamais d'écran blanc (et jamais les lignes de
// la liste, qui chargerait sinon le squelette de /equipe/demandes).

const NOMBRE_CHAMPS = 7;

function Barre({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-sm bg-muted ${className}`} />;
}

export default function ChargementSaisie() {
  return (
    <div aria-busy="true" className="max-w-[560px]">
      <p role="status" className="sr-only">
        Chargement du formulaire…
      </p>
      <div className="flex min-h-11 items-center">
        <Barre className="h-4 w-40" />
      </div>
      <h1 className="mt-2 text-2xl font-semibold leading-[1.3]">Saisir une demande</h1>
      <div className="mt-6 space-y-5">
        <Barre className="h-11 w-56 rounded-md" />
        {Array.from({ length: NOMBRE_CHAMPS }, (_, i) => (
          <div key={i} data-squelette="champ" className="space-y-2">
            <Barre className="h-4 w-32" />
            <Barre className="h-11 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
