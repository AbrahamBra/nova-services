import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 5.4 — actions `chercherDemandesDemandeur` et `effacerDemandeur`
// (lib/actions/donnees.ts), sans base : profil et client de session
// simulés. Refus du collaborateur (rien n'est appelé), Zod (email mal écrit
// sous le champ, identifiants invalides), email normalisé envoyé à la base,
// réponse validée, codes de la base (DROIT_INSUFFISANT → ACCES_REFUSE,
// DEMANDES_CHANGEES), rafraîchissement de la liste des demandes et de
// l'accueil, et jamais l'email dans la console ni dans Sentry.

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

import { chercherDemandesDemandeur, effacerDemandeur } from "@/lib/actions/donnees";
import { messageErreur } from "@/lib/erreurs";
import { MESSAGES_DONNEES } from "@/lib/schemas/donnees";

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

const EMAIL = "jean.dupont@example.com";
const IDS = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const LIGNES = [
  {
    id: IDS[0],
    reference: "NOVA-2026-0003",
    cree_le: "2026-11-05T09:12:00+00:00",
    objet: "Devis cuisine",
    statut: "nouvelle",
  },
  {
    id: IDS[1],
    reference: "NOVA-2026-0001",
    cree_le: "2026-10-01T09:12:00+00:00",
    objet: "Ancienne demande",
    statut: "traitee",
  },
];

function erreurPrevue(code: string) {
  return { data: null, error: { code: "P0001", message: code, details: null } };
}

let console_error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sim.profil = ADMIN;
  console_error = vi.spyOn(console, "error").mockImplementation(() => {});
  sim.rpc.mockImplementation(async (fonction: string, p: Record<string, unknown>) => {
    if (fonction === "chercher_demandes_demandeur") return { data: LIGNES, error: null };
    if (fonction === "effacer_demandeur") {
      return { data: { nombre: (p.p_ids as string[]).length }, error: null };
    }
    return { data: null, error: { code: "42883", message: "inconnue" } };
  });
});

afterEach(() => {
  // Jamais l'email recherché dans la console ni dans Sentry (AD-14).
  const traces = JSON.stringify([console_error.mock.calls, sim.captureMessage.mock.calls]);
  expect(traces).not.toContain("dupont");
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
    const refus = { ok: false, code: "ACCES_REFUSE", message: messageErreur("ACCES_REFUSE") };
    expect(await chercherDemandesDemandeur(EMAIL)).toEqual(refus);
    expect(await effacerDemandeur(EMAIL, IDS)).toEqual(refus);
    expect(sim.rpc).not.toHaveBeenCalled();
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("profil illisible : ERREUR_INATTENDUE", async () => {
    sim.profil = { ok: false, code: "ERREUR_INATTENDUE", message: "x" };
    expect(await chercherDemandesDemandeur(EMAIL)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(await effacerDemandeur(EMAIL, IDS)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.rpc).not.toHaveBeenCalled();
  });
});

describe("chercherDemandesDemandeur", () => {
  it("email normalisé envoyé à la base ; demandes lues, dans l'ordre de la base", async () => {
    const resultat = await chercherDemandesDemandeur("  Jean.Dupont@Example.com ");
    expect(sim.rpc).toHaveBeenCalledWith("chercher_demandes_demandeur", { p_email: EMAIL });
    expect(resultat).toEqual({
      ok: true,
      donnees: {
        email: EMAIL,
        demandes: [
          {
            id: IDS[0],
            reference: "NOVA-2026-0003",
            creeLe: "2026-11-05T09:12:00+00:00",
            objet: "Devis cuisine",
            statut: "nouvelle",
          },
          {
            id: IDS[1],
            reference: "NOVA-2026-0001",
            creeLe: "2026-10-01T09:12:00+00:00",
            objet: "Ancienne demande",
            statut: "traitee",
          },
        ],
      },
    });
    // Une recherche ne change rien : rien n'est rafraîchi.
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("aucune demande : liste vide", async () => {
    sim.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await chercherDemandesDemandeur(EMAIL)).toEqual({
      ok: true,
      donnees: { email: EMAIL, demandes: [] },
    });
  });

  it.each([
    ["mal écrit", "jean@dupont", MESSAGES_DONNEES.emailInvalide],
    ["vide", "   ", MESSAGES_DONNEES.emailVide],
    ["absent", undefined, MESSAGES_DONNEES.emailVide],
  ])("email %s : erreur sous le champ, rien n'est appelé", async (_cas, email, message) => {
    expect(await chercherDemandesDemandeur(email)).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message: messageErreur("DONNEES_INVALIDES"),
      erreurEmail: message,
    });
    expect(sim.rpc).not.toHaveBeenCalled();
  });

  it("DROIT_INSUFFISANT (plus administrateur) : ACCES_REFUSE", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DROIT_INSUFFISANT"));
    expect(await chercherDemandesDemandeur(EMAIL)).toEqual({
      ok: false,
      code: "ACCES_REFUSE",
      message: messageErreur("ACCES_REFUSE"),
    });
  });

  it("DONNEES_INVALIDES de la base : sous le champ", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DONNEES_INVALIDES"));
    expect(await chercherDemandesDemandeur(EMAIL)).toMatchObject({
      ok: false,
      code: "DONNEES_INVALIDES",
      erreurEmail: MESSAGES_DONNEES.emailInvalide,
    });
  });

  it.each([
    ["pas une liste", { lignes: [] }],
    ["statut inconnu", [{ ...LIGNES[0], statut: "archivee" }]],
    ["date illisible", [{ ...LIGNES[0], cree_le: "hier" }]],
    ["id absent", [{ ...LIGNES[0], id: null }]],
    ["id qui n'est pas un UUID", [{ ...LIGNES[0], id: "NOVA-2026-0003" }]],
  ])("réponse inattendue (%s) : ERREUR_INATTENDUE, signalée sans l'email", async (_cas, data) => {
    sim.rpc.mockResolvedValueOnce({ data, error: null });
    expect(await chercherDemandesDemandeur(EMAIL)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.captureMessage).toHaveBeenCalled();
  });
});

