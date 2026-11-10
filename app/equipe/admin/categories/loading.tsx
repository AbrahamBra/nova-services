import { SqueletteCategories } from "@/components/nova/categories/liste-categories";

// Chargement de la page Catégories (EXPERIENCE.md §5) : lignes squelettes.
export default function ChargementCategories() {
  return (
    <div aria-busy="true" className="max-w-5xl">
      <p role="status" className="sr-only">
        Chargement des catégories…
      </p>
      <h1 className="mb-5 text-2xl font-semibold leading-[1.3]">Catégories</h1>
      <SqueletteCategories />
    </div>
  );
}
