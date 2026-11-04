import type { LigneHistorique } from "@/lib/detail-demande";
import {
  AUTEUR_DEMANDEUR,
  AUTEUR_INCONNU,
  CANAUX,
  LIBELLES_CANAL,
  LIBELLES_PRIORITE,
  LIBELLES_STATUT,
  NATURE_VALEUR_HISTORIQUE,
  PHRASES_HISTORIQUE,
  PRIORITES,
  STATUTS,
  type NatureValeurHistorique,
} from "@/lib/domaine";
import { formaterDateHeure } from "@/lib/format";

// Composant unique d'affichage de l'historique (AD-19, UX-DR11, DESIGN.md) :
// date et heure de Paris en petit gris, puis l'auteur en gras et l'action.
// Les codes et identifiants stockés sont traduits ici en libellés et en noms ;
// les phrases viennent de `lib/domaine.ts`. Du plus ancien au plus récent
// (ordre reçu de la lecture).

type Props = {
  lignes: LigneHistorique[];
  /** Lignes écartées par la validation : signalées sous l'historique. */
  lignesIllisibles?: number;
  nomsMembres: Record<string, string>;
  nomsCategories: Record<string, string>;
};

/** Valeur inconnue (code hors liste, identifiant illisible). */
const VALEUR_INCONNUE = "?";

function traduire(
  valeur: string | null,
  nature: NatureValeurHistorique,
  noms: Pick<Props, "nomsMembres" | "nomsCategories">,
): string | null {
  if (valeur === null) return null;
  switch (nature) {
    case "canal":
      // Canal inconnu : omis (« a saisi la demande »), jamais « (?) ».
      return (CANAUX as readonly string[]).includes(valeur)
        ? LIBELLES_CANAL[valeur as (typeof CANAUX)[number]]
        : null;
    case "statut":
      return (STATUTS as readonly string[]).includes(valeur)
        ? LIBELLES_STATUT[valeur as (typeof STATUTS)[number]]
        : VALEUR_INCONNUE;
    case "priorite":
      return (PRIORITES as readonly string[]).includes(valeur)
        ? LIBELLES_PRIORITE[valeur as (typeof PRIORITES)[number]]
        : VALEUR_INCONNUE;
    case "membre":
      return noms.nomsMembres[valeur] ?? AUTEUR_INCONNU;
    case "categorie":
      return noms.nomsCategories[valeur] ?? VALEUR_INCONNUE;
    default:
      return null;
  }
}

/** Auteur et phrase d'une ligne, ex. « Demandeur (formulaire) » + « a créé la demande ». */
export function texteLigneHistorique(
  ligne: LigneHistorique,
  noms: Pick<Props, "nomsMembres" | "nomsCategories">,
): { auteur: string; action: string } {
  const estDemandeur = ligne.auteurType === "demandeur";
  const auteur = estDemandeur
    ? AUTEUR_DEMANDEUR
    : ((ligne.auteurId && noms.nomsMembres[ligne.auteurId]) || AUTEUR_INCONNU);
  const nature = NATURE_VALEUR_HISTORIQUE[ligne.type];
  const action = PHRASES_HISTORIQUE[ligne.type](
    {
      ancienne: traduire(ligne.ancienneValeur, nature, noms),
      nouvelle: traduire(ligne.nouvelleValeur, nature, noms),
    },
    estDemandeur,
  );
  return { auteur, action };
}

function Illisibles({ nombre }: { nombre: number }) {
  if (nombre <= 0) return null;
  return (
    <p data-testid="historique-illisibles" className="mt-2 text-[13px] text-muted-foreground">
      {nombre} {nombre > 1 ? "événements illisibles" : "événement illisible"}
    </p>
  );
}

export function Historique({ lignes, lignesIllisibles = 0, nomsMembres, nomsCategories }: Props) {
  if (lignes.length === 0) {
    return (
      <>
        {lignesIllisibles > 0 ? null : (
          <p className="text-sm text-muted-foreground">Aucun événement.</p>
        )}
        <Illisibles nombre={lignesIllisibles} />
      </>
    );
  }
  return (
    <>
    <ol className="text-sm" data-testid="historique">
      {lignes.map((ligne) => {
        const { auteur, action } = texteLigneHistorique(ligne, { nomsMembres, nomsCategories });
        return (
          <li
            key={ligne.id}
            data-type={ligne.type}
            className="grid gap-1 border-b border-muted py-2 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3"
          >
            <time dateTime={ligne.creeLe} className="text-[13px] text-muted-foreground">
              {formaterDateHeure(ligne.creeLe)}
            </time>
            <span className="break-words">
              <b className="font-semibold">{auteur}</b> {action}
            </span>
          </li>
        );
      })}
    </ol>
    <Illisibles nombre={lignesIllisibles} />
    </>
  );
}
