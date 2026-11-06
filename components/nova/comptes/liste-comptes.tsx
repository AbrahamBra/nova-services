import type { Compte } from "@/lib/comptes";
import { LIBELLES_ETAT_MEMBRE, LIBELLES_ROLE, type EtatMembre } from "@/lib/domaine";
import { cn } from "@/lib/utils";

// Liste des comptes (EXPERIENCE.md §9.7, story 4.1) : tableau Nom · Email ·
// Rôle · État sur tablette et ordinateur ; une carte par compte sur
// téléphone (< 640 px). Trié par nom (lib/comptes.ts). Les actions par
// ligne arrivent avec les stories 4.2 à 4.4.

/** Seul l'administrateur connecté : message de liste vide. */
export const MESSAGE_AUCUN_COMPTE = "Aucun autre compte. Invitez un premier collaborateur.";

const CLASSE_ENTETE =
  "border-b border-border bg-background px-3 py-2.5 text-left text-[13px] font-medium whitespace-nowrap text-muted-foreground";
const CLASSE_CELLULE = "border-b border-muted px-3 py-3 align-top";

// État toujours écrit en toutes lettres (jamais la couleur seule).
const COULEURS_ETAT: Record<EtatMembre, string> = {
  invite: "bg-status-nouvelle-bg text-status-nouvelle-fg",
  actif: "bg-status-traitee-bg text-status-traitee-fg",
  desactive: "border border-border bg-priority-basse-bg text-priority-basse-fg",
};

export function BadgeEtatMembre({ etat }: { etat: EtatMembre }) {
  return (
    <span
      data-etat={etat}
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-medium whitespace-nowrap",
        COULEURS_ETAT[etat],
      )}
    >
      {LIBELLES_ETAT_MEMBRE[etat]}
    </span>
  );
}

/** Vrai si la liste ne contient aucun autre compte que celui de la personne connectée. */
export function aucunAutreCompte(comptes: Compte[], idConnecte: string): boolean {
  return comptes.every((compte) => compte.id === idConnecte);
}

export function ListeComptes({ comptes, idConnecte }: { comptes: Compte[]; idConnecte: string }) {
  if (aucunAutreCompte(comptes, idConnecte)) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-6 text-[15px] text-muted-foreground">
        {MESSAGE_AUCUN_COMPTE}
      </p>
    );
  }

  return (
    <>
      {/* Tablette et ordinateur. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table aria-label="Comptes" className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={CLASSE_ENTETE}>Nom</th>
              <th scope="col" className={CLASSE_ENTETE}>Email</th>
              <th scope="col" className={CLASSE_ENTETE}>Rôle</th>
              <th scope="col" className={CLASSE_ENTETE}>État</th>
            </tr>
          </thead>
          <tbody>
            {comptes.map((compte) => (
              <tr key={compte.id} data-compte={compte.email} className="last:[&>td]:border-b-0">
                <td className={`${CLASSE_CELLULE} min-w-40 font-medium break-words`}>
                  {compte.nom}
                  {compte.id === idConnecte ? (
                    <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">(vous)</span>
                  ) : null}
                </td>
                <td className={`${CLASSE_CELLULE} wrap-anywhere`}>{compte.email}</td>
                <td className={`${CLASSE_CELLULE} whitespace-nowrap`}>{LIBELLES_ROLE[compte.role]}</td>
                <td className={CLASSE_CELLULE}>
                  <BadgeEtatMembre etat={compte.etat} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Téléphone : une carte par compte. */}
      <ul className="space-y-3 sm:hidden" aria-label="Comptes">
        {comptes.map((compte) => (
          <li
            key={compte.id}
            data-compte={compte.email}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-medium break-words">
                {compte.nom}
                {compte.id === idConnecte ? (
                  <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">(vous)</span>
                ) : null}
              </p>
              <BadgeEtatMembre etat={compte.etat} />
            </div>
            <p className="mt-1 text-[13px] wrap-anywhere text-muted-foreground">{compte.email}</p>
            <p className="mt-1 text-[13px]">{LIBELLES_ROLE[compte.role]}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Lignes squelettes pendant le chargement (EXPERIENCE.md §5). */
export function SqueletteComptes() {
  return (
    <div aria-hidden="true" className="space-y-3" data-testid="squelette-comptes">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
