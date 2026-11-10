"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import { deconnexion } from "@/lib/actions/comptes";
import { lireCompteurDemandes } from "@/lib/actions/demandes";
import { formaterNombre } from "@/lib/format";
import { cn } from "@/lib/utils";

// Menu latéral de l'espace équipe (UX-DR3, EXPERIENCE.md §2.2) : bleu marine,
// 240 px, seulement les rubriques qui existent ; groupe « Administration »
// pour les administrateurs ; en bas, nom, rôle et « Se déconnecter ».
// Sous 1 024 px, replié derrière un bouton « Menu ».
// Story 2.8 : compteur des demandes « À prendre en charge » à côté de
// « Demandes » et, sous 1 024 px, à côté du bouton « Menu » ; masqué à 0 ou
// en cas d'erreur. Hors du lien : son nom accessible reste « Demandes ».
// Valeur initiale lue par la mise en page, puis relue à chaque changement de
// page (la mise en page n'est pas rendue de nouveau lors d'une navigation) ;
// une réponse arrivée après une navigation plus récente est ignorée.

type Rubrique = { libelle: string; adresse: string };

const RUBRIQUES: Rubrique[] = [
  { libelle: "Accueil", adresse: "/equipe" },
  { libelle: "Demandes", adresse: "/equipe/demandes" },
  // Story 2.6 : saisie interne.
  { libelle: "Saisir une demande", adresse: "/equipe/demandes/nouvelle" },
];
// Story 4.1 : « Comptes » remplace la page provisoire « Vue d'ensemble ».
// Story 5.1 : « Journal » après « Comptes ».
const RUBRIQUES_ADMIN: Rubrique[] = [
  { libelle: "Comptes", adresse: "/equipe/admin/comptes" },
  { libelle: "Journal", adresse: "/equipe/admin/journal" },
];

type Props = {
  nom: string;
  libelleRole: string;
  estAdmin: boolean;
  /** Demandes « À prendre en charge » ; `null` si illisible. */
  aPrendreEnCharge?: number | null;
};

const CHEMIN_DEMANDES = "/equipe/demandes";

const CLASSE_LIEN =
  "flex min-h-11 items-center rounded-md px-3 text-[15px] font-medium text-sidebar-foreground/85 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-white/70 aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-foreground";

/** La page est-elle celle de la rubrique ou une de ses sous-pages (sauf l'accueil, exact) ? */
function correspond(chemin: string, adresse: string): boolean {
  return chemin === adresse || (adresse !== "/equipe" && chemin.startsWith(`${adresse}/`));
}

/**
 * Rubrique active : la plus précise qui correspond à la page. Sur
 * « Saisir une demande » (/equipe/demandes/nouvelle), seule cette rubrique
 * est active, pas « Demandes ».
 */
function estActive(chemin: string, adresse: string): boolean {
  if (!correspond(chemin, adresse)) return false;
  return ![...RUBRIQUES, ...RUBRIQUES_ADMIN].some(
    (autre) => autre.adresse.length > adresse.length && correspond(chemin, autre.adresse),
  );
}

/**
 * Compteur des demandes à prendre en charge, ou rien à 0 (ou illisible). Le
 * chiffre est lu « [n] à prendre en charge » par les lecteurs d'écran.
 */
function Compteur({ nombre, className }: { nombre: number | null | undefined; className?: string }) {
  if (typeof nombre !== "number" || nombre <= 0) return null;
  const texte = formaterNombre(nombre);
  return (
    <span
      data-compteur-menu
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-2 text-[13px] font-semibold text-sidebar",
        className,
      )}
    >
      <span aria-hidden="true">{texte}</span>
      <span className="sr-only">{`${texte} à prendre en charge`}</span>
    </span>
  );
}

function Lien({
  rubrique,
  actif,
  compteur,
}: {
  rubrique: Rubrique;
  actif: boolean;
  compteur?: number | null;
}) {
  return (
    <li className="relative">
      <Link href={rubrique.adresse} aria-current={actif ? "page" : undefined} className={CLASSE_LIEN}>
        {rubrique.libelle}
      </Link>
      {/* Hors du lien (nom accessible inchangé) ; les clics le traversent. */}
      <Compteur
        nombre={compteur}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
      />
    </li>
  );
}

