import Link from "next/link";
import { CopierLien } from "@/components/nova/copier-lien";
import { ListeDemandes } from "@/components/nova/liste-demandes";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { MESSAGE_AUCUNE_DEMANDE } from "@/lib/domaine";
import { formaterNombre } from "@/lib/format";
import {
  CARTES,
  lireTableauDeBord,
  type Carte,
  type TableauDeBord as Donnees,
} from "@/lib/tableau-de-bord";
import { cn } from "@/lib/utils";

// Tableau de bord de l'espace équipe (story 2.8, EXPERIENCE.md §5 et §9.3) :
//   - cinq cartes chiffrées cliquables, chacune ouvrant la liste filtrée dont
//     le total est ce chiffre ; « À prendre en charge » mise en avant ;
//   - « Mes demandes en cours » : les 5 dernières, « Tout voir » ;
//   - vide : message et « Copier le lien » du formulaire public ;
//   - chargement : squelettes des 5 cartes ; erreur : bandeau et « Réessayer ».
// Cartes en `a` Tailwind (DESIGN.md : fond blanc, bordure, coins 8 px,
// ombre légère) : pas de shadcn `Card` installé.

export const MESSAGE_ERREUR_TABLEAU = "Impossible de charger le tableau de bord.";
export const MESSAGE_AUCUNE_EN_COURS = "Aucune demande en cours à votre nom.";

const CLASSE_CARTE =
  "flex min-h-24 flex-col justify-between gap-2 rounded-lg border bg-surface p-4 shadow-xs outline-none transition-colors hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50";

const CLASSE_GRILLE = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5";

function CarteChiffree({ carte }: { carte: Carte }) {
  const nombre = formaterNombre(carte.nombre);
  return (
    <li>
      <Link
        href={carte.adresse}
        data-carte={carte.cle}
        className={cn(
          CLASSE_CARTE,
          "h-full",
          carte.miseEnAvant ? "border-2 border-primary bg-primary/5" : "border-border",
        )}
      >
        {/* Nom accessible « [libellé] : [nombre] », par le contenu visible. */}
        <span className="text-[15px] font-medium leading-[1.4]">{carte.libelle}</span>
        <span className="sr-only">{" : "}</span>
        <span
          data-nombre
          className={cn(
            "text-3xl font-semibold leading-none",
            carte.miseEnAvant ? "text-primary" : "text-foreground",
          )}
        >
          {nombre}
        </span>
      </Link>
    </li>
  );
}

function MesDemandesEnCours({ donnees }: { donnees: Donnees }) {
  return (
    <section aria-labelledby="mes-demandes-en-cours" className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mes-demandes-en-cours" className="text-lg font-semibold leading-[1.4]">
          Mes demandes en cours
        </h2>
        <Link
          href={donnees.adresseMesDemandes}
          className="text-[15px] font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Tout voir
        </Link>
      </div>
      {donnees.mesDemandes.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
          <p className="text-[15px]">{MESSAGE_AUCUNE_EN_COURS}</p>
        </div>
      ) : (
        <ListeDemandes lignes={donnees.mesDemandes} libelle="Mes demandes en cours" />
      )}
    </section>
  );
}

/** Tableau de bord lu : cartes et « Mes demandes en cours », ou l'état vide. */
export function TableauDeBord({ donnees }: { donnees: Donnees }) {
  if (donnees.vide) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-4 py-10 text-center">
        <p className="text-[15px]">{MESSAGE_AUCUNE_DEMANDE}</p>
        <CopierLien />
      </div>
    );
  }
  return (
    <>
      <ul aria-label="Chiffres des demandes" className={CLASSE_GRILLE}>
        {donnees.cartes.map((carte) => (
          <CarteChiffree key={carte.cle} carte={carte} />
        ))}
      </ul>
      <MesDemandesEnCours donnees={donnees} />
    </>
  );
}

/** Bandeau d'erreur de lecture. */
export function ErreurTableauDeBord() {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="font-medium text-destructive">{MESSAGE_ERREUR_TABLEAU}</p>
      <BoutonReessayer />
    </div>
  );
}

function Barre({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-sm bg-muted ${className}`} />;
}

/** Chargement : squelettes des 5 cartes. */
export function SqueletteTableauDeBord() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Chargement du tableau de bord…
      </p>
      <div className={CLASSE_GRILLE}>
        {CARTES.map((carte) => (
          <div
            key={carte.cle}
            data-squelette="carte"
            className="flex min-h-24 flex-col justify-between gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <Barre className="h-4 w-3/4" />
            <Barre className="h-7 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lit puis affiche le tableau de bord (dans un `Suspense` de la page). */
export async function ContenuTableauDeBord() {
  const resultat = await lireTableauDeBord();
  if (!resultat.ok) return <ErreurTableauDeBord />;
  return <TableauDeBord donnees={resultat.donnees} />;
}