describe("effacerDemandeur", () => {
  it("email normalisé et identifiants envoyés ; liste des demandes et accueil rafraîchis", async () => {
    expect(await effacerDemandeur(" Jean.Dupont@example.com", IDS)).toEqual({
      ok: true,
      donnees: { nombre: 2 },
    });
    expect(sim.rpc).toHaveBeenCalledWith("effacer_demandeur", { p_email: EMAIL, p_ids: IDS });
    // Tout l'espace équipe : liste, détail, recherche, accueil, journal.
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe", "layout");
  });

  it("plus de 1 000 demandes : aucun plafond, tout ce que la recherche montre s'efface", async () => {
    const beaucoup = Array.from(
      { length: 1500 },
      (_, i) => `${i.toString(16).padStart(8, "0")}-2222-4222-8222-222222222222`,
    );
    expect(await effacerDemandeur(EMAIL, beaucoup)).toEqual({ ok: true, donnees: { nombre: 1500 } });
    expect(sim.rpc).toHaveBeenCalledWith("effacer_demandeur", { p_email: EMAIL, p_ids: beaucoup });
  });

  it.each([
    ["email mal écrit", "jean@dupont", IDS],
    ["aucun identifiant", EMAIL, []],
    ["identifiant invalide", EMAIL, ["pas-un-uuid"]],
    ["identifiants absents", EMAIL, undefined],
  ])("%s : DONNEES_INVALIDES, rien n'est appelé", async (_cas, email, ids) => {
    expect(await effacerDemandeur(email, ids)).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message: messageErreur("DONNEES_INVALIDES"),
    });
    expect(sim.rpc).not.toHaveBeenCalled();
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("DEMANDES_CHANGEES : message de la liste changée, rien n'est rafraîchi", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DEMANDES_CHANGEES"));
    expect(await effacerDemandeur(EMAIL, IDS)).toEqual({
      ok: false,
      code: "DEMANDES_CHANGEES",
      message: "La liste a changé depuis votre recherche. Vérifiez-la avant d'effacer.",
    });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("DROIT_INSUFFISANT (plus administrateur) : ACCES_REFUSE", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DROIT_INSUFFISANT"));
    expect(await effacerDemandeur(EMAIL, IDS)).toMatchObject({ ok: false, code: "ACCES_REFUSE" });
  });

  it("réponse inattendue : ERREUR_INATTENDUE, signalée sans l'email, listes rafraîchies", async () => {
    sim.rpc.mockResolvedValueOnce({ data: { effacees: 2 }, error: null });
    expect(await effacerDemandeur(EMAIL, IDS)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.captureMessage).toHaveBeenCalled();
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe", "layout");
  });

  it("erreur imprévue de la base : ERREUR_INATTENDUE, signalée sans l'email", async () => {
    sim.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: `boom ${EMAIL}` } });
    expect(await effacerDemandeur(EMAIL, IDS)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.captureMessage).toHaveBeenCalled();
  });
});