export function MenuEquipe({ nom, libelleRole, estAdmin, aPrendreEnCharge = null }: Props) {
  const idMenu = useId();
  const chemin = usePathname();
  const [compteur, setCompteur] = useState(aPrendreEnCharge);
  const premierChemin = useRef(chemin);

  // Nouvelle valeur de la mise en page (rechargement, `refresh()` après une action).
  const [compteurInitial, setCompteurInitial] = useState(aPrendreEnCharge);
  if (aPrendreEnCharge !== compteurInitial) {
    setCompteurInitial(aPrendreEnCharge);
    setCompteur(aPrendreEnCharge);
  }

  // Changement de page : compteur relu (pas au premier rendu, déjà lu par la
  // mise en page). Une réponse tardive, après une autre navigation, est ignorée.
  useEffect(() => {
    if (chemin === premierChemin.current) return;
    premierChemin.current = "";
    let actuel = true;
    lireCompteurDemandes()
      .then((nombre) => {
        if (actuel) setCompteur(nombre);
      })
      .catch(() => {
        if (actuel) setCompteur(null);
      });
    return () => {
      actuel = false;
    };
  }, [chemin]);
  const [ouvert, setOuvert] = useState(false);
  const [cheminVu, setCheminVu] = useState(chemin);

  // Changement de page : le menu replié se referme.
  if (chemin !== cheminVu) {
    setCheminVu(chemin);
    setOuvert(false);
  }

  const boutonRef = useRef<HTMLButtonElement>(null);
  const panneauRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    // À l'ouverture, le focus entre dans le panneau (premier lien).
    panneauRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    // Échap referme le menu replié et rend le focus au bouton « Menu ».
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") {
        setOuvert(false);
        boutonRef.current?.focus();
      }
    };
    // À partir de 1 024 px, le menu est toujours visible : l'état replié
    // ouvert n'a plus de sens.
    const ordinateur = window.matchMedia("(min-width: 1024px)");
    const surLargeur = () => {
      if (ordinateur.matches) setOuvert(false);
    };
    surLargeur();
    document.addEventListener("keydown", surTouche);
    ordinateur.addEventListener("change", surLargeur);
    return () => {
      document.removeEventListener("keydown", surTouche);
      ordinateur.removeEventListener("change", surLargeur);
    };
  }, [ouvert]);

  return (
    <>
      {/* Barre du haut, sous 1 024 px seulement. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-sidebar px-4 text-sidebar-foreground lg:hidden">
        <button
          ref={boutonRef}
          type="button"
          aria-expanded={ouvert}
          aria-controls={idMenu}
          onClick={() => setOuvert((valeur) => !valeur)}
          className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-[15px] font-semibold outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-white/70"
        >
          {ouvert ? (
            <XIcon aria-hidden="true" className="size-5" />
          ) : (
            <MenuIcon aria-hidden="true" className="size-5" />
          )}
          Menu
        </button>
        <Compteur nombre={compteur} />
        <span className="text-[15px] font-semibold">Nova Services</span>
      </header>

      <nav
        ref={panneauRef}
        id={idMenu}
        aria-label="Menu de l'espace équipe"
        className={cn(
          "z-20 flex-col bg-sidebar text-sidebar-foreground",
          // Sous 1 024 px : panneau sous la barre du haut, visible si ouvert.
          ouvert ? "fixed inset-x-0 top-14 bottom-0 flex overflow-y-auto" : "hidden",
          // À partir de 1 024 px : colonne fixe de 240 px, toujours visible.
          "lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0",
        )}
      >
        <p className="hidden px-5 pt-6 pb-4 text-lg font-semibold leading-[1.4] lg:block">
          Nova Services
        </p>

        <div className="flex-1 px-3 py-3 lg:py-0">
          <ul className="space-y-1">
            {RUBRIQUES.map((rubrique) => (
              <Lien
                key={rubrique.adresse}
                rubrique={rubrique}
                actif={estActive(chemin, rubrique.adresse)}
                compteur={rubrique.adresse === CHEMIN_DEMANDES ? compteur : undefined}
              />
            ))}
          </ul>

          {estAdmin ? (
            <div className="mt-6">
              <h2 className="px-3 pb-2 text-xs font-semibold tracking-wide text-sidebar-foreground/70 uppercase">
                Administration
              </h2>
              <ul className="space-y-1">
                {RUBRIQUES_ADMIN.map((rubrique) => (
                  <Lien
                    key={rubrique.adresse}
                    rubrique={rubrique}
                    actif={estActive(chemin, rubrique.adresse)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="border-t border-sidebar-border px-5 py-4">
          <p className="text-[15px] font-semibold leading-[1.4] break-words">{nom}</p>
          <p className="text-[13px] text-sidebar-foreground/75">{libelleRole}</p>
          <form action={deconnexion} className="mt-3">
            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-sidebar-border px-3 text-sm font-semibold outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-white/70"
            >
              Se déconnecter
            </button>
          </form>
        </div>
      </nav>
    </>
  );
}
