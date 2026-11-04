import { describe, expect, it } from "vitest";
import { libellePagination } from "@/components/nova/pagination";
import {
  adresseAvecPage,
  bornerPage,
  intervalle,
  lireNumeroPage,
  nombreDePages,
  rangsAffiches,
  TAILLE_PAGE,
  TRI_PAR_DEFAUT,
} from "@/lib/filtres";

// Story 1.5 — lib/filtres.ts : tri, pagination et numéro de page dans l'adresse.

describe("lireNumeroPage", () => {
  it("lit un entier positif", () => {
    expect(lireNumeroPage("1")).toBe(1);
    expect(lireNumeroPage("2")).toBe(2);
    expect(lireNumeroPage(" 3 ")).toBe(3);
    expect(lireNumeroPage(["4", "5"])).toBe(4);
  });

  it("ramène à la page 1 toute valeur invalide", () => {
    for (const valeur of [undefined, "", "abc", "0", "-2", "2.5", "1e3", "2abc", "0x10", []]) {
      expect(lireNumeroPage(valeur as string | string[] | undefined), String(valeur)).toBe(1);
    }
  });

  it("garde un numéro trop grand (borné), ramené ensuite à la dernière page", () => {
    expect(lireNumeroPage("99")).toBe(99);
    expect(lireNumeroPage("99999999999999999999999")).toBe(1_000_000);
  });
});

describe("pagination", () => {
  it("25 lignes par page, plus récentes d'abord", () => {
    expect(TAILLE_PAGE).toBe(25);
    expect(TRI_PAR_DEFAUT).toEqual({ colonne: "cree_le", croissant: false });
  });

  it("nombre de pages", () => {
    expect(nombreDePages(0)).toBe(1);
    expect(nombreDePages(1)).toBe(1);
    expect(nombreDePages(25)).toBe(1);
    expect(nombreDePages(26)).toBe(2);
    expect(nombreDePages(40)).toBe(2);
    expect(nombreDePages(51)).toBe(3);
  });

  it("borne la page entre 1 et la dernière", () => {
    expect(bornerPage(99, 40)).toBe(2);
    expect(bornerPage(0, 40)).toBe(1);
    expect(bornerPage(-3, 40)).toBe(1);
    expect(bornerPage(2, 40)).toBe(2);
    expect(bornerPage(5, 0)).toBe(1);
  });

  it("intervalle des lignes à lire", () => {
    expect(intervalle(1)).toEqual({ de: 0, a: 24 });
    expect(intervalle(2)).toEqual({ de: 25, a: 49 });
  });

  it("rangs affichés et libellé « 1–25 sur 40 »", () => {
    expect(rangsAffiches(1, 40)).toEqual({ premier: 1, dernier: 25 });
    expect(rangsAffiches(2, 40)).toEqual({ premier: 26, dernier: 40 });
    expect(rangsAffiches(99, 40)).toEqual({ premier: 26, dernier: 40 });
    expect(rangsAffiches(1, 0)).toEqual({ premier: 0, dernier: 0 });

    expect(libellePagination(1, 40, 25)).toBe("1–25 sur 40");
    expect(libellePagination(2, 40, 25)).toBe("26–40 sur 40");
    expect(libellePagination(1, 3, 25)).toBe("1–3 sur 3");
    expect(libellePagination(1, 1320, 25)).toBe("1–25 sur 1 320");
  });
});

describe("adresseAvecPage", () => {
  it("page 1 sans paramètre, les autres avec ?page=", () => {
    expect(adresseAvecPage("/equipe/demandes", {}, 1)).toBe("/equipe/demandes");
    expect(adresseAvecPage("/equipe/demandes", {}, 2)).toBe("/equipe/demandes?page=2");
  });

  it("garde les autres paramètres et remplace l'ancien numéro", () => {
    expect(
      adresseAvecPage("/equipe/demandes", { page: "3", statut: "nouvelle", x: ["a", "b"] }, 4),
    ).toBe("/equipe/demandes?statut=nouvelle&x=a&x=b&page=4");
    expect(adresseAvecPage("/equipe/demandes", { page: "3", statut: "nouvelle" }, 1)).toBe(
      "/equipe/demandes?statut=nouvelle",
    );
  });
});
