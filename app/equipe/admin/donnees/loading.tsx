import { EnTeteDonnees, SqueletteDonnees, SqueletteExpirees } from "@/components/nova/donnees/en-tete-donnees";

// Chargement de la page Données personnelles (EXPERIENCE.md §5) : même
// en-tête que la page, bloc squelette.
export default function ChargementDonnees() {
  return (
    <div aria-busy="true" className="max-w-5xl">
      <p role="status" className="sr-only">
        Chargement des données personnelles…
      </p>
      <EnTeteDonnees />
      <div className="space-y-6">
        <SqueletteDonnees />
        <SqueletteExpirees />
      </div>
    </div>
  );
}
