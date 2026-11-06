import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LigneDemande } from "@/lib/demandes";
import type { Resultat } from "@/lib/server/appeler";
import type { TableauDeBord as Donnees } from "@/lib/tableau-de-bord";

// Story 2.8 — états du tableau de bord et compteur du menu, sans base :
// cartes (ordre, nom accessible « [libellé] : [nombre] », adresses, mise en
// avant), « Mes demandes en cours » (lignes et « Tout voir », ou « Aucune
// demande en cours à votre nom. »), état vide (critère 4, sans vider la base
// partagée), squelettes, bandeau d'erreur ; compteur du menu à côté de
// « Demandes » et du bouton « Menu », masqué à 0 ou en cas d'erreur, hors du
// lien « Demandes ».

const lecture = vi.hoisted(() => ({ resultat: null as unknown }));

vi.mock("@/lib/tableau-de-bord", async (importer) => ({
  ...(await importer<typeof import("@/lib/tableau-de-bord")>()),
  lireTableauDeBord: async () => lecture.resultat,
}));

vi.mock("next/navigation", async (importer) => ({
  ...(await importer<typeof import("next/navigation")>()),
  usePathname: () => "/equipe",
}));

vi.mock("@/lib/actions/comptes", () => ({ deconnexion: async () => {} }));
vi.mock("@/lib/actions/demandes", () => ({ lireCompteurDemandes: async () => null }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...autres }: Record<string, unknown>) => {
    const attributs = Object.fromEntries(
      Object.entries(autres).filter(([cle]) => cle !== "prefetch"),
    );
    return (
      <a href={String(href)} {...attributs}>
        {children as React.ReactNode}
      </a>
    );
  },
}));

import { MenuEquipe } from "@/components/nova/menu-equipe";
import {
  ContenuTableauDeBord,
  SqueletteTableauDeBord,
} from "@/components/nova/tableau-de-bord";
import { CARTES, adresseCarte } from "@/lib/tableau-de-bord";

function ligne(i: number): LigneDemande {
  return {
    id: `id-${i}`,
    reference: `NOVA-2026-${String(i).padStart(4, "0")}`,
    creeLe: "2026-11-03T08:12:00Z",
    nom: "Jean Dupont",
    societe: null,
    objet: `Objet ${i}`,
    categorie: "Problème technique",
    canal: "formulaire",
    statut: "en_cours",
    priorite: "haute",
    responsable: "Karim Benali",
  };
}

function donnees(nombres: number[], mesDemandes: LigneDemande[] = [], vide = false): Donnees {
  return {
    cartes: CARTES.map((carte, i) => ({
      ...carte,
      nombre: nombres[i],
      adresse: adresseCarte(carte.filtres),
    })),
    mesDemandes,
    adresseMesDemandes: "/equipe/demandes?statut=en_cours&responsable=moi",
    vide,
  };
}

async function rendre(resultat: Resultat<Donnees>): Promise<string> {
  lecture.resultat = resultat;
  return renderToStaticMarkup(await ContenuTableauDeBord());
}

const NBSP = String.fromCharCode(0xa0);

beforeEach(() => {
  lecture.resultat = null;
});

