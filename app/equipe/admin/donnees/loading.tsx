import { EnTeteDonnees, SqueletteDonnees } from "@/components/nova/donnees/en-tete-donnees";

// Chargement de la page Données personnelles (EXPERIENCE.md §5) : même
// en-tête que la page, bloc squelette.
export default function ChargementDonnees() {
  return (
    <div aria-busy="true" className="max-w-5xl">
      <p role="status" className="sr-only">
        Chargement des données personnelles…
      </p>
      <EnTeteDonnees />
      <SqueletteDonnees />
    </div>
  );
}
