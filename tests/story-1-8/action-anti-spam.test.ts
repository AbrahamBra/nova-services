import { afterEach, describe, expect, it, vi } from "vitest";

// Story 1.8 — action `deposer` : champ piège, empreinte d'IP transmise à la
// base, traduction de TROP_D_ENVOIS, refus sans secret en production. Client
// Supabase et en-têtes simulés ; la limite elle-même est testée sur la vraie
// base dans limite.test.ts.

const simulation = vi.hoisted(() => ({
  rpc: null as null | ((fonction: string, parametres?: Record<string, unknown>) => unknown),
  entetes: {} as Record<string, string>,
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => {
    if (!simulation.rpc) throw new Error("variables d'environnement manquantes");
    return { rpc: simulation.rpc };
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(simulation.entetes) }));

vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (adresse: string, type?: string) => {
    throw Object.assign(new Error("REDIRECTION"), { adresse, type });
  },
}));

import { deposer } from "@/lib/actions/demandes";
import { messageErreur } from "@/lib/erreurs";
import { calculerEmpreinte } from "@/lib/server/empreintes";
import { CHAMP_PIEGE, ETAT_DEPOT_INITIAL } from "@/lib/schemas/depot";

const JETON = "b".repeat(64);
const IP = "203.0.113.42";

function formulaire(modifs: Record<string, string> = {}): FormData {
  const donnees = new FormData();
  for (const [cle, valeur] of Object.entries({
    cle_envoi: "0b8f5c3e-1a2b-4c3d-9e4f-5a6b7c8d9e0f",
    nom: "TEST-Sophie Garnier",
    email: "sophie@example.com",
    telephone: "",
    societe: "",
    categorie_id: "6f1c2b0e-3d4a-4b5c-8d9e-0a1b2c3d4e5f",
    objet: "Impression impossible",
    description: "Plus rien ne sort.",
    consentement: "oui",
    [CHAMP_PIEGE]: "",
    ...modifs,
  })) {
    donnees.set(cle, valeur);
  }
  return donnees;
}

type Appel = { fonction: string; parametres?: Record<string, unknown> };

function baseQuiAccepte(): Appel[] {
  const appels: Appel[] = [];
  simulation.rpc = (fonction, parametres) => {
    appels.push({ fonction, parametres });
    return Promise.resolve({
      data: {
        reference: "NOVA-2026-0042",
        jeton: JETON,
        id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        objet: "Impression impossible",
        cree_le: "2026-11-03T08:12:00+00:00",
        nom_affiche: "Nova Services",
        email_contact: "contact@nova-services.example",
        nouvelle: false,
        etat_email: "envoye",
      },
      error: null,
    });
  };
  return appels;
}

afterEach(() => {
  simulation.rpc = null;
  simulation.entetes = {};
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("action deposer — champ piège", () => {
  it("champ piège rempli → rien n'est appelé, message neutre", async () => {
    const rpc = vi.fn();
    simulation.rpc = rpc;
    const trace = vi.spyOn(console, "warn").mockImplementation(() => {});
    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire({ [CHAMP_PIEGE]: "https://spam.example" }));
    expect(trace).toHaveBeenCalledWith("[deposer] champ piège rempli");
    expect(etat).toEqual({
      erreurs: {},
      erreurGenerale: "Votre demande n'a pas pu être envoyée. Réessayez plus tard.",
      tentative: 1,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("vérifié avant Zod : saisie invalide + piège rempli → même message neutre, sans erreur de champ", async () => {
    const rpc = vi.fn();
    simulation.rpc = rpc;
    const etat = await deposer(
      ETAT_DEPOT_INITIAL,
      formulaire({ [CHAMP_PIEGE]: " ", email: "abc", description: "" }),
    );
    expect(etat.erreurs).toEqual({});
    expect(etat.erreurGenerale).toBe(messageErreur("ENVOI_IMPOSSIBLE"));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("champ piège vide ou absent → dépôt normal", async () => {
    const appels = baseQuiAccepte();
    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject({
      message: "REDIRECTION",
    });
    const sansPiege = formulaire();
    sansPiege.delete(CHAMP_PIEGE);
    await expect(deposer(ETAT_DEPOT_INITIAL, sansPiege)).rejects.toMatchObject({
      message: "REDIRECTION",
    });
    expect(appels).toHaveLength(2);
  });
});

describe("action deposer — empreinte d'IP et limite", () => {
  it("transmet l'empreinte HMAC de l'IP, jamais l'IP elle-même", async () => {
    vi.stubEnv("HMAC_SECRET", "secret-de-test");
    simulation.entetes = { "x-forwarded-for": `${IP}, 10.0.0.1` };
    const appels = baseQuiAccepte();
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject({
      message: "REDIRECTION",
    });

    expect(appels[0].fonction).toBe("deposer_demande");
    expect(appels[0].parametres?.p_empreinte_ip).toBe(
      calculerEmpreinte("ip", IP, "secret-de-test"),
    );
    expect(JSON.stringify(appels)).not.toContain(IP);
    for (const ligne of journal.mock.calls) expect(String(ligne[0])).not.toContain(IP);
  });

  it("TROP_D_ENVOIS → bandeau « Trop d'envois… », pas de confirmation", async () => {
    vi.stubEnv("HMAC_SECRET", "secret-de-test");
    simulation.rpc = () =>
      Promise.resolve({ data: null, error: { code: "P0001", message: "TROP_D_ENVOIS" } });
    const trace = vi.spyOn(console, "warn").mockImplementation(() => {});
    const etat = await deposer({ ...ETAT_DEPOT_INITIAL, tentative: 2 }, formulaire());
    expect(trace).toHaveBeenCalledWith("[deposer] limite d'envois atteinte");
    expect(etat).toEqual({
      erreurs: {},
      erreurGenerale: "Trop d'envois depuis votre connexion. Réessayez dans quelques minutes.",
      tentative: 3,
    });
  });

  it("production sans HMAC_SECRET → refus, aucun appel à la base, erreur tracée", async () => {
    vi.stubEnv("SUPABASE_ENVIRONNEMENT", "production");
    vi.stubEnv("HMAC_SECRET", "");
    simulation.entetes = { "x-nf-client-connection-ip": IP };
    const rpc = vi.fn();
    simulation.rpc = rpc;
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});

    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire());
    expect(etat.erreurGenerale).toBe(messageErreur("ERREUR_INATTENDUE"));
    expect(rpc).not.toHaveBeenCalled();
    expect(journal).toHaveBeenCalled();
    for (const ligne of journal.mock.calls) expect(String(ligne[0])).not.toContain(IP);
  });

  it("Netlify sans en-tête d'IP → refus, aucun appel à la base", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("HMAC_SECRET", "secret-de-test");
    simulation.entetes = { "x-forwarded-for": IP };
    const rpc = vi.fn();
    simulation.rpc = rpc;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire());
    expect(etat.erreurGenerale).toBe(messageErreur("ERREUR_INATTENDUE"));
    expect(rpc).not.toHaveBeenCalled();
  });
});
