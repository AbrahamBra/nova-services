import { SqueletteComptes } from "@/components/nova/comptes/liste-comptes";

// Chargement de la page Comptes (EXPERIENCE.md §5) : lignes squelettes.
export default function ChargementComptes() {
  return (
    <div aria-busy="true" className="max-w-5xl">
      <p role="status" className="sr-only">
        Chargement des comptes…
      </p>
      <h1 className="mb-5 text-2xl font-semibold leading-[1.3]">Comptes</h1>
      <SqueletteComptes />
    </div>
  );
}
