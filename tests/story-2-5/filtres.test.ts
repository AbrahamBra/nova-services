import { describe, expect, it } from "vitest";
import { adresseDetail } from "@/components/nova/liste-demandes";
import {
  aDesFiltres,
  adresseListe,
  conditionsDesFiltres,
  estAdresseCanonique,
  lireFiltres,
  lireNumeroPage,
  normaliserRecherche,
  parametresListe,
} from "@/lib/filtres";

// Story 2.5 — lib/filtres.ts : lecture et écriture des filtres de l'adresse,
// valeurs invalides ignorées, traduction en conditions sur la vue (AD-25).

const UUID = "0b9f2c4e-3d6a-4b1c-9e8f-7a6b5c4d3e2f";
const CHEMIN = "/equipe/demandes";

describe("lireFiltres", () => {
  it("lit chaque filtre valide", () => {
    expect(
      lireFiltres({
        q: "  dupont ",
        statut: "non_traitees",
        priorite: "haute",
        categorie: UUID.toUpperCase(),
        canal: "telephone",
        responsable: "aucun",
      }),
    ).toEqual({
      q: "dupont",
      statut: "non_traitees",
      priorite: "haute",
      categorie: UUID,
      canal: "telephone",
      responsable: "aucun",
    });
    expect(lireFiltres({ statut: "traitee", responsable: "moi" })).toEqual({
      statut: "traitee",
      responsable: "moi",
    });
    expect(lireFiltres({ responsable: UUID })).toEqual({ responsable: UUID });
  });

  it("ignore une valeur invalide, sans erreur", () => {
    expect(
      lireFiltres({
        statut: "fermee",
        priorite: "urgente",
        categorie: "abc",
        canal: "courrier",
        responsable: "personne",
        q: "   ",
      }),
    ).toEqual({});
    expect(lireFiltres({ statut: "Nouvelle", canal: "EMAIL" })).toEqual({});
    expect(lireFiltres({ q: "a".repeat(101) })).toEqual({});
    expect(lireFiltres({ q: "a".repeat(100) })).toEqual({ q: "a".repeat(100) });
    expect(lireNumeroPage("-1")).toBe(1);
  });

  it("prend la première valeur d'un paramètre répété", () => {
    expect(lireFiltres({ statut: ["nouvelle", "traitee"], q: ["un", "deux"] })).toEqual({
      statut: "nouvelle",
      q: "un",
    });
  });

  it("garde les caractères spéciaux du texte cherché", () => {
    expect(lireFiltres({ q: "%" })).toEqual({ q: "%" });
    expect(lireFiltres({ q: "_" })).toEqual({ q: "_" });
    expect(lireFiltres({ q: "l'été" })).toEqual({ q: "l'été" });
  });
});

describe("normaliserRecherche (même traitement que prive.normaliser)", () => {
  it("minuscules, accents, ligatures, tirets, apostrophes, espaces", () => {
    expect(normaliserRecherche("  Dupont-Aïdi   ÉCOLE Œuvre Straße l’été Łódź Ștefan d'Arc ")).toBe(
      "dupont aidi ecole oeuvre strasse l ete lodz stefan d arc",
    );
    expect(normaliserRecherche("Dupont Aïdi")).toBe(normaliserRecherche("Dupont-Aïdi"));
    expect(normaliserRecherche("100% le_lot \\")).toBe("100% le_lot \\");
  });

  it("un texte sans rien à chercher une fois normalisé est ignoré", () => {
    expect(lireFiltres({ q: "-" })).toEqual({});
    expect(lireFiltres({ q: "' ’" })).toEqual({});
    expect(lireFiltres({ q: "-a" })).toEqual({ q: "-a" });
  });
});

