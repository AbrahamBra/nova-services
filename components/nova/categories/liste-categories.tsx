import { ActionsCategorie } from "@/components/nova/categories/actions-categorie";
import type { CategorieAdmin } from "@/lib/categories-admin";
import { formaterNombre } from "@/lib/format";
import { cn } from "@/lib/utils";

// Liste des catégories (story 5.2) : tableau Nom · État · Demandes · Actions
// sur tablette et ordinateur ; une carte par catégorie sur téléphone
// (< 640 px). Ordre des formulaires (`ordre`, puis `nom`), donné par la base.

/** Libellés de l'état d'une catégorie. */
export const LIBELLES_ETAT_CATEGORIE = { active: "Active", desactivee: "Désactivée" } as const;

const CLASSE_ENTETE =
  "border-b border-border bg-background px-3 py-2.5 text-left text-[13px] font-medium whitespace-nowrap text-muted-foreground";
const CLASSE_CELLULE = "border-b border-muted px-3 py-3 align-top";

/** Nombre de demandes, en toutes lettres pour la carte (« 1 demande », « 3 demandes »). */
export function texteDemandes(nombre: number): string {
  return `${formaterNombre(nombre)} ${nombre > 1 ? "demandes" : "demande"}`;
}

// État toujours écrit en toutes lettres (jamais la couleur seule).
export function BadgeEtatCategorie({ actif }: { actif: boolean }) {
  return (
    <span
      data-etat={actif ? "active" : "desactivee"}
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-medium whitespace-nowrap",
        actif
          ? "bg-status-traitee-bg text-status-traitee-fg"
          : "border border-border bg-priority-basse-bg text-priority-basse-fg",
      )}
    >
      {actif ? LIBELLES_ETAT_CATEGORIE.active : LIBELLES_ETAT_CATEGORIE.desactivee}
    </span>
  );
}

export function ListeCategories({ categories }: { categories: CategorieAdmin[] }) {
  return (
    <>
      {/* Tablette et ordinateur. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table aria-label="Catégories" className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={CLASSE_ENTETE}>Nom</th>
              <th scope="col" className={CLASSE_ENTETE}>État</th>
              <th scope="col" className={`${CLASSE_ENTETE} text-right`}>Demandes</th>
              <th scope="col" className={CLASSE_ENTETE}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((categorie) => (
              <tr key={categorie.id} data-categorie={categorie.id} className="last:[&>td]:border-b-0">
                <td className={`${CLASSE_CELLULE} min-w-40 font-medium break-words`}>{categorie.nom}</td>
                <td className={CLASSE_CELLULE}>
                  <BadgeEtatCategorie actif={categorie.actif} />
                </td>
                <td className={`${CLASSE_CELLULE} text-right tabular-nums`}>
                  {formaterNombre(categorie.demandes)}
                </td>
                <td className={`${CLASSE_CELLULE} py-2`}>
                  <ActionsCategorie categorie={categorie} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Téléphone : une carte par catégorie. */}
      <ul className="space-y-3 sm:hidden" aria-label="Catégories">
        {categories.map((categorie) => (
          <li
            key={categorie.id}
            data-categorie={categorie.id}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-medium break-words">{categorie.nom}</p>
              <BadgeEtatCategorie actif={categorie.actif} />
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">{texteDemandes(categorie.demandes)}</p>
            <div className="mt-3">
              <ActionsCategorie categorie={categorie} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Lignes squelettes pendant le chargement (EXPERIENCE.md §5). */
export function SqueletteCategories() {
  return (
    <div aria-hidden="true" className="space-y-3" data-testid="squelette-categories">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
