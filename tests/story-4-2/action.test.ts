import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 4.2 — actions `modifierMembre`, `desactiverMembre`, `reactiverMembre`
// et cas `COMPTE_DESACTIVE` de `inviter` (lib/actions/admin.ts), sans base :
// profil, client de session et client service simulés. Ordre SQL / Auth
// (désactiver : base puis blocage ; réactiver : déblocage puis base), échecs
// d'Auth, refus du collaborateur (rien n'est appelé), codes de la base.

const sim = vi.hoisted(() => ({
  profil: null as unknown,
  ordre: [] as string[],
  rpcSession: vi.fn(),
  rpcService: vi.fn(),
  updateUserById: vi.fn(),
  generateLink: vi.fn(),
  captureMessage: vi.fn(),
  revalidatePath: vi.fn(),
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

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => ({
    auth: {
      admin: {
        updateUserById: async (...args: unknown[]) => {
          sim.ordre.push("auth");
          return sim.updateUserById(...args);
        },
        generateLink: sim.generateLink,
        deleteUser: vi.fn(),
      },
    },
    rpc: sim.rpcService,
  }),
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => ({
    rpc: async (fonction: string, parametres: unknown) => {
      sim.ordre.push(`sql:${fonction}`);
      return sim.rpcSession(fonction, parametres);
    },
  }),
}));

import { desactiverMembre, inviter, modifierMembre, reactiverMembre } from "@/lib/actions/admin";
import { messageErreur } from "@/lib/erreurs";
import { ETAT_INVITATION_INITIAL } from "@/lib/schemas/invitation";

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
const LEO = "22222222-2222-4222-8222-222222222222";

function erreurPrevue(code: string, details?: string) {
  return { data: null, error: { code: "P0001", message: code, details: details ?? null } };
}