describe("écriture de l'adresse", () => {
  it("ordre fixe, page 1 sans paramètre", () => {
    expect(adresseListe(CHEMIN, {})).toBe(CHEMIN);
    expect(adresseListe(CHEMIN, { priorite: "haute", statut: "non_traitees" })).toBe(
      `${CHEMIN}?statut=non_traitees&priorite=haute`,
    );
    expect(adresseListe(CHEMIN, { responsable: "aucun", q: "Dupont-Aïdi" }, 3)).toBe(
      `${CHEMIN}?q=Dupont-A%C3%AFdi&responsable=aucun&page=3`,
    );
  });

  it("encode les caractères spéciaux", () => {
    expect(adresseListe(CHEMIN, { q: "50% & _x'" })).toBe(`${CHEMIN}?q=50%25+%26+_x%27`);
    const relu = new URLSearchParams(adresseListe(CHEMIN, { q: "50% & _x'" }).split("?")[1]);
    expect(lireFiltres(Object.fromEntries(relu))).toEqual({ q: "50% & _x'" });
  });

  it("aller-retour : relire l'adresse écrite donne les mêmes filtres", () => {
    const filtres = {
      q: "aidi",
      statut: "en_cours",
      priorite: "basse",
      categorie: UUID,
      canal: "email",
      responsable: "moi",
    } as const;
    expect(lireFiltres(parametresListe(filtres, 2))).toEqual(filtres);
    expect(parametresListe(filtres, 2).page).toBe("2");
  });

  it("aDesFiltres", () => {
    expect(aDesFiltres({})).toBe(false);
    expect(aDesFiltres({ q: "" })).toBe(false);
    expect(aDesFiltres({ q: "x" })).toBe(true);
    expect(aDesFiltres({ canal: "email" })).toBe(true);
  });

  it("adresse canonique : valeurs invalides, doublons, page", () => {
    const valides = { statut: "nouvelle", page: "2" };
    expect(estAdresseCanonique(valides, lireFiltres(valides), 2)).toBe(true);
    // Ordre indifférent.
    const desordre = { page: "2", priorite: "haute", statut: "nouvelle" };
    expect(estAdresseCanonique(desordre, lireFiltres(desordre), 2)).toBe(true);

    const invalide = { statut: "fermee" };
    expect(estAdresseCanonique(invalide, lireFiltres(invalide), 1)).toBe(false);
    expect(adresseListe(CHEMIN, lireFiltres(invalide), 1)).toBe(CHEMIN);

    const espaces = { q: " dupont " };
    expect(estAdresseCanonique(espaces, lireFiltres(espaces), 1)).toBe(false);
    expect(estAdresseCanonique({ statut: ["nouvelle", "traitee"] }, { statut: "nouvelle" }, 1)).toBe(
      false,
    );
    expect(estAdresseCanonique({ page: "1" }, {}, 1)).toBe(false);
    expect(estAdresseCanonique({ autre: "x" }, {}, 1)).toBe(false);
    expect(estAdresseCanonique({}, {}, 1)).toBe(true);
  });

  it("lien du détail : tous les filtres et la page", () => {
    expect(
      adresseDetail("NOVA-2026-0042", parametresListe({ statut: "non_traitees", q: "dupont" }), 2),
    ).toBe("/equipe/demandes/NOVA-2026-0042?q=dupont&statut=non_traitees&page=2");
  });
});

describe("conditionsDesFiltres", () => {
  it("aucun filtre : aucune condition", () => {
    expect(conditionsDesFiltres({}, null)).toEqual([]);
    // La recherche texte passe par rechercher_demandes, pas par une condition.
    expect(conditionsDesFiltres({ q: "dupont" }, null)).toEqual([]);
  });

  it("« Non traitées » = Nouvelle et En cours ; un statut précis", () => {
    expect(conditionsDesFiltres({ statut: "non_traitees" }, null)).toEqual([
      { colonne: "statut", operateur: "in", valeurs: ["nouvelle", "en_cours"] },
    ]);
    expect(conditionsDesFiltres({ statut: "traitee" }, null)).toEqual([
      { colonne: "statut", operateur: "eq", valeur: "traitee" },
    ]);
  });

  it("priorité, catégorie, canal combinés", () => {
    expect(
      conditionsDesFiltres({ priorite: "haute", categorie: UUID, canal: "formulaire" }, null),
    ).toEqual([
      { colonne: "priorite", operateur: "eq", valeur: "haute" },
      { colonne: "categorie_id", operateur: "eq", valeur: UUID },
      { colonne: "canal", operateur: "eq", valeur: "formulaire" },
    ]);
  });

  it("responsable : aucun, moi, un membre", () => {
    expect(conditionsDesFiltres({ responsable: "aucun" }, null)).toEqual([
      { colonne: "responsable_id", operateur: "est_vide" },
    ]);
    expect(conditionsDesFiltres({ responsable: "moi" }, UUID)).toEqual([
      { colonne: "responsable_id", operateur: "eq", valeur: UUID },
    ]);
    // Sans membre connecté connu : rien.
    expect(conditionsDesFiltres({ responsable: "moi" }, null)).toEqual([
      { colonne: "id", operateur: "in", valeurs: [] },
    ]);
    expect(conditionsDesFiltres({ responsable: UUID }, null)).toEqual([
      { colonne: "responsable_id", operateur: "eq", valeur: UUID },
    ]);
  });
});
