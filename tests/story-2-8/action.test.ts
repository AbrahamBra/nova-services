import { afterEach, describe, expect, it, vi } from "vitest";

// Story 2.8 — action serveur `lireCompteurDemandes`, relue par le menu à
// chaque changement de page : le nombre « À prendre en charge » (mêmes
// filtres que la carte), lu avec la session ; `null` en cas d'erreur
// (compteur masqué). Client Supabase simulé.

const simulation = vi.hoisted(() => ({
  client: null as null | (() => unknown),
  filtresLus: [] as unknown[],
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => {
    if (!simulation.client) throw new Error("variables d'environnement manquantes");
    return simulation.client();
  },
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => {
    throw new Error("la clé secrète ne doit pas servir au compteur");
  },
}));

vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { lireCompteurDemandes } from "@/lib/actions/demandes";

/** Client dont le comptage renvoie `reponse` et note les conditions appliquées. */
function client(reponse: { count: number | null; error: unknown } | Error) {
  const conditions: unknown[] = [];
  simulation.filtresLus.push(conditions);
  const r = {
    select: () => r,
    eq: (colonne: string, valeur: unknown) => {
      conditions.push(["eq", colonne, valeur]);
      return r;
    },
    in: () => r,
    is: (colonne: string, valeur: unknown) => {
      conditions.push(["is", colonne, valeur]);
      return r;
    },
    then: (resoudre: (v: unknown) => unknown, rejeter: (e: unknown) => unknown) =>
      (reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve({ data: null, ...reponse })).then(
        resoudre,
        rejeter,
      ),
  };
  return { from: () => r, rpc: () => r, auth: { getClaims: async () => ({ data: null, error: null }) } };
}

afterEach(() => {
  simulation.client = null;
  simulation.filtresLus = [];
});

describe("lireCompteurDemandes", () => {
  it("renvoie le nombre de demandes Nouvelle sans responsable", async () => {
    simulation.client = () => client({ count: 7, error: null });
    expect(await lireCompteurDemandes()).toBe(7);
    expect(simulation.filtresLus[0]).toEqual([
      ["eq", "statut", "nouvelle"],
      ["is", "responsable_id", null],
    ]);
  });

  it("0 : renvoyé tel quel (le menu masque le compteur)", async () => {
    simulation.client = () => client({ count: 0, error: null });
    expect(await lireCompteurDemandes()).toBe(0);
  });

  it.each([
    ["erreur de la base", () => client({ count: null, error: { code: "57014" } })],
    ["exception réseau", () => client(new Error("réseau"))],
    [
      "client indisponible",
      () => {
        throw new Error("variables d'environnement manquantes");
      },
    ],
  ])("%s : null", async (_cas, fabrique) => {
    simulation.client = fabrique;
    expect(await lireCompteurDemandes()).toBeNull();
  });
});
