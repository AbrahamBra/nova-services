import { afterEach, describe, expect, it, vi } from "vitest";

// Story 1.3 — action serveur `deposer`, avec un client Supabase simulé :
// traduction des réponses de `deposer_demande` en erreurs sous les champs, en
// bandeau, ou en redirection vers la confirmation. La base réelle est testée
// dans deposer.test.ts.

const simulation = vi.hoisted(() => ({
  rpc: null as null | ((fonction: string, parametres?: Record<string, unknown>) => unknown),
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => {
    if (!simulation.rpc) throw new Error("variables d'environnement manquantes");
    return { rpc: simulation.rpc };
  },
}));

vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (adresse: string, type?: string) => {
    throw Object.assign(new Error("REDIRECTION"), { adresse, type });
  },
}));

import { deposer } from "@/lib/actions/demandes";
import { messageErreur } from "@/lib/erreurs";
import { ETAT_DEPOT_INITIAL, MESSAGES_DEPOT } from "@/lib/schemas/depot";

const CATEGORIE = "6f1c2b0e-3d4a-4b5c-8d9e-0a1b2c3d4e5f";
const JETON = "a".repeat(64);

function formulaire(modifs: Record<string, string | null> = {}): FormData {
  const valeurs: Record<string, string | null> = {
    cle_envoi: "0b8f5c3e-1a2b-4c3d-9e4f-5a6b7c8d9e0f",
    nom: "TEST-Sophie Garnier",
    email: " Sophie@Example.COM ",
    telephone: "",
    societe: "",
    categorie_id: CATEGORIE,
    objet: "Impression impossible",
    description: "Plus rien ne sort.",
    consentement: "oui",
    ...modifs,
  };
  const donnees = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    if (valeur !== null) donnees.set(cle, valeur);
  }
  return donnees;
}

afterEach(() => {
  simulation.rpc = null;
  vi.restoreAllMocks();
});

describe("action deposer", () => {
  it("saisie correcte → appelle deposer_demande puis redirige vers la confirmation", async () => {
    const appels: { fonction: string; parametres?: Record<string, unknown> }[] = [];
    simulation.rpc = (fonction, parametres) => {
      appels.push({ fonction, parametres });
      return Promise.resolve({ data: { reference: "NOVA-2026-0042", jeton: JETON }, error: null });
    };

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject({
      message: "REDIRECTION",
      adresse: `/confirmation/${JETON}`,
      type: "replace",
    });
    expect(appels).toHaveLength(1);
    expect(appels[0].fonction).toBe("deposer_demande");
    expect(appels[0].parametres).toMatchObject({
      p_email: "sophie@example.com",
      p_telephone: null,
      p_societe: null,
      p_categorie_id: CATEGORIE,
      p_consentement: true,
    });
  });

  it("saisie invalide → erreurs sous les champs, sans appel à la base", async () => {
    const rpc = vi.fn();
    simulation.rpc = rpc;
    const etat = await deposer(
      ETAT_DEPOT_INITIAL,
      formulaire({ description: "", email: "abc", consentement: null }),
    );
    expect(etat).toEqual({
      erreurs: {
        email: MESSAGES_DEPOT.emailInvalide,
        description: MESSAGES_DEPOT.descriptionVide,
        consentement: MESSAGES_DEPOT.consentement,
      },
      erreurGenerale: null,
      tentative: 1,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("CATEGORIE_INVALIDE → message sous Catégorie", async () => {
    simulation.rpc = () =>
      Promise.resolve({ data: null, error: { code: "P0001", message: "CATEGORIE_INVALIDE" } });
    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire());
    expect(etat.erreurs).toEqual({ categorie_id: messageErreur("CATEGORIE_INVALIDE") });
    expect(etat.erreurGenerale).toBeNull();
  });

  it("CONSENTEMENT_REQUIS → message sous la case", async () => {
    simulation.rpc = () =>
      Promise.resolve({ data: null, error: { code: "P0001", message: "CONSENTEMENT_REQUIS" } });
    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire());
    expect(etat.erreurs).toEqual({ consentement: messageErreur("CONSENTEMENT_REQUIS") });
  });

  it("erreur SQL imprévue → bandeau « Le serveur ne répond pas… »", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () =>
      Promise.resolve({ data: null, error: { code: "08006", message: "connexion perdue" } });
    const etat = await deposer({ ...ETAT_DEPOT_INITIAL, tentative: 3 }, formulaire());
    expect(etat).toEqual({
      erreurs: {},
      erreurGenerale: messageErreur("ERREUR_INATTENDUE"),
      tentative: 4,
    });
  });

  it("client service indisponible → bandeau", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire());
    expect(etat.erreurGenerale).toBe(messageErreur("ERREUR_INATTENDUE"));
  });

  it("réponse mal formée → bandeau, pas de redirection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () =>
      Promise.resolve({ data: { reference: "NOVA-2026-0042", jeton: "../x" }, error: null });
    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire());
    expect(etat.erreurGenerale).toBe(messageErreur("ERREUR_INATTENDUE"));
  });

  it("clé d'envoi falsifiée → bandeau « Certaines informations… »", async () => {
    const etat = await deposer(ETAT_DEPOT_INITIAL, formulaire({ cle_envoi: "pas-une-cle" }));
    expect(etat.erreurGenerale).toBe(messageErreur("DONNEES_INVALIDES"));
  });

  it("clé falsifiée et champs en erreur → bandeau tout de suite, sans erreurs de champ", async () => {
    const etat = await deposer(
      ETAT_DEPOT_INITIAL,
      formulaire({ cle_envoi: "pas-une-cle", email: "abc", description: "" }),
    );
    expect(etat).toEqual({
      erreurs: {},
      erreurGenerale: messageErreur("DONNEES_INVALIDES"),
      tentative: 1,
    });
  });
});
