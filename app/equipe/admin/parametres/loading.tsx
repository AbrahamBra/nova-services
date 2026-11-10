import { EnTeteParametres, SqueletteParametres } from "@/components/nova/parametres/en-tete-parametres";

// Chargement de la page Paramètres (EXPERIENCE.md §5) : même en-tête que la
// page, champs squelettes.
export default function ChargementParametres() {
  return (
    <div aria-busy="true" className="max-w-5xl">
      <p role="status" className="sr-only">
        Chargement des paramètres…
      </p>
      <EnTeteParametres />
      <SqueletteParametres />
    </div>
  );
}
