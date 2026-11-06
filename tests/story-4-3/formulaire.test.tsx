import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Story 4.3 — formulaire « Choisir un mot de passe » (sans navigateur, comme
// tests/story-4-2/liste.test.tsx) : le champ caché `parcours` part avec le
// formulaire ; quand le lien n'est plus valable, « Demander un nouveau lien »
// remplace le bouton en réinitialisation, et l'invitation garde le bouton
// désactivé, sans lien.

const sim = vi.hoisted(() => ({ choisir: vi.fn() }));

vi.mock("@/lib/actions/comptes", () => ({ choisirMotDePasse: sim.choisir }));

import {
  FormulaireMotDePasse,
  PiedFormulaireMotDePasse,
  envoyerAuServeur,
} from "@/components/formulaire-mot-de-passe";
import { ETAT_MOT_DE_PASSE_INITIAL } from "@/lib/schemas/mot-de-passe";

afterEach(() => {
  vi.clearAllMocks();
});

/** FormData du formulaire rendu : champs cachés lus dans le HTML, mots de passe saisis. */
function donneesDuFormulaire(html: string): FormData {
  const donnees = new FormData();
  for (const [balise] of html.matchAll(/<input[^>]*>/g)) {
    const nom = /name="([^"]+)"/.exec(balise)?.[1];
    if (!nom) continue;
    const valeur = /type="hidden"/.test(balise) ? (/value="([^"]*)"/.exec(balise)?.[1] ?? "") : "mot-de-passe-1";
    donnees.set(nom, valeur);
  }
  return donnees;
}

describe("FormulaireMotDePasse", () => {
  it.each(["reinitialisation", "invitation"] as const)(
    "parcours %s : le champ caché part avec le formulaire jusqu'à l'action",
    async (parcours) => {
      const html = renderToStaticMarkup(<FormulaireMotDePasse parcours={parcours} />);
      expect(html).toContain(`<input type="hidden" name="parcours" value="${parcours}"/>`);

      sim.choisir.mockResolvedValue(ETAT_MOT_DE_PASSE_INITIAL);
      await envoyerAuServeur(ETAT_MOT_DE_PASSE_INITIAL, donneesDuFormulaire(html));
      const [, envoyees] = sim.choisir.mock.calls[0] as [unknown, FormData];
      expect(envoyees.get("parcours")).toBe(parcours);
      expect(envoyees.get("mot_de_passe")).toBe("mot-de-passe-1");
      expect(envoyees.get("confirmation")).toBe("mot-de-passe-1");
    },
  );

  it("au départ : « Enregistrer mon mot de passe », pas de lien", () => {
    const html = renderToStaticMarkup(<FormulaireMotDePasse parcours="reinitialisation" />);
    expect(html).toContain("Enregistrer mon mot de passe");
    expect(html).not.toContain("Demander un nouveau lien");
  });
});

describe("PiedFormulaireMotDePasse — lien plus valable", () => {
  it("réinitialisation : « Demander un nouveau lien » remplace le bouton", () => {
    const html = renderToStaticMarkup(
      <PiedFormulaireMotDePasse parcours="reinitialisation" lienPlusValable enCours={false} />,
    );
    expect(html).toMatch(/<a[^>]*href="\/mot-de-passe-oublie"[^>]*>Demander un nouveau lien<\/a>/);
    expect(html).not.toContain("<button");
  });

  it("invitation : bouton désactivé, aucun lien", () => {
    const html = renderToStaticMarkup(
      <PiedFormulaireMotDePasse parcours="invitation" lienPlusValable enCours={false} />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Enregistrer mon mot de passe<\/button>/);
    expect(html).not.toContain("Demander un nouveau lien");
  });

  it("lien valable : bouton actif dans les deux parcours", () => {
    for (const parcours of ["invitation", "reinitialisation"] as const) {
      const html = renderToStaticMarkup(
        <PiedFormulaireMotDePasse parcours={parcours} lienPlusValable={false} enCours={false} />,
      );
      expect(html).not.toContain(`disabled=""`);
      expect(html).not.toContain("Demander un nouveau lien");
    }
  });
});
