import { SqueletteJournal } from "@/components/nova/journal";

// Chargement de la page Journal (EXPERIENCE.md §5) : lignes squelettes.
export default function ChargementJournal() {
  return (
    <div aria-busy="true" className="max-w-5xl">
      <p role="status" className="sr-only">
        Chargement du journal…
      </p>
      <h1 className="mb-5 text-2xl font-semibold leading-[1.3]">Journal</h1>
      {/* Place du filtre par type (même hauteur : boutons de 44 px, marge de 16 px). */}
      <div aria-hidden="true" className="mb-4 flex flex-wrap gap-2" data-testid="squelette-filtre-journal">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-11 w-24 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
      <SqueletteJournal />
    </div>
  );
}
