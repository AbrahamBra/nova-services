import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 4.4 — actions sans base (clients et profil simulés) :
//   - `renvoyerInvitation` : refus du collaborateur (rien noté ni généré),
//     adresse du site vérifiée avant tout, ordre noter_renvoi_invitation →
//     generateLink (invite) ; adresse déjà confirmée : lien recovery ;
//     autre compte renvoyé : supprimé seulement s'il vient d'être créé par
//     cet appel ; échec d'Auth : signalé à Sentry avec les ids seulement ;
//     invitation déjà annulée (DONNEES_INVALIDES) : ETAT_COMPTE_INVALIDE ;
//   - `annulerInvitation` : refus du collaborateur, ordre annuler_invitation
//     → deleteUser ; échec de la suppression Auth : réussite quand même,
//     Sentry alerté (id seulement) ; ETAT_COMPTE_INVALIDE : rien supprimé,
//     liste rafraîchie.

const sim = vi.hoisted(() => ({
  profil: null as unknown,
  generateLink: vi.fn(),
  deleteUser: vi.fn(),
  rpcSession: vi.fn(),
  captureMessage: vi.fn(),
  revalidatePath: vi.fn(),
  ordre: [] as string[],
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
    auth: { admin: { generateLink: sim.generateLink, deleteUser: sim.deleteUser } },
    rpc: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => ({ auth: {}, rpc: sim.rpcSession }),
}));

import { annulerInvitation, renvoyerInvitation } from "@/lib/actions/admin";
import { messageErreur } from "@/lib/erreurs";

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
const MEMBRE_ID = "22222222-2222-4222-8222-222222222222";
const AUTRE_ID = "44444444-4444-4444-8444-444444444444";
const JETON = "d".repeat(56);
const LIEN = `https://nova.example/auth/confirmer?token_hash=${JETON}&type=invite`;

const avant = { site: process.env.NEXT_PUBLIC_SITE_URL };

