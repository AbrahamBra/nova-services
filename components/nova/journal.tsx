import Link from "next/link";
import { LIBELLES_TYPE_JOURNAL, TYPES_JOURNAL, type TypeJournal } from "@/lib/domaine";
import { adresseJournal } from "@/lib/filtres";
import { formaterDateHeure } from "@/lib/format";
import { auteurJournal, descriptionJournal, type LigneJournal } from "@/lib/journal";
import { cn } from "@/lib/utils";

// Journal des événements (EXPERIENCE.md §9.11, story 5.1) : composant UNIQUE
// d'affichage (AD-19). Tableau Date · Type · Description · Par sur tablette
// et ordinateur ; une carte par ligne sur téléphone (< 640 px), comme la page
// Comptes. Les phrases viennent de lib/journal.ts. Composant serveur.

export const CHEMIN_JOURNAL = "/equipe/admin/journal";

/** Aucune ligne pour le filtre choisi (EXPERIENCE.md §5). */
export const MESSAGE_AUCUN_EVENEMENT = "Aucun événement.";

const CLASSE_ENTETE =
  "border-b border-border bg-background px-3 py-2.5 text-left text-[13px] font-medium whitespace-nowrap text-muted-foreground";
const CLASSE_CELLULE = "border-b border-muted px-3 py-3 align-top";

const CLASSE_FILTRE =
  "inline-flex h-11 items-center justify-center rounded-full border px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

/** Filtre par type : « Tous » et les six types, gardé dans l'adresse (`?type=compte`). */
export function FiltreJournal({ type }: { type: TypeJournal | undefined }) {
  const choix: { valeur: TypeJournal | undefined; libelle: string }[] = [
    { valeur: undefined, libelle: "Tous" },
    ...TYPES_JOURNAL.map((t) => ({ valeur: t, libelle: LIBELLES_TYPE_JOURNAL[t] })),
  ];
  return (
    <nav aria-label="Filtrer par type" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {choix.map(({ valeur, libelle }) => {
          const actif = valeur === type;
          return (
            <li key={libelle}>
              <Link
                href={adresseJournal(CHEMIN_JOURNAL, valeur)}
                aria-current={actif ? "true" : undefined}
                className={cn(
                  CLASSE_FILTRE,
                  actif
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-foreground hover:bg-muted",
                )}
              >
                {libelle}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ListeJournal({ lignes }: { lignes: LigneJournal[] }) {
  if (lignes.length === 0) {
    return (
      <p
        role="status"
        className="rounded-lg border border-border bg-surface px-4 py-6 text-[15px] text-muted-foreground"
      >
        {MESSAGE_AUCUN_EVENEMENT}
      </p>
    );
  }

  return (
    <>
      {/* Tablette et ordinateur. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table aria-label="Journal" className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={CLASSE_ENTETE}>Date</th>
              <th scope="col" className={CLASSE_ENTETE}>Type</th>
              <th scope="col" className={CLASSE_ENTETE}>Description</th>
              <th scope="col" className={CLASSE_ENTETE}>Par</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne) => (
              <tr key={ligne.id} data-journal={ligne.id} className="last:[&>td]:border-b-0">
                <td className={`${CLASSE_CELLULE} whitespace-nowrap`}>
                  {formaterDateHeure(ligne.creeLe)}
                </td>
                <td className={`${CLASSE_CELLULE} whitespace-nowrap`}>
                  {LIBELLES_TYPE_JOURNAL[ligne.type]}
                </td>
                <td className={`${CLASSE_CELLULE} min-w-60 break-words`}>
                  {descriptionJournal(ligne.details)}
                </td>
                <td className={`${CLASSE_CELLULE} min-w-32 break-words`}>{auteurJournal(ligne)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Téléphone : une carte par ligne. */}
      <ul className="space-y-3 sm:hidden" aria-label="Journal">
        {lignes.map((ligne) => (
          <li
            key={ligne.id}
            data-journal={ligne.id}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span>{formaterDateHeure(ligne.creeLe)}</span>
              <span className="font-medium">{LIBELLES_TYPE_JOURNAL[ligne.type]}</span>
            </div>
            <p className="mt-1.5 break-words">{descriptionJournal(ligne.details)}</p>
            <p className="mt-1.5 text-[13px] break-words text-muted-foreground">
              Par {auteurJournal(ligne)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Lignes squelettes pendant le chargement (EXPERIENCE.md §5). */
export function SqueletteJournal() {
  return (
    <div aria-hidden="true" className="space-y-3" data-testid="squelette-journal">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
