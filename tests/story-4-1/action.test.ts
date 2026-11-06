import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 4.1 — actions `inviter` (lib/actions/admin.ts), `confirmerLien` et
// `choisirMotDePasse` (lib/actions/comptes.ts), sans base : profil, client
// service et client de session simulés. Refus du collaborateur (rien créé),
// email déjà pris (Auth ou membres), retour arrière AD-17 (compte Auth
// supprimé, échec de suppression signalé à Sentry), adresse du site absente,
// lien fabriqué depuis NEXT_PUBLIC_SITE_URL ; mot de passe trop court refusé
// sans appel à Auth.

const sim = vi.hoisted(() => ({
  profil: null as unknown,
  generateLink: vi.fn(),
  deleteUser: vi.fn(),
  rpcService: vi.fn(),
  rpcSession: vi.fn(),
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  captureMessage: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((adresse: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${adresse}`), { digest: "NEXT_REDIRECT" });
  }),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: sim.captureMessage }));
vi.mock("next/cache", () => ({ revalidatePath: sim.revalidatePath, refresh: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: sim.redirect,
  RedirectType: { replace: "replace", push: "push" },
}));

vi.mock("@/lib/session", async (importer) => ({
  ...(await importer<typeof import("@/lib/session")>()),
  lireProfil: async () => sim.profil,
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => ({
    auth: { admin: { generateLink: sim.generateLink, deleteUser: sim.deleteUser } },
    rpc: sim.rpcService,
  }),
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => ({
    auth: { getClaims: sim.getClaims, updateUser: sim.updateUser, verifyOtp: sim.verifyOtp },
    rpc: sim.rpcSession,
  }),
}));

import { inviter } from "@/lib/actions/admin";
import { choisirMotDePasse, confirmerLien } from "@/lib/actions/comptes";
import { messageErreur } from "@/lib/erreurs";
import { ETAT_INVITATION_INITIAL } from "@/lib/schemas/invitation";
import {
  ETAT_CONFIRMATION_INITIAL,
  ETAT_MOT_DE_PASSE_INITIAL,
  MESSAGES_MOT_DE_PASSE,
} from "@/lib/schemas/mot-de-passe";

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
const COLLABORATEUR = {
  ok: true,
  donnees: { ...ADMIN.donnees, role: "collaborateur", estAdmin: false },
};
const NOUVEL_ID = "22222222-2222-4222-8222-222222222222";
const JETON = "a".repeat(56);

function formulaire(valeurs: Record<string, string>): FormData {
  const donnees = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) donnees.set(cle, valeur);
  return donnees;
}

/** Réponses du client service, par fonction SQL (réussite par défaut). */
function repondre(reponses: { libre?: unknown; creer?: unknown }) {
  sim.rpcService.mockImplementation(async (fonction: string) => {
    if (fonction === "verifier_email_libre") return reponses.libre ?? { data: { libre: true }, error: null };
    if (fonction === "creer_membre") return reponses.creer ?? { data: { id: NOUVEL_ID }, error: null };
    return { data: null, error: { code: "42883", message: "inconnue" } };
  });
}

const LEO = { nom: "  Léo Martin ", email: " Leo.Martin@Example.com ", role: "collaborateur" };

const siteAvant = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://nova.example/";
  sim.profil = ADMIN;
  sim.generateLink.mockImplementation(async () => ({
    data: {
      user: { id: NOUVEL_ID, created_at: new Date().toISOString() },
      properties: { hashed_token: JETON },
    },
    error: null,
  }));
  sim.deleteUser.mockResolvedValue({ data: {}, error: null });
  repondre({});

});

afterEach(() => {
  vi.clearAllMocks();
  sim.generateLink.mockReset();
  sim.deleteUser.mockReset();
  sim.rpcService.mockReset();
  sim.rpcSession.mockReset();
  sim.getClaims.mockReset();
  sim.updateUser.mockReset();
  sim.verifyOtp.mockReset();
  process.env.NEXT_PUBLIC_SITE_URL = siteAvant;
});

describe("inviter", () => {
  it("crée le compte Auth puis le membre invité, au nom de l'administrateur, et renvoie le lien", async () => {
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));

    expect(sim.generateLink).toHaveBeenCalledWith({ type: "invite", email: "leo.martin@example.com" });
    expect(sim.rpcService).toHaveBeenCalledWith("verifier_email_libre", {
      p_email: "leo.martin@example.com",
    });
    expect(sim.rpcService).toHaveBeenCalledWith("creer_membre", {
      p_id: NOUVEL_ID,
      p_nom: "Léo Martin",
      p_email: "leo.martin@example.com",
      p_role: "collaborateur",
      p_etat: "invite",
      p_auteur_id: ADMIN.donnees.id,
    });
    expect(sim.deleteUser).not.toHaveBeenCalled();
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/comptes");
    expect(etat).toEqual({
      erreurs: {},
      erreurGenerale: null,
      tentative: 1,
      invitation: {
        nom: "Léo Martin",
        lien: `https://nova.example/auth/confirmer?token_hash=${JETON}&type=invite`,
      },
    });
  });

  it.each([
    ["collaborateur", COLLABORATEUR],
    ["sans membre actif", { ok: true, donnees: null }],
  ])("%s : accès refusé, rien n'est créé", async (_cas, profil) => {
    sim.profil = profil;
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurGenerale).toBe(messageErreur("ACCES_REFUSE"));
    expect(etat.invitation).toBeNull();
    expect(sim.generateLink).not.toHaveBeenCalled();
    expect(sim.rpcService).not.toHaveBeenCalled();
  });

  it("saisie invalide : messages sous les champs, rien n'est créé", async () => {
    const etat = await inviter(
      ETAT_INVITATION_INITIAL,
      formulaire({ nom: " ", email: "pas-un-email", role: "chef" }),
    );
    expect(Object.keys(etat.erreurs).sort()).toEqual(["email", "nom", "role"]);
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("email déjà dans Auth : message sous Email, aucun membre créé", async () => {
    sim.generateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { code: "email_exists", status: 422 },
    });
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
    expect(etat.erreurs.email).toBe("Cette adresse email est déjà utilisée par un autre membre.");
    expect(sim.rpcService).not.toHaveBeenCalledWith("creer_membre", expect.anything());
    expect(sim.deleteUser).not.toHaveBeenCalled();
  });

  it("email déjà dans membres ou dans Auth (vérification préalable) : message sous Email, rien créé ni supprimé", async () => {
    repondre({ libre: { data: null, error: { code: "P0001", message: "EMAIL_DEJA_UTILISE" } } });
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
    // Vérifié AVANT generateLink : aucun compte Auth touché.
    expect(sim.generateLink).not.toHaveBeenCalled();
    expect(sim.deleteUser).not.toHaveBeenCalled();
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("generateLink renvoie un compte existant (date ancienne) : ni suppression ni lien", async () => {
    sim.generateLink.mockResolvedValue({
      data: {
        user: { id: NOUVEL_ID, created_at: "2026-01-01T00:00:00Z" },
        properties: { hashed_token: JETON },
      },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
    expect(etat.invitation).toBeNull();
    expect(sim.deleteUser).not.toHaveBeenCalled();
    expect(sim.rpcService).not.toHaveBeenCalledWith("creer_membre", expect.anything());
  });

  it.each(["MEMBRE_EXISTANT", "EMAIL_DEJA_UTILISE"])(
    "creer_membre refuse (%s, invitation simultanée) : le compte Auth n'est jamais supprimé",
    async (code) => {
      repondre({ creer: { data: null, error: { code: "P0001", message: code } } });
      const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
      expect(etat.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
      expect(etat.invitation).toBeNull();
      expect(sim.deleteUser).not.toHaveBeenCalled();
    },
  );

  it("échec de creer_membre : compte Auth supprimé, erreur affichée", async () => {
    repondre({ creer: { data: null, error: { code: "08006", message: "panne" } } });
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurGenerale).toBe(messageErreur("ERREUR_INATTENDUE"));
    expect(etat.invitation).toBeNull();
    expect(sim.deleteUser).toHaveBeenCalledWith(NOUVEL_ID);
  });

  it("nouveau compte sans jeton : compte supprimé et signalé à Sentry", async () => {
    sim.generateLink.mockResolvedValue({
      data: { user: { id: NOUVEL_ID, created_at: new Date().toISOString() }, properties: {} },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurGenerale).toBe(messageErreur("ERREUR_INATTENDUE"));
    expect(etat.invitation).toBeNull();
    expect(sim.deleteUser).toHaveBeenCalledWith(NOUVEL_ID);
    expect(sim.captureMessage).toHaveBeenCalled();
    expect(sim.rpcService).not.toHaveBeenCalledWith("creer_membre", expect.anything());
  });

  it("suppression du compte Auth impossible : signalée à Sentry, sans email", async () => {
    repondre({ creer: { data: null, error: { code: "08006", message: "panne" } } });
    sim.deleteUser.mockResolvedValue({ data: null, error: { code: "unexpected_failure", status: 500 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    const messages = sim.captureMessage.mock.calls.map(([message]) => String(message));
    expect(messages.some((m) => m.includes("compte Auth orphelin") && m.includes(NOUVEL_ID))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/leo|martin/i);
  });

  it("l'auteur n'est plus administrateur (DROIT_INSUFFISANT) : refus, compte Auth supprimé", async () => {
    repondre({ creer: { data: null, error: { code: "P0001", message: "DROIT_INSUFFISANT" } } });
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurGenerale).toBe(messageErreur("ACCES_REFUSE"));
    expect(sim.deleteUser).toHaveBeenCalledWith(NOUVEL_ID);
  });

  it.each(["", "   ", "pas une adresse", "ftp://nova.example", "https://nova.example/chemin"])(
    "NEXT_PUBLIC_SITE_URL = %j : invitation refusée avant toute création",
    async (valeur) => {
      process.env.NEXT_PUBLIC_SITE_URL = valeur;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
      expect(etat.erreurGenerale).toBe(messageErreur("ADRESSE_SITE_MANQUANTE"));
      expect(sim.generateLink).not.toHaveBeenCalled();
    },
  );

  it("NEXT_PUBLIC_SITE_URL absente : invitation refusée", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire(LEO));
    expect(etat.erreurGenerale).toBe(messageErreur("ADRESSE_SITE_MANQUANTE"));
    expect(sim.generateLink).not.toHaveBeenCalled();
  });
});

describe("confirmerLien", () => {
  it("lien valide : vérifié côté serveur puis /nouveau-mot-de-passe", async () => {
    sim.verifyOtp.mockResolvedValue({ data: {}, error: null });
    await expect(
      confirmerLien(ETAT_CONFIRMATION_INITIAL, formulaire({ token_hash: JETON, type: "invite" })),
    ).rejects.toThrow("NEXT_REDIRECT:/nouveau-mot-de-passe");
    expect(sim.verifyOtp).toHaveBeenCalledWith({ token_hash: JETON, type: "invite" });
  });

  it("lien expiré ou déjà utilisé : « Ce lien n'est plus valable… »", async () => {
    sim.verifyOtp.mockResolvedValue({ data: {}, error: { code: "otp_expired", status: 403 } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const etat = await confirmerLien(
      ETAT_CONFIRMATION_INITIAL,
      formulaire({ token_hash: JETON, type: "invite" }),
    );
    expect(etat.erreur).toBe("Ce lien n'est plus valable. Contactez votre administrateur.");
  });

  it.each([429, 503])("Auth répond %i : erreur serveur, pas « lien plus valable »", async (statut) => {
    sim.verifyOtp.mockResolvedValue({ data: {}, error: { code: "x", status: statut } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await confirmerLien(
      ETAT_CONFIRMATION_INITIAL,
      formulaire({ token_hash: JETON, type: "invite" }),
    );
    expect(etat.erreur).toBe(messageErreur("ERREUR_INATTENDUE"));
  });

  it.each([
    { token_hash: "court", type: "invite" },
    { token_hash: JETON, type: "recovery" },
    { token_hash: `${JETON}<script>`, type: "invite" },
  ])("lien mal formé %j : refusé sans appel à Auth", async (valeurs) => {
    const etat = await confirmerLien(ETAT_CONFIRMATION_INITIAL, formulaire(valeurs));
    expect(etat.erreur).toBe(messageErreur("LIEN_INVALIDE"));
    expect(sim.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("choisirMotDePasse", () => {
  const BON = { mot_de_passe: "un-bon-mot-de-passe", confirmation: "un-bon-mot-de-passe" };

  beforeEach(() => {
    sim.getClaims.mockResolvedValue({ data: { claims: { sub: NOUVEL_ID } }, error: null });
    sim.updateUser.mockResolvedValue({ data: {}, error: null });
    sim.rpcSession.mockImplementation(async (fonction: string) => {
      if (fonction === "mon_invitation") return { data: { nom: "Léo Martin" }, error: null };
      if (fonction === "activer_mon_compte") return { data: { etat: "actif" }, error: null };
      return { data: null, error: null };
    });
  });

  it("7 caractères : refusé sous le champ, sans appel à Auth (compte toujours invité)", async () => {
    const etat = await choisirMotDePasse(
      ETAT_MOT_DE_PASSE_INITIAL,
      formulaire({ mot_de_passe: "1234567", confirmation: "1234567" }),
    );
    expect(etat.erreurs).toEqual({ mot_de_passe: MESSAGES_MOT_DE_PASSE.court });
    expect(sim.updateUser).not.toHaveBeenCalled();
    expect(sim.rpcSession).not.toHaveBeenCalled();
  });

  it("confirmation différente : refusée sous la confirmation", async () => {
    const etat = await choisirMotDePasse(
      ETAT_MOT_DE_PASSE_INITIAL,
      formulaire({ mot_de_passe: "12345678", confirmation: "12345679" }),
    );
    expect(etat.erreurs).toEqual({ confirmation: MESSAGES_MOT_DE_PASSE.differents });
    expect(sim.updateUser).not.toHaveBeenCalled();
  });

  it("8+ caractères : mot de passe posé, compte activé, puis /equipe", async () => {
    await expect(choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON))).rejects.toThrow(
      "NEXT_REDIRECT:/equipe",
    );
    expect(sim.updateUser).toHaveBeenCalledWith({ password: BON.mot_de_passe });
    expect(sim.rpcSession).toHaveBeenCalledWith("activer_mon_compte", undefined);
  });

  it("refus de Supabase (weak_password) : message sous le champ, pas d'activation", async () => {
    sim.updateUser.mockResolvedValue({ data: null, error: { code: "weak_password", status: 422 } });
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurs).toEqual({ mot_de_passe: MESSAGES_MOT_DE_PASSE.refuse });
    expect(sim.rpcSession).not.toHaveBeenCalledWith("activer_mon_compte", undefined);
  });

  it("sans session : « Ce lien n'est plus valable… »", async () => {
    sim.getClaims.mockResolvedValue({ data: null, error: null });
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale).toEqual({ type: "lien", message: messageErreur("LIEN_INVALIDE") });
    expect(sim.updateUser).not.toHaveBeenCalled();
  });

  it("session d'un compte qui n'est pas invité (désactivé) : lien plus valable, rien changé", async () => {
    sim.rpcSession.mockImplementation(async () => ({ data: null, error: null }));
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale?.type).toBe("lien");
    expect(sim.updateUser).not.toHaveBeenCalled();
  });

  it("same_password (premier envoi dont l'activation a échoué) : activation puis /equipe", async () => {
    sim.updateUser.mockResolvedValue({ data: null, error: { code: "same_password", status: 422 } });
    await expect(choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON))).rejects.toThrow(
      "NEXT_REDIRECT:/equipe",
    );
    expect(sim.rpcSession).toHaveBeenCalledWith("activer_mon_compte", undefined);
  });

  it("déjà activé (mon_invitation null, profil actif) : /equipe sans toucher au mot de passe", async () => {
    sim.rpcSession.mockImplementation(async (fonction: string) => {
      if (fonction === "mon_profil") {
        return { data: { nom: "Léo Martin", role: "collaborateur", etat: "actif" }, error: null };
      }
      return { data: null, error: null };
    });
    await expect(choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON))).rejects.toThrow(
      "NEXT_REDIRECT:/equipe",
    );
    expect(sim.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["session_not_found", 401, "lien"],
    ["inattendu", 400, "serveur"],
  ])("updateUser refuse (%s) : bandeau « %s »", async (code, statut, type) => {
    sim.updateUser.mockResolvedValue({ data: null, error: { code, status: statut } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale?.type).toBe(type);
    expect(sim.rpcSession).not.toHaveBeenCalledWith("activer_mon_compte", undefined);
  });

  it("activer_mon_compte échoue (autre que DROIT_INSUFFISANT) : bandeau « serveur »", async () => {
    sim.rpcSession.mockImplementation(async (fonction: string) => {
      if (fonction === "mon_invitation") return { data: { nom: "Léo Martin" }, error: null };
      return { data: null, error: { code: "08006", message: "panne" } };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale?.type).toBe("serveur");
  });

  it.each([429, 503])("getClaims répond %i : bandeau « serveur », pas « lien »", async (statut) => {
    sim.getClaims.mockResolvedValue({ data: null, error: { name: "AuthApiError", status: statut } });
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale?.type).toBe("serveur");
    expect(sim.updateUser).not.toHaveBeenCalled();
  });
});
