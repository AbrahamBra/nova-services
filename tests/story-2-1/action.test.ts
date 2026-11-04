import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Story 2.1 — action serveur `prendreEnCharge`, avec un client Supabase
// simulé (la base réelle est testée dans prendre-en-charge.test.ts) :
// session (jamais la clé secrète), résultat typé, message « Déjà prise en
// charge par [nom]. », rafraîchissement du détail sauf erreur inattendue.
// Et le composant des toasts : zones annoncées aux lecteurs d'écran.

const simulation = vi.hoisted(() => ({
  rpc: null as null | ((fonction: string, parametres?: Record<string, unknown>) => unknown),
  rafraichissements: 0,
  clientService: 0,
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => {
    if (!simulation.rpc) throw new Error("variables d'environnement manquantes");
    return { rpc: simulation.rpc };
  },
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => {
    simulation.clientService++;
    throw new Error("la clé secrète ne doit pas servir au traitement");
  },
}));

vi.mock("next/cache", () => ({
  refresh: () => {
    simulation.rafraichissements++;
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: () => {
    throw new Error("REDIRECTION");
  },
}));

import { prendreEnCharge } from "@/lib/actions/demandes";
import { FournisseurToasts } from "@/components/nova/toasts";
import { MESSAGE_PRISE_EN_CHARGE } from "@/components/nova/actions-demande";
import { messageErreur } from "@/lib/erreurs";

const DEMANDE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";

afterEach(() => {
  simulation.rpc = null;
  simulation.rafraichissements = 0;
  simulation.clientService = 0;
  vi.restoreAllMocks();
});

describe("action prendreEnCharge", () => {
  it("réussite : appelle prendre_en_charge avec la session, renvoie le responsable, rafraîchit", async () => {
    const appels: { fonction: string; parametres?: Record<string, unknown> }[] = [];
    simulation.rpc = (fonction, parametres) => {
      appels.push({ fonction, parametres });
      return Promise.resolve({
        data: { id: DEMANDE, statut: "en_cours", responsable_id: KARIM },
        error: null,
      });
    };

    expect(await prendreEnCharge(DEMANDE)).toEqual({ ok: true, donnees: { responsableId: KARIM } });
    expect(appels).toEqual([{ fonction: "prendre_en_charge", parametres: { p_demande_id: DEMANDE } }]);
    expect(simulation.rafraichissements).toBe(1);
    expect(simulation.clientService).toBe(0);
  });

  it("DEJA_PRISE : « Déjà prise en charge par Karim Benali. », détail rafraîchi", async () => {
    simulation.rpc = () =>
      Promise.resolve({
        data: null,
        error: { code: "P0001", message: "DEJA_PRISE", details: '{"responsable": "Karim Benali"}' },
      });

    const resultat = await prendreEnCharge(DEMANDE);
    expect(resultat).toEqual({
      ok: false,
      code: "DEJA_PRISE",
      message: "Déjà prise en charge par Karim Benali.",
    });
    expect(resultat).not.toHaveProperty("detail");
    expect(simulation.rafraichissements).toBe(1);
  });

  it("DEJA_PRISE sans nom lisible : message de repli", async () => {
    simulation.rpc = () =>
      Promise.resolve({
        data: null,
        error: { code: "P0001", message: "DEJA_PRISE", details: '{"responsable": null}' },
      });
    expect(await prendreEnCharge(DEMANDE)).toEqual({
      ok: false,
      code: "DEJA_PRISE",
      message: messageErreur("DEJA_PRISE"),
    });
  });

  it.each(["PASSAGE_INTERDIT", "DEMANDE_INTROUVABLE"] as const)(
    "%s : message de lib/erreurs.ts, détail rafraîchi",
    async (code) => {
      simulation.rpc = () => Promise.resolve({ data: null, error: { code: "P0001", message: code } });
      expect(await prendreEnCharge(DEMANDE)).toEqual({ ok: false, code, message: messageErreur(code) });
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("DROIT_INSUFFISANT : message de lib/erreurs.ts, détail rafraîchi (la mise en page revérifie le membre)", async () => {
    simulation.rpc = () =>
      Promise.resolve({ data: null, error: { code: "P0001", message: "DROIT_INSUFFISANT" } });
    expect(await prendreEnCharge(DEMANDE)).toEqual({
      ok: false,
      code: "DROIT_INSUFFISANT",
      message: messageErreur("DROIT_INSUFFISANT"),
    });
    expect(simulation.rafraichissements).toBe(1);
  });

  it("base injoignable : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.reject(new Error("fetch failed"));
    expect(await prendreEnCharge(DEMANDE)).toEqual({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: messageErreur("ERREUR_INATTENDUE"),
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("client serveur indisponible : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = null;
    expect(await prendreEnCharge(DEMANDE)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("réponse inattendue de la base : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.resolve({ data: { autre: 1 }, error: null });
    expect(await prendreEnCharge(DEMANDE)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("identifiant mal formé : refusé sans appeler la base", async () => {
    let appels = 0;
    simulation.rpc = () => {
      appels++;
      return Promise.resolve({ data: null, error: null });
    };
    for (const valeur of ["abc", "", null, 42, `${DEMANDE}' or 1=1`]) {
      expect(await prendreEnCharge(valeur), String(valeur)).toMatchObject({
        ok: false,
        code: "DEMANDE_INTROUVABLE",
      });
    }
    expect(appels).toBe(0);
  });
});

describe("toasts", () => {
  it("zones toujours présentes et annoncées : erreurs en alert, réussites en status", () => {
    const html = renderToStaticMarkup(
      createElement(FournisseurToasts, null, createElement("p", null, "contenu")),
    );
    expect(html).toContain("contenu");
    expect(html).toMatch(/role="alert" aria-live="assertive"/);
    expect(html).toMatch(/role="status" aria-live="polite"/);
  });

  it("message de réussite de la prise en charge", () => {
    expect(MESSAGE_PRISE_EN_CHARGE).toBe("Vous êtes responsable de cette demande.");
  });
});
