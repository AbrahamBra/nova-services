import Link from "next/link";
import { BadgePriorite, BadgeStatut } from "@/components/nova/badges";
import type { LigneDemande } from "@/lib/demandes";
import { LIBELLES_CANAL } from "@/lib/domaine";
import { formaterDateHeure } from "@/lib/format";

// Tableau des demandes (EXPERIENCE.md §4, §8, §9.4 ; UX-DR8) :
//   - ordinateur (≥ 1 024 px) : tableau complet, 9 colonnes ;
//   - tablette (640–1 023 px) : tableau réduit (référence, date, objet,
//     statut, priorité) ;
//   - téléphone (< 640 px) : une carte par demande.
// Toute la ligne (ou la carte) ouvre le détail : la référence est un vrai
// lien, étendu à toute la ligne par un pseudo-élément.

export function adresseDetail(reference: string): string {
  return `/equipe/demandes/${encodeURIComponent(reference)}`;
}

// Lien de la référence, étendu à toute la ligne (ou carte) parente, qui doit
// être en `position: relative`. Le contour de focus entoure toute la ligne.
const CLASSE_LIEN_REFERENCE =
  "font-mono font-medium whitespace-nowrap text-primary underline-offset-2 outline-none hover:underline after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[inherit] focus-visible:after:outline-3 focus-visible:after:-outline-offset-3 focus-visible:after:outline-ring";

const CLASSE_ENTETE =
  "border-b border-border bg-background px-3 py-2.5 text-left text-[13px] font-medium whitespace-nowrap text-muted-foreground";

const CLASSE_CELLULE = "border-b border-muted px-3 py-3 align-top";

// Colonnes visibles seulement sur ordinateur.
const ORDINATEUR = "hidden lg:table-cell";

function Vide() {
  return <span className="text-muted-foreground">—</span>;
}

export function ListeDemandes({ lignes }: { lignes: LigneDemande[] }) {
  return (
    <>
      {/* Tablette et ordinateur. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table aria-label="Demandes" className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={CLASSE_ENTETE}>Référence</th>
              <th scope="col" className={CLASSE_ENTETE}>Date</th>
              <th scope="col" className={`${CLASSE_ENTETE} ${ORDINATEUR}`}>Demandeur</th>
              <th scope="col" className={CLASSE_ENTETE}>Objet</th>
              <th scope="col" className={`${CLASSE_ENTETE} ${ORDINATEUR}`}>Catégorie</th>
              <th scope="col" className={`${CLASSE_ENTETE} ${ORDINATEUR}`}>Canal</th>
              <th scope="col" className={CLASSE_ENTETE}>Statut</th>
              <th scope="col" className={CLASSE_ENTETE}>Priorité</th>
              <th scope="col" className={`${CLASSE_ENTETE} ${ORDINATEUR}`}>Responsable</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne) => (
              <tr
                key={ligne.id}
                data-reference={ligne.reference}
                className="relative transition-colors last:[&>td]:border-b-0 hover:bg-background"
              >
                <td className={CLASSE_CELLULE}>
                  <Link
                    href={adresseDetail(ligne.reference)}
                    prefetch={false}
                    className={CLASSE_LIEN_REFERENCE}
                  >
                    {ligne.reference}
                  </Link>
                </td>
                <td className={`${CLASSE_CELLULE} whitespace-nowrap text-foreground/80`}>
                  {formaterDateHeure(ligne.creeLe)}
                </td>
                <td className={`${CLASSE_CELLULE} ${ORDINATEUR} min-w-40`}>
                  <span className="block font-medium break-words">{ligne.nom}</span>
                  {ligne.societe ? (
                    <span className="block text-[13px] break-words text-muted-foreground">
                      {ligne.societe}
                    </span>
                  ) : null}
                </td>
                <td className={`${CLASSE_CELLULE} min-w-48 break-words`}>{ligne.objet}</td>
                <td className={`${CLASSE_CELLULE} ${ORDINATEUR}`}>{ligne.categorie}</td>
                <td className={`${CLASSE_CELLULE} ${ORDINATEUR} whitespace-nowrap`}>
                  {LIBELLES_CANAL[ligne.canal]}
                </td>
                <td className={CLASSE_CELLULE}>
                  <BadgeStatut statut={ligne.statut} />
                </td>
                <td className={CLASSE_CELLULE}>
                  <BadgePriorite priorite={ligne.priorite} />
                </td>
                <td className={`${CLASSE_CELLULE} ${ORDINATEUR}`}>
                  {ligne.responsable ?? <Vide />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Téléphone : une carte par demande. */}
      <ul className="space-y-3 sm:hidden" aria-label="Demandes">
        {lignes.map((ligne) => (
          <li
            key={ligne.id}
            data-reference={ligne.reference}
            className="relative rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-background"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link
                href={adresseDetail(ligne.reference)}
                prefetch={false}
                className={CLASSE_LIEN_REFERENCE}
              >
                {ligne.reference}
              </Link>
              <span className="text-[13px] text-muted-foreground">
                {formaterDateHeure(ligne.creeLe)}
              </span>
            </div>
            <p className="mt-1.5 font-medium break-words">{ligne.objet}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <BadgeStatut statut={ligne.statut} />
              <BadgePriorite priorite={ligne.priorite} />
            </div>
            <p className="mt-2 text-[13px] break-words text-muted-foreground">
              {ligne.nom}
              {ligne.societe ? ` · ${ligne.societe}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
