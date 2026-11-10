import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 5.5 — action `purgerExpirees` (lib/actions/donnees.ts) et lecture du
// nombre de demandes expirées (lib/expirees.ts), sans base : profil et
// client de session simulés. Refus du collaborateur (rien n'est appelé),
// Zod (nombre affiché), nombre envoyé à la base, codes de la base
// (DROIT_INSUFFISANT → ACCES_REFUSE, EXPIREES_CHANGEES avec le nouveau
// nombre relu), rafraîchissement de l'espace équipe après la suppression
// seulement.

const sim = vi.hoisted(() => ({
  profil: null as unknown,
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: sim.captureMessage }));
vi.mock("next/cache", () => ({ revalidatePath: sim.revalidatePath, refresh: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], delete: () => {} }),
}));
vi.mock("@/lib/session", async (importer) => ({
  ...(await importer<typeof import("@/lib/session")>()),
  lireProfil: async () => sim.profil,
}));
vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => ({ rpc: sim.rpc }),
}));

import { purgerExpirees } from "@/lib/actions/donnees";
import { messageErreur } from "@/lib/erreurs";
import { lireExpirees } from "@/lib/expirees";

const ADMIN = {
  ok: true,
  donnees: {
    id: "11111111-1111-4111-8111-111111111111",
    nom: "TEST Claire Roux",
    prenom: "TEST",
    role: "administrateur",
    estAdmin: true,
  },
};
const COLLABORATEUR = { ok: true, donnees: { ...ADMIN.donnees, role: "collaborateur", estAdmin: false } };

function erreurPrevue(code: string) {
  return { data: null, error: { code: "P0001", message: code, details: null } };
}

let console_error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sim.profil = ADMIN;
  console_error = vi.spyOn(console, "error").mockImplementation(() => {});
  sim.rpc.mockImplementation(async (fonction: string, p: Record<string, unknown>) => {
    if (fonction === "purger_expirees") return { data: { nombre: p.p_nombre_attendu }, error: null };
    if (fonction === "compter_expirees") return { data: { nombre: 12, duree_mois: 24 }, error: null };
    return { data: null, error: { code: "42883", message: "inconnue" } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  sim.rpc.mockReset();
  console_error.mockRestore();
});

describe("collaborateur ou visiteur : refus, rien n'est appelé", () => {
  it.each([
    ["collaborateur", () => COLLABORATEUR],
    ["visiteur", () => ({ ok: true, donnees: null })],
  ])("%s", async (_nom, profil) => {
    sim.profil = profil();
    expect(await purgerExpirees(12)).toEqual({
      ok: false,
      code: "ACCES_REFUSE",
      message: messageErreur("ACCES_REFUSE"),
    });
    expect(sim.rpc).not.toHaveBeenCalled();
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("profil illisible : ERREUR_INATTENDUE", async () => {
    sim.profil = { ok: false, code: "ERREUR_INATTENDUE", message: "x" };
    expect(await purgerExpirees(12)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.rpc).not.toHaveBeenCalled();
  });
});

describe("purgerExpirees", () => {
  it("nombre affiché envoyé à la base ; espace équipe rafraîchi", async () => {
    expect(await purgerExpirees(12)).toEqual({ ok: true, donnees: { nombre: 12 } });
    expect(sim.rpc).toHaveBeenCalledWith("purger_expirees", { p_nombre_attendu: 12 });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe", "layout");
  });

  it.each([
    ["zéro", 0],
    ["négatif", -3],
    ["décimal", 1.5],
    ["texte", "12"],
    ["absent", undefined],
    ["au-delà d'un entier SQL", 2147483648],
  ])("nombre %s : DONNEES_INVALIDES, rien n'est appelé", async (_cas, nombre) => {
    expect(await purgerExpirees(nombre)).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message: messageErreur("DONNEES_INVALIDES"),
    });
    expect(sim.rpc).not.toHaveBeenCalled();
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("EXPIREES_CHANGEES : message prévu et nouveau nombre relu, rien n'est rafraîchi", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("EXPIREES_CHANGEES"));
    expect(await purgerExpirees(11)).toEqual({
      ok: false,
      code: "EXPIREES_CHANGEES",
      message: "Le nombre de demandes expirées a changé. Vérifiez-le avant de supprimer.",
      expirees: { nombre: 12, dureeMois: 24 },
    });
    expect(sim.rpc).toHaveBeenLastCalledWith("compter_expirees", undefined);
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("EXPIREES_CHANGEES, nouveau nombre illisible : le refus seul", async () => {
    sim.rpc
      .mockResolvedValueOnce(erreurPrevue("EXPIREES_CHANGEES"))
      .mockResolvedValueOnce({ data: { total: 3 }, error: null });
    expect(await purgerExpirees(11)).toEqual({
      ok: false,
      code: "EXPIREES_CHANGEES",
      message: messageErreur("EXPIREES_CHANGEES"),
    });
  });

  it("DROIT_INSUFFISANT (plus administrateur) : ACCES_REFUSE", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DROIT_INSUFFISANT"));
    expect(await purgerExpirees(12)).toMatchObject({ ok: false, code: "ACCES_REFUSE" });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("réponse inattendue : ERREUR_INATTENDUE, signalée, espace équipe rafraîchi", async () => {
    sim.rpc.mockResolvedValueOnce({ data: { supprimees: 12 }, error: null });
    expect(await purgerExpirees(12)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.captureMessage).toHaveBeenCalled();
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe", "layout");
  });

  it("erreur imprévue de la base : ERREUR_INATTENDUE", async () => {
    sim.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await purgerExpirees(12)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("lireExpirees (chargement de la page)", () => {
  it("client serveur indisponible : ERREUR_INATTENDUE, signalée", async () => {
    const serveur = await import("@/lib/supabase/serveur");
    vi.spyOn(serveur, "creerClientServeur").mockRejectedValueOnce(new Error("cookies"));
    expect(await lireExpirees()).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.captureMessage).toHaveBeenCalledWith("[expirees] client serveur indisponible", "error");
  });

  it("nombre et durée lus avec la session", async () => {
    expect(await lireExpirees()).toEqual({ ok: true, donnees: { nombre: 12, dureeMois: 24 } });
    expect(sim.rpc).toHaveBeenCalledWith("compter_expirees", undefined);
  });

  it("DROIT_INSUFFISANT : refus transmis", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DROIT_INSUFFISANT"));
    expect(await lireExpirees()).toMatchObject({ ok: false, code: "DROIT_INSUFFISANT" });
  });

  it.each([
    ["nombre négatif", { nombre: -1, duree_mois: 24 }],
    ["durée absente", { nombre: 3 }],
    ["liste", [3, 24]],
  ])("réponse inattendue (%s) : ERREUR_INATTENDUE, signalée", async (_cas, data) => {
    sim.rpc.mockResolvedValueOnce({ data, error: null });
    expect(await lireExpirees()).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.captureMessage).toHaveBeenCalled();
  });
});
