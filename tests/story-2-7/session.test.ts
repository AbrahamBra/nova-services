import { afterEach, describe, expect, it, vi } from "vitest";

// Story 2.7 — `lireProfil` : identifiant du membre tiré du `sub` des claims
// de la session vérifiée, avec un client Supabase simulé. Un `sub` absent,
// vide ou qui n'est pas un texte donne « pas de profil » (sans lire
// `mon_profil`) ; un `sub` valide est ajouté au profil comme `id`.

const simulation = vi.hoisted(() => ({
  claims: null as null | Record<string, unknown>,
  appelsRpc: 0,
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => ({
    auth: {
      getClaims: async () => ({
        data: simulation.claims ? { claims: simulation.claims } : null,
        error: null,
      }),
    },
    rpc: (fonction: string) => {
      simulation.appelsRpc++;
      expect(fonction).toBe("mon_profil");
      return Promise.resolve({
        data: { nom: "Karim Benali", role: "administrateur", etat: "actif" },
        error: null,
      });
    },
  }),
}));

import { lireProfil } from "@/lib/session";

const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";

afterEach(() => {
  simulation.claims = null;
  simulation.appelsRpc = 0;
});

describe("lireProfil : identifiant du membre", () => {
  it.each([
    ["absent", {}],
    ["vide", { sub: "" }],
    ["nombre", { sub: 42 }],
    ["null", { sub: null }],
    ["objet", { sub: { id: KARIM } }],
  ])("sub %s : pas de profil, mon_profil n'est pas lu", async (_cas, claims) => {
    simulation.claims = claims;
    expect(await lireProfil()).toEqual({ ok: true, donnees: null });
    expect(simulation.appelsRpc).toBe(0);
  });

  it("sub valide : ajouté au profil comme id", async () => {
    simulation.claims = { sub: KARIM };
    expect(await lireProfil()).toEqual({
      ok: true,
      donnees: {
        id: KARIM,
        nom: "Karim Benali",
        role: "administrateur",
        prenom: "Karim",
        estAdmin: true,
      },
    });
    expect(simulation.appelsRpc).toBe(1);
  });
});