/** Messages envoyés à Sentry, réunis. */
function sentry(): string {
  return sim.captureMessage.mock.calls.map(([m]) => String(m)).join(" ");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://nova.example/";
  sim.profil = ADMIN;
  sim.ordre = [];
  sim.rpcSession.mockImplementation(async (fonction: string) => {
    sim.ordre.push(fonction);
    return { data: { id: MEMBRE_ID, nom: "Léo Martin", email: "leo@example.com" }, error: null };
  });
  sim.generateLink.mockImplementation(async () => {
    sim.ordre.push("generateLink");
    return { data: { user: { id: MEMBRE_ID }, properties: { hashed_token: JETON } }, error: null };
  });
  sim.deleteUser.mockImplementation(async () => {
    sim.ordre.push("deleteUser");
    return { data: null, error: null };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = avant.site;
});

describe("renvoyerInvitation", () => {
  it("collaborateur : ACCES_REFUSE, rien noté ni généré", async () => {
    sim.profil = COLLABORATEUR;
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r).toEqual({ ok: false, code: "ACCES_REFUSE", message: messageErreur("ACCES_REFUSE") });
    expect(sim.rpcSession).not.toHaveBeenCalled();
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("visiteur sans session : ACCES_REFUSE", async () => {
    sim.profil = { ok: true, donnees: null };
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ACCES_REFUSE");
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("identifiant invalide : DONNEES_INVALIDES", async () => {
    const r = await renvoyerInvitation("pas-un-uuid");
    expect(r.ok === false && r.code).toBe("DONNEES_INVALIDES");
    expect(sim.rpcSession).not.toHaveBeenCalled();
  });

  it("NEXT_PUBLIC_SITE_URL absente : refus avant toute écriture au journal", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ADRESSE_SITE_MANQUANTE");
    expect(sim.rpcSession).not.toHaveBeenCalled();
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("membre invité : noter_renvoi_invitation puis generateLink (invite) ; nouveau lien affiché", async () => {
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r).toEqual({ ok: true, donnees: { nom: "Léo Martin", lien: LIEN } });
    expect(sim.ordre).toEqual(["noter_renvoi_invitation", "generateLink"]);
    expect(sim.rpcSession).toHaveBeenCalledWith("noter_renvoi_invitation", { p_id: MEMBRE_ID });
    expect(sim.generateLink).toHaveBeenCalledWith({ type: "invite", email: "leo@example.com" });
    expect(sim.deleteUser).not.toHaveBeenCalled();
  });

  it.each([
    ["ETAT_COMPTE_INVALIDE", "ETAT_COMPTE_INVALIDE"],
    ["DROIT_INSUFFISANT", "ACCES_REFUSE"],
  ])("la base refuse (%s) : %s, aucun appel à Auth", async (code, attendu) => {
    sim.rpcSession.mockResolvedValue({ data: null, error: { code: "P0001", message: code } });
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe(attendu);
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("ETAT_COMPTE_INVALIDE : la liste est rafraîchie", async () => {
    sim.rpcSession.mockResolvedValue({ data: null, error: { code: "P0001", message: "ETAT_COMPTE_INVALIDE" } });
    await renvoyerInvitation(MEMBRE_ID);
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
  });

  it("generateLink renvoie un compte existant autre que celui attendu : ERREUR_INATTENDUE, rien supprimé, Sentry (ids seulement)", async () => {
    sim.generateLink.mockResolvedValue({
      data: {
        user: { id: AUTRE_ID, created_at: "2020-01-01T00:00:00Z" },
        properties: { hashed_token: JETON },
      },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ERREUR_INATTENDUE");
    expect(sim.deleteUser).not.toHaveBeenCalled();
    expect(sentry()).toContain(MEMBRE_ID);
    expect(sentry()).toContain(AUTRE_ID);
    expect(sentry()).not.toMatch(/leo|Léo/i);
  });

  it("invitation annulée entre-temps : le compte Auth créé par CET appel est supprimé, signalé", async () => {
    sim.generateLink.mockResolvedValue({
      data: {
        user: { id: AUTRE_ID, created_at: new Date().toISOString() },
        properties: { hashed_token: JETON },
      },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ERREUR_INATTENDUE");
    expect(sim.deleteUser).toHaveBeenCalledTimes(1);
    expect(sim.deleteUser).toHaveBeenCalledWith(AUTRE_ID);
    expect(sentry()).toContain(AUTRE_ID);
    expect(sentry()).not.toMatch(/leo|Léo/i);
  });

  it.each([
    [{ code: "email_exists", status: 422 }],
    [{ status: 422 }],
  ])("adresse déjà confirmée (%j) : lien recovery pour le même membre, même fenêtre", async (erreur) => {
    sim.generateLink.mockImplementation(async ({ type }: { type: string }) => {
      sim.ordre.push(`generateLink:${type}`);
      if (type === "invite") return { data: null, error: erreur };
      return { data: { user: { id: MEMBRE_ID }, properties: { hashed_token: JETON } }, error: null };
    });
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r).toEqual({
      ok: true,
      donnees: {
        nom: "Léo Martin",
        lien: `https://nova.example/auth/confirmer?token_hash=${JETON}&type=recovery`,
      },
    });
    expect(sim.ordre).toEqual(["noter_renvoi_invitation", "generateLink:invite", "generateLink:recovery"]);
    expect(sim.generateLink).toHaveBeenLastCalledWith({ type: "recovery", email: "leo@example.com" });
    expect(sim.deleteUser).not.toHaveBeenCalled();
  });

  it("lien recovery pour un autre compte : ERREUR_INATTENDUE, rien supprimé", async () => {
    sim.generateLink.mockImplementation(async ({ type }: { type: string }) =>
      type === "invite"
        ? { data: null, error: { code: "email_exists", status: 422 } }
        : {
            data: { user: { id: AUTRE_ID, created_at: "2020-01-01T00:00:00Z" }, properties: { hashed_token: JETON } },
            error: null,
          },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ERREUR_INATTENDUE");
    expect(sim.deleteUser).not.toHaveBeenCalled();
  });

  it("generateLink en erreur (autre que adresse confirmée) ou exception : ERREUR_INATTENDUE, rien supprimé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sim.generateLink.mockResolvedValueOnce({ data: null, error: { code: "unexpected_failure", status: 500 } });
    const r1 = await renvoyerInvitation(MEMBRE_ID);
    expect(r1.ok === false && r1.code).toBe("ERREUR_INATTENDUE");
    sim.generateLink.mockRejectedValueOnce(new Error("réseau"));
    const r2 = await renvoyerInvitation(MEMBRE_ID);
    expect(r2.ok === false && r2.code).toBe("ERREUR_INATTENDUE");
    expect(sim.generateLink).toHaveBeenCalledTimes(2);
    expect(sim.deleteUser).not.toHaveBeenCalled();
    expect(sim.captureMessage).toHaveBeenCalledTimes(2);
    expect(sentry()).not.toMatch(/leo|Léo/i);
  });

  it("invitation déjà annulée par un autre administrateur (DONNEES_INVALIDES) : ETAT_COMPTE_INVALIDE, liste rafraîchie", async () => {
    sim.rpcSession.mockResolvedValue({ data: null, error: { code: "P0001", message: "DONNEES_INVALIDES" } });
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ETAT_COMPTE_INVALIDE");
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("generateLink sans jeton : ERREUR_INATTENDUE, rien supprimé", async () => {
    sim.generateLink.mockResolvedValue({ data: { user: { id: MEMBRE_ID }, properties: {} }, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ERREUR_INATTENDUE");
    expect(sim.deleteUser).not.toHaveBeenCalled();
  });

  it("réponse de la base sans email : ERREUR_INATTENDUE, aucun appel à Auth", async () => {
    sim.rpcSession.mockResolvedValue({ data: { id: MEMBRE_ID, nom: "Léo Martin" }, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await renvoyerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ERREUR_INATTENDUE");
    expect(sim.generateLink).not.toHaveBeenCalled();
  });
});

describe("annulerInvitation", () => {
  it("collaborateur : ACCES_REFUSE, rien supprimé", async () => {
    sim.profil = COLLABORATEUR;
    const r = await annulerInvitation(MEMBRE_ID);
    expect(r).toEqual({ ok: false, code: "ACCES_REFUSE", message: messageErreur("ACCES_REFUSE") });
    expect(sim.rpcSession).not.toHaveBeenCalled();
    expect(sim.deleteUser).not.toHaveBeenCalled();
  });

  it("identifiant invalide : DONNEES_INVALIDES", async () => {
    const r = await annulerInvitation("pas-un-uuid");
    expect(r.ok === false && r.code).toBe("DONNEES_INVALIDES");
    expect(sim.rpcSession).not.toHaveBeenCalled();
  });

  it("membre invité : annuler_invitation PUIS suppression du compte Auth ; liste rafraîchie", async () => {
    const r = await annulerInvitation(MEMBRE_ID);
    expect(r).toEqual({ ok: true, donnees: null });
    expect(sim.ordre).toEqual(["annuler_invitation", "deleteUser"]);
    expect(sim.rpcSession).toHaveBeenCalledWith("annuler_invitation", { p_id: MEMBRE_ID });
    expect(sim.deleteUser).toHaveBeenCalledWith(MEMBRE_ID);
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
    expect(sim.captureMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["ETAT_COMPTE_INVALIDE", "ETAT_COMPTE_INVALIDE"],
    ["DROIT_INSUFFISANT", "ACCES_REFUSE"],
    ["DONNEES_INVALIDES", "ETAT_COMPTE_INVALIDE"],
  ])("la base refuse (%s) : %s, compte Auth jamais supprimé", async (code, attendu) => {
    sim.rpcSession.mockResolvedValue({ data: null, error: { code: "P0001", message: code } });
    const r = await annulerInvitation(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe(attendu);
    expect(sim.deleteUser).not.toHaveBeenCalled();
  });

  it.each(["ETAT_COMPTE_INVALIDE", "DONNEES_INVALIDES"])(
    "%s (compte actif, ou invitation déjà annulée) : la liste est rafraîchie",
    async (code) => {
      sim.rpcSession.mockResolvedValue({ data: null, error: { code: "P0001", message: code } });
      await annulerInvitation(MEMBRE_ID);
      expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
    },
  );

  it("suppression Auth en échec : réussite quand même, Sentry alerté (id seulement)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sim.deleteUser.mockResolvedValue({ data: null, error: { code: "unexpected_failure", status: 500 } });
    const r = await annulerInvitation(MEMBRE_ID);
    expect(r).toEqual({ ok: true, donnees: null });
    expect(sim.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry()).toContain(MEMBRE_ID);
    expect(sentry()).toContain("verifier_email_libre");
    expect(sentry()).not.toMatch(/leo|Léo/i);
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
  });

  it("suppression Auth en exception : réussite quand même, Sentry alerté", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sim.deleteUser.mockRejectedValue(new Error("réseau"));
    const r = await annulerInvitation(MEMBRE_ID);
    expect(r.ok).toBe(true);
    expect(sim.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("compte Auth déjà absent (404) : réussite, rien signalé", async () => {
    sim.deleteUser.mockResolvedValue({ data: null, error: { code: "user_not_found", status: 404 } });
    const r = await annulerInvitation(MEMBRE_ID);
    expect(r.ok).toBe(true);
    expect(sim.captureMessage).not.toHaveBeenCalled();
  });
});
