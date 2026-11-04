import { LIBELLES_PRIORITE, LIBELLES_STATUT, type Priorite, type Statut } from "@/lib/domaine";
import { cn } from "@/lib/utils";

// Badges de statut et de priorité (UX-DR2, DESIGN.md) : toujours avec le mot,
// jamais la couleur seule. Statut en pilule (Nouvelle bleu, En cours orange,
// Traitée vert) ; priorité en rectangle léger (Haute rouge, Normale et Basse gris).

const COULEURS_STATUT: Record<Statut, string> = {
  nouvelle: "bg-status-nouvelle-bg text-status-nouvelle-fg",
  en_cours: "bg-status-encours-bg text-status-encours-fg",
  traitee: "bg-status-traitee-bg text-status-traitee-fg",
};

const COULEURS_PRIORITE: Record<Priorite, string> = {
  haute: "bg-priority-haute-bg text-priority-haute-fg",
  normale: "bg-priority-normale-bg text-priority-normale-fg",
  basse: "border border-border bg-priority-basse-bg text-priority-basse-fg",
};

export function BadgeStatut({ statut }: { statut: Statut }) {
  return (
    <span
      data-statut={statut}
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-medium whitespace-nowrap",
        COULEURS_STATUT[statut],
      )}
    >
      {LIBELLES_STATUT[statut]}
    </span>
  );
}

export function BadgePriorite({ priorite }: { priorite: Priorite }) {
  return (
    <span
      data-priorite={priorite}
      className={cn(
        "inline-block rounded-sm px-2 py-0.5 text-[13px] leading-5 font-medium whitespace-nowrap",
        COULEURS_PRIORITE[priorite],
      )}
    >
      {LIBELLES_PRIORITE[priorite]}
    </span>
  );
}