beforeEach(() => {
  sim.profil = ADMIN;
  sim.ordre = [];
  sim.updateUserById.mockResolvedValue({ data: { user: {} }, error: null });
  sim.rpcSession.mockImplementation(async (fonction: string) => {
    if (fonction === "modifier_membre") return { data: { id: LEO, modifie: true }, error: null };
    if (fonction === "desactiver_membre")
      return { data: { id: LEO, etat: "desactive", demandes_remises: 2 }, error: null };
    if (fonction === "reactiver_membre") return { data: { id: LEO, etat: "actif" }, error: null };
    return { data: null, error: { code: "42883", message: "inconnue" } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  sim.rpcSession.mockReset();
  sim.rpcService.mockReset();
  sim.updateUserById.mockReset();
  sim.generateLink.mockReset();
});

describe("collaborateur ou visiteur : refus, rien n'est appelé", () => {
  it.each([
    ["collaborateur", () => COLLABORATEUR],
    ["visiteur", () => ({ ok: true, donnees: null })],
  ])("%s", async (_nom, profil) => {
    sim.profil = profil();
    for (const resultat of [
      await modifierMembre({ id: LEO, nom: "Léo", role: "administrateur" }),
      await desactiverMembre(LEO),
      await reactiverMembre(LEO),
    ]) {
      expect(resultat).toEqual({ ok: false, code: "ACCES_REFUSE", message: messageErreur("ACCES_REFUSE") });
    }
    expect(sim.ordre).toEqual([]);
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("modifierMembre", () => {
  it("appelle modifier_membre avec la session, nom nettoyé, puis rafraîchit la liste", async () => {
    const resultat = await modifierMembre({ id: LEO, nom: "  Léo Martin ", role: "administrateur" });
    expect(resultat).toEqual({ ok: true, donnees: { nom: "Léo Martin", role: "administrateur" } });
    expect(sim.rpcSession).toHaveBeenCalledWith("modifier_membre", {
      p_id: LEO,
      p_nom: "Léo Martin",
      p_role: "administrateur",
    });
    expect(sim.ordre).toEqual(["sql:modifier_membre"]);
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
  });

  it("saisie invalide : erreurs sous les champs, aucun appel", async () => {
    const resultat = await modifierMembre({ id: LEO, nom: " ", role: "chef" });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(Object.keys(resultat.erreurs ?? {}).sort()).toEqual(["nom", "role"]);
    expect(sim.ordre).toEqual([]);
  });

  it.each(["DERNIER_ADMIN", "PROPRE_COMPTE"] as const)("%s : message sous le champ Rôle", async (code) => {
    sim.rpcSession.mockResolvedValue(erreurPrevue(code));
    const resultat = await modifierMembre({ id: LEO, nom: "Léo", role: "collaborateur" });
    expect(resultat).toEqual({
      ok: false,
      code,
      message: messageErreur(code),
      erreurs: { role: messageErreur(code) },
    });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("DROIT_INSUFFISANT de la base (plus administrateur) : ACCES_REFUSE", async () => {
    sim.rpcSession.mockResolvedValue(erreurPrevue("DROIT_INSUFFISANT"));
    const resultat = await modifierMembre({ id: LEO, nom: "Léo", role: "collaborateur" });
    expect(resultat).toMatchObject({ ok: false, code: "ACCES_REFUSE" });
  });
});

describe("desactiverMembre", () => {
  it("base d'abord, puis blocage Auth ; renvoie le nombre de demandes remises", async () => {
    const resultat = await desactiverMembre(LEO);
    expect(resultat).toEqual({ ok: true, donnees: { demandesRemises: 2 } });
    expect(sim.ordre).toEqual(["sql:desactiver_membre", "auth"]);
    expect(sim.updateUserById).toHaveBeenCalledWith(LEO, { ban_duration: "876000h" });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
  });

  it("ETAT_COMPTE_INVALIDE (déjà changé ailleurs) : liste rafraîchie, aucun blocage", async () => {
    sim.rpcSession.mockResolvedValue(erreurPrevue("ETAT_COMPTE_INVALIDE"));
    const resultat = await desactiverMembre(LEO);
    expect(resultat).toMatchObject({ ok: false, code: "ETAT_COMPTE_INVALIDE" });
    expect(sim.ordre).toEqual(["sql:desactiver_membre"]);
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
  });

  it("refus de la base : aucun blocage Auth", async () => {
    sim.rpcSession.mockResolvedValue(erreurPrevue("DERNIER_ADMIN"));
    const resultat = await desactiverMembre(LEO);
    expect(resultat).toEqual({ ok: false, code: "DERNIER_ADMIN", message: messageErreur("DERNIER_ADMIN") });
    expect(sim.ordre).toEqual(["sql:desactiver_membre"]);
  });

  it.each([
    ["erreur", () => sim.updateUserById.mockResolvedValue({ data: null, error: { code: "unexpected_failure", status: 500 } })],
    ["exception", () => sim.updateUserById.mockRejectedValue(new Error("réseau"))],
  ])("blocage Auth en %s : signalé à Sentry, la désactivation reste faite", async (_nom, preparer) => {
    preparer();
    const resultat = await desactiverMembre(LEO);
    expect(resultat).toEqual({ ok: true, donnees: { demandesRemises: 2 } });
    expect(sim.captureMessage).toHaveBeenCalledTimes(1);
    expect(String(sim.captureMessage.mock.calls[0][0])).toContain("blocage Auth impossible");
    expect(sim.revalidatePath).toHaveBeenCalled();
  });

  it("identifiant mal formé : DONNEES_INVALIDES, aucun appel", async () => {
    expect(await desactiverMembre("abc")).toMatchObject({ ok: false, code: "DONNEES_INVALIDES" });
    expect(sim.ordre).toEqual([]);
  });
});

describe("reactiverMembre", () => {
  it("déblocage Auth d'abord, puis base", async () => {
    const resultat = await reactiverMembre(LEO);
    expect(resultat).toEqual({ ok: true, donnees: null });
    expect(sim.ordre).toEqual(["auth", "sql:reactiver_membre"]);
    expect(sim.updateUserById).toHaveBeenCalledWith(LEO, { ban_duration: "none" });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
  });

  it.each([
    ["erreur", () => sim.updateUserById.mockResolvedValue({ data: null, error: { code: "unexpected_failure", status: 500 } })],
    ["exception", () => sim.updateUserById.mockRejectedValue(new Error("réseau"))],
  ])("déblocage Auth en %s : rien n'est changé en base", async (_nom, preparer) => {
    preparer();
    const resultat = await reactiverMembre(LEO);
    expect(resultat).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.ordre).toEqual(["auth"]);
    expect(sim.captureMessage).toHaveBeenCalledTimes(1);
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["DROIT_INSUFFISANT", () => erreurPrevue("DROIT_INSUFFISANT"), "ACCES_REFUSE"],
    ["erreur inattendue", () => ({ data: null, error: { code: "XX000", message: "panne" } }), "ERREUR_INATTENDUE"],
  ])("refus de la base après déblocage (%s) : blocage Auth remis", async (_cas, reponse, code) => {
    sim.rpcSession.mockResolvedValue(reponse());
    const resultat = await reactiverMembre(LEO);
    expect(resultat).toMatchObject({ ok: false, code });
    expect(sim.ordre).toEqual(["auth", "sql:reactiver_membre", "auth"]);
    expect(sim.updateUserById).toHaveBeenNthCalledWith(1, LEO, { ban_duration: "none" });
    expect(sim.updateUserById).toHaveBeenNthCalledWith(2, LEO, { ban_duration: "876000h" });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("re-blocage en échec : signalé à Sentry (identifiant seulement)", async () => {
    sim.rpcSession.mockResolvedValue(erreurPrevue("DROIT_INSUFFISANT"));
    sim.updateUserById
      .mockResolvedValueOnce({ data: { user: {} }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "unexpected_failure", status: 500 } });
    await reactiverMembre(LEO);
    expect(sim.captureMessage).toHaveBeenCalledTimes(1);
    const message = String(sim.captureMessage.mock.calls[0][0]);
    expect(message).toContain("[reactiverMembre] blocage Auth impossible");
    expect(message).toContain(`id=${LEO}`);
  });

  it("ETAT_COMPTE_INVALIDE (compte pas désactivé) : pas de re-blocage, liste rafraîchie", async () => {
    sim.rpcSession.mockResolvedValue(erreurPrevue("ETAT_COMPTE_INVALIDE"));
    const resultat = await reactiverMembre(LEO);
    expect(resultat).toMatchObject({ ok: false, code: "ETAT_COMPTE_INVALIDE" });
    expect(sim.ordre).toEqual(["auth", "sql:reactiver_membre"]);
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
  });
});

describe("inviter — adresse d'un compte désactivé", () => {
  function formulaire() {
    const donnees = new FormData();
    donnees.set("nom", "Léo Martin");
    donnees.set("email", "leo@example.com");
    donnees.set("role", "collaborateur");
    return donnees;
  }

  it("COMPTE_DESACTIVE : message sous Email et identifiant à réactiver, rien n'est créé", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://nova.example/";
    sim.rpcService.mockResolvedValue(erreurPrevue("COMPTE_DESACTIVE", JSON.stringify({ id: LEO })));
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire());
    expect(etat).toEqual({
      erreurs: { email: "Cette adresse appartient à un compte désactivé." },
      erreurGenerale: null,
      tentative: 1,
      invitation: null,
      compteDesactive: { id: LEO },
    });
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("COMPTE_DESACTIVE sans identifiant valable : « adresse déjà utilisée »", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://nova.example/";
    sim.rpcService.mockResolvedValue(erreurPrevue("COMPTE_DESACTIVE"));
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire());
    expect(etat.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
    expect(etat.compteDesactive).toBeUndefined();
    expect(sim.generateLink).not.toHaveBeenCalled();
  });
});