describe("tableau de bord", () => {
  it("5 cartes cliquables, dans l'ordre, nom accessible « [libellé] : [nombre] »", async () => {
    const html = await rendre({ ok: true, donnees: donnees([3, 0, 1234, 2, 15], [ligne(1)]) });
    // Nom accessible : texte du lien (libellé, « : » pour les lecteurs d'écran, nombre).
    const liens = [...html.matchAll(/<a href="([^"]*)" data-carte="[^"]*"[^>]*>(.*?)<\/a>/g)];
    const texte = (contenu: string) => contenu.replace(/<[^>]+>/g, "");
    expect(liens.map((l) => [l[1].replace(/&amp;/g, "&"), texte(l[2])])).toEqual([
      ["/equipe/demandes?statut=nouvelle&responsable=aucun", "À prendre en charge : 3"],
      ["/equipe/demandes?statut=non_traitees&priorite=haute", "Priorité Haute non traitées : 0"],
      ["/equipe/demandes?statut=nouvelle", `Nouvelle : 1${NBSP}234`],
      ["/equipe/demandes?statut=en_cours", "En cours : 2"],
      ["/equipe/demandes?statut=traitee", "Traitée : 15"],
    ]);
    // « À prendre en charge » seule mise en avant.
    expect(html.match(/border-2 border-primary/g)).toHaveLength(1);
    expect(html).toMatch(/data-carte="a_prendre" class="[^"]*border-2 border-primary/);
  });

  it("« Mes demandes en cours » : les lignes de la liste et « Tout voir »", async () => {
    const lignes = [1, 2, 3, 4, 5].map(ligne);
    const html = await rendre({ ok: true, donnees: donnees([1, 1, 1, 1, 1], lignes) });
    expect(html).toContain(">Mes demandes en cours</h2>");
    expect(html).toMatch(
      /<a href="\/equipe\/demandes\?statut=en_cours&amp;responsable=moi"[^>]*>Tout voir<\/a>/,
    );
    expect(html).toContain('aria-label="Mes demandes en cours"');
    for (const l of lignes) {
      expect(html).toContain(`href="/equipe/demandes/${l.reference}"`);
      expect(html).toContain(l.objet);
    }
    expect(html).toContain(">En cours<");
    expect(html).toContain(">Haute<");
    expect(html).not.toContain("Aucune demande en cours à votre nom.");
  });

  it("aucune demande à mon nom : message, cartes présentes", async () => {
    const html = await rendre({ ok: true, donnees: donnees([2, 1, 2, 4, 9]) });
    expect(html).toContain("Aucune demande en cours à votre nom.");
    expect(html.match(/data-carte=/g)).toHaveLength(5);
    expect(html).toContain("Tout voir");
    expect(html).not.toContain("<table");
  });

  it("critère 4 : aucune demande, message et « Copier le lien », sans cartes", async () => {
    const html = await rendre({ ok: true, donnees: donnees([0, 0, 0, 0, 0], [], true) });
    expect(html).toContain(
      "Aucune demande pour l&#x27;instant. Partagez le lien du formulaire à vos clients.",
    );
    expect(html).toMatch(/<button[^>]*>.*Copier le lien.*<\/button>/);
    expect(html).not.toContain("data-carte=");
    expect(html).not.toContain("Mes demandes en cours");
  });

  it("erreur de lecture : bandeau et « Réessayer »", async () => {
    const html = await rendre({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: "Le serveur ne répond pas.",
    });
    expect(html).toMatch(/role="alert"[^>]*>.*Impossible de charger le tableau de bord\./);
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("data-carte=");
  });

  it("chargement : squelettes des 5 cartes", () => {
    const html = renderToStaticMarkup(<SqueletteTableauDeBord />);
    expect(html.match(/data-squelette="carte"/g)).toHaveLength(5);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Chargement du tableau de bord…");
  });
});

describe("compteur du menu", () => {
  const rendreMenu = (aPrendreEnCharge: number | null) =>
    renderToStaticMarkup(
      <MenuEquipe
        nom="Karim Benali"
        libelleRole="Collaborateur"
        estAdmin={false}
        aPrendreEnCharge={aPrendreEnCharge}
      />,
    );

  it("à côté de « Demandes » et du bouton « Menu », lu « [n] à prendre en charge »", () => {
    const html = rendreMenu(3);
    expect(html.match(/data-compteur-menu/g)).toHaveLength(2);
    expect(html.match(/3 à prendre en charge/g)).toHaveLength(2);
    // Hors du lien : son nom accessible reste exactement « Demandes ».
    expect(html).toMatch(/<a href="\/equipe\/demandes"[^>]*>Demandes<\/a><span[^>]*data-compteur-menu/);
    // Juste après le bouton « Menu », dans la barre du haut.
    expect(html).toMatch(/Menu<\/button><span[^>]*data-compteur-menu/);
  });

  it("nombre formaté (« 1 234 »)", () => {
    expect(rendreMenu(1234)).toContain(`1${NBSP}234 à prendre en charge`);
  });

  it.each([
    ["à 0", 0],
    ["en cas d'erreur", null],
  ])("masqué %s", (_cas, nombre) => {
    const html = rendreMenu(nombre);
    expect(html).not.toContain("data-compteur-menu");
    expect(html).not.toContain("à prendre en charge");
    expect(html).toMatch(/<a href="\/equipe\/demandes"[^>]*>Demandes<\/a>/);
  });
});
