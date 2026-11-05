"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import { deconnexion } from "@/lib/actions/comptes";
import { cn } from "@/lib/utils";

// Menu latéral de l'espace équipe (UX-DR3, EXPERIENCE.md §2.2) : bleu marine,
// 240 px, seulement les rubriques qui existent ; groupe « Administration »
// pour les administrateurs ; en bas, nom, rôle et « Se déconnecter ».
// Sous 1 024 px, replié derrière un bouton « Menu ».

type Rubrique = { libelle: string; adresse: string };

const RUBRIQUES: Rubrique[] = [
  { libelle: "Accueil", adresse: "/equipe" },
  { libelle: "Demandes", adresse: "/equipe/demandes" },
  // Story 2.6 : saisie interne.
  { libelle: "Saisir une demande", adresse: "/equipe/demandes/nouvelle" },
];
const RUBRIQUES_ADMIN: Rubrique[] = [{ libelle: "Vue d'ensemble", adresse: "/equipe/admin" }];

type Props = {
  nom: string;
  libelleRole: string;
  estAdmin: boolean;
};

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

function Lien({ rubrique, actif }: { rubrique: Rubrique; actif: boolean }) {
  return (
    <li>
      <Link href={rubrique.adresse} aria-current={actif ? "page" : undefined} className={CLASSE_LIEN}>
        {rubrique.libelle}
      </Link>
    </li>
  );
}

export function MenuEquipe({ nom, libelleRole, estAdmin }: Props) {
  const idMenu = useId();
  const chemin = usePathname();
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
              <Lien key={rubrique.adresse} rubrique={rubrique} actif={estActive(chemin, rubrique.adresse)} />
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
