import { afterEach, describe, expect, it, vi } from "vitest";

// Story 2.7 — actions serveur `liberer` et `attribuer`, avec un client
// Supabase simulé (la base réelle est testée dans liberer-attribuer.test.ts) :
// session (jamais la clé secrète), Zod, résultat typé, rafraîchissement du
// détail sauf erreur inattendue. Et le schéma de l'identifiant d'un membre,
// le message du code MEMBRE_INVALIDE et les textes de l'écran.

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
  useRouter: () => ({ refresh: () => {} }),
}));

import { attribuer, liberer } from "@/lib/actions/demandes";
import {
  MESSAGE_LIBERATION,
  TEXTE_FENETRE_ATTRIBUTION,
  messageAttribution,
} from "@/components/nova/actions-demande";
import { messageErreur } from "@/lib/erreurs";
import { schemaIdentifiantMembre } from "@/lib/schemas/traitement";

const DEMANDE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";
const MAL_FORMES = ["abc", "", null, 42, `${DEMANDE}' or 1=1`];

afterEach(() => {
  simulation.rpc = null;
  simulation.rafraichissements = 0;
  simulation.clientService = 0;
  vi.restoreAllMocks();
});

function refusDeLaBase(code: string) {
  simulation.rpc = () => Promise.resolve({ data: null, error: { code: "P0001", message: code } });
}

describe("action liberer", () => {
  it("réussite : appelle liberer avec la session, renvoie Nouvelle, rafraîchit", async () => {
    const appels: { fonction: string; parametres?: Record<string, unknown> }[] = [];
    simulation.rpc = (fonction, parametres) => {
      appels.push({ fonction, parametres });
      return Promise.resolve({
        data: { id: DEMANDE, statut: "nouvelle", responsable_id: null },
        error: null,
      });
    };
    expect(await liberer(DEMANDE)).toEqual({ ok: true, donnees: { statut: "nouvelle" } });
    expect(appels).toEqual([{ fonction: "liberer", parametres: { p_demande_id: DEMANDE } }]);
    expect(simulation.rafraichissements).toBe(1);
    expect(simulation.clientService).toBe(0);
  });

  it.each(["DROIT_INSUFFISANT", "PASSAGE_INTERDIT", "DEMANDE_INTROUVABLE"] as const)(
    "%s : message de lib/erreurs.ts, détail rafraîchi",
    async (code) => {
      refusDeLaBase(code);
      const resultat = await liberer(DEMANDE);
      expect(resultat).toEqual({ ok: false, code, message: messageErreur(code) });
      expect(resultat).not.toHaveProperty("detail");
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("base injoignable : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.reject(new Error("fetch failed"));
    expect(await liberer(DEMANDE)).toEqual({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: messageErreur("ERREUR_INATTENDUE"),
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("client serveur indisponible ou réponse inattendue : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await liberer(DEMANDE)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    simulation.rpc = () =>
      Promise.resolve({ data: { statut: "en_cours", responsable_id: KARIM }, error: null });
    expect(await liberer(DEMANDE)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("identifiant mal formé : refusé sans appeler la base", async () => {
    let appels = 0;
    simulation.rpc = () => {
      appels++;
      return Promise.resolve({ data: null, error: null });
    };
    for (const valeur of MAL_FORMES) {
      expect(await liberer(valeur), String(valeur)).toMatchObject({
        ok: false,
        code: "DEMANDE_INTROUVABLE",
      });
    }
    expect(appels).toBe(0);
  });
});

describe("action attribuer", () => {
  it("réussite : appelle attribuer avec la session, renvoie le responsable, rafraîchit", async () => {
    const appels: { fonction: string; parametres?: Record<string, unknown> }[] = [];
    simulation.rpc = (fonction, parametres) => {
      appels.push({ fonction, parametres });
      return Promise.resolve({
        data: { id: DEMANDE, statut: "en_cours", responsable_id: KARIM },
        error: null,
      });
    };
    expect(await attribuer(DEMANDE, KARIM)).toEqual({ ok: true, donnees: { responsableId: KARIM } });
    expect(appels).toEqual([
      { fonction: "attribuer", parametres: { p_demande_id: DEMANDE, p_membre_id: KARIM } },
    ]);
    expect(simulation.rafraichissements).toBe(1);
    expect(simulation.clientService).toBe(0);
  });

  it.each(["DROIT_INSUFFISANT", "PASSAGE_INTERDIT", "DEMANDE_INTROUVABLE", "MEMBRE_INVALIDE"] as const)(
    "%s : message de lib/erreurs.ts, détail rafraîchi",
    async (code) => {
      refusDeLaBase(code);
      expect(await attribuer(DEMANDE, KARIM)).toEqual({ ok: false, code, message: messageErreur(code) });
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("base injoignable : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.reject(new Error("fetch failed"));
    expect(await attribuer(DEMANDE, KARIM)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("réponse inattendue : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () =>
      Promise.resolve({ data: { statut: "nouvelle", responsable_id: null }, error: null });
    expect(await attribuer(DEMANDE, KARIM)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
  });

  it("demande ou membre mal formé : refusé sans appeler la base", async () => {
    let appels = 0;
    simulation.rpc = () => {
      appels++;
      return Promise.resolve({ data: null, error: null });
    };
    for (const valeur of MAL_FORMES) {
      expect(await attribuer(valeur, KARIM), String(valeur)).toMatchObject({
        ok: false,
        code: "DEMANDE_INTROUVABLE",
      });
      expect(await attribuer(DEMANDE, valeur), String(valeur)).toMatchObject({
        ok: false,
        code: "MEMBRE_INVALIDE",
        message: "Ce membre n'est pas actif.",
      });
    }
    expect(appels).toBe(0);
  });
});

describe("schéma et textes", () => {
  it("identifiant d'un membre : uuid seulement", () => {
    expect(schemaIdentifiantMembre.safeParse(KARIM).success).toBe(true);
    for (const valeur of MAL_FORMES) {
      expect(schemaIdentifiantMembre.safeParse(valeur).success, String(valeur)).toBe(false);
    }
  });

  it("messages de l'écran", () => {
    expect(messageErreur("MEMBRE_INVALIDE")).toBe("Ce membre n'est pas actif.");
    expect(MESSAGE_LIBERATION).toBe("Demande libérée. Elle revient en Nouvelle.");
    expect(messageAttribution("Karim Benali")).toBe("Demande attribuée à Karim Benali.");
    expect(TEXTE_FENETRE_ATTRIBUTION).not.toContain("!");
  });
});
