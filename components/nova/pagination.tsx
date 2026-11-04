import Link from "next/link";
import { adresseAvecPage, nombreDePages, rangsAffiches, type ParametresAdresse } from "@/lib/filtres";
import { formaterNombre } from "@/lib/format";

// Pagination des listes (EXPERIENCE.md §9.4) : « 1–25 sur 40 », Précédent et
// Suivant, masquée quand tout tient sur une page. Le numéro de page est dans l'adresse (`?page=2`), les autres
// paramètres sont conservés.

type Props = {
  chemin: string;
  parametres: ParametresAdresse;
  page: number;
  total: number;
  taillePage: number;
};

const CLASSE_BOUTON =
  "inline-flex h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium outline-none transition-colors";

function Bouton({ href, children }: { href: string | null; children: string }) {
  if (href === null) {
    return (
      // Annoncé comme un lien indisponible par les lecteurs d'écran.
      <span
        role="link"
        aria-disabled="true"
        className={`${CLASSE_BOUTON} cursor-not-allowed text-muted-foreground`}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${CLASSE_BOUTON} text-foreground hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`}
    >
      {children}
    </Link>
  );
}

/** « 1–25 sur 40 » (tiret demi-cadratin, milliers séparés). */
export function libellePagination(page: number, total: number, taillePage: number): string {
  const { premier, dernier } = rangsAffiches(page, total, taillePage);
  return `${formaterNombre(premier)}–${formaterNombre(dernier)} sur ${formaterNombre(total)}`;
}

export function Pagination({ chemin, parametres, page, total, taillePage }: Props) {
  const derniere = nombreDePages(total, taillePage);
  // Tout tient sur une page : ni « 1–3 sur 3 », ni Précédent / Suivant.
  if (derniere <= 1) return null;
  const precedente = page > 1 ? adresseAvecPage(chemin, parametres, page - 1) : null;
  const suivante = page < derniere ? adresseAvecPage(chemin, parametres, page + 1) : null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
    >
      <p data-testid="pagination-texte">{libellePagination(page, total, taillePage)}</p>
      <div className="flex gap-2">
        <Bouton href={precedente}>Précédent</Bouton>
        <Bouton href={suivante}>Suivant</Bouton>
      </div>
    </nav>
  );
}
