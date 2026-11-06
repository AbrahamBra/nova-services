import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 4.3 — actions sans base (clients, profil et envoi simulés) :
//   - `demanderLienMotDePasse` : le même état est renvoyé quel que soit
//     l'email (inconnu, invité, désactivé, actif, limite, hors liste, envoi
//     impossible) ; rien n'est traité avant la réponse (`after`) ; ordre
//     demander_reinitialisation → generateLink (recovery) → email ; aucun
//     lien hors EMAILS_AUTORISES ; échec signalé à Sentry sans email ;
//   - `genererLienMotDePasse` : refus du collaborateur (rien généré), compte
//     non actif, ordre noter_lien_mot_de_passe → generateLink ;
//   - `confirmerLien` et `choisirMotDePasse` en version réinitialisation.

const sim = vi.hoisted(() => ({
  profil: null as unknown,
  apres: [] as (() => unknown)[],
  generateLink: vi.fn(),
  rpcService: vi.fn(),
  rpcSession: vi.fn(),
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  envoyer: vi.fn(),
  signOut: vi.fn(),
  sansEmpreinte: false,
  captureMessage: vi.fn(),
  revalidatePath: vi.fn(),
  ordre: [] as string[],
  redirect: vi.fn((adresse: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${adresse}`), { digest: "NEXT_REDIRECT" });
  }),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: sim.captureMessage }));
vi.mock("next/cache", () => ({ revalidatePath: sim.revalidatePath, refresh: () => {} }));
vi.mock("next/server", () => ({
  after: (rappel: () => unknown) => {
    sim.apres.push(rappel);
  },
}));
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

vi.mock("@/lib/server/empreintes", async (importer) => {
  const reel = await importer<typeof import("@/lib/server/empreintes")>();
  return {
    ...reel,
    empreinteIp: (...args: Parameters<typeof reel.empreinteIp>) =>
      sim.sansEmpreinte ? null : reel.empreinteIp(...args),
  };
});

vi.mock("@/lib/server/emails", async (importer) => ({
  ...(await importer<typeof import("@/lib/server/emails")>()),
  envoyerLienMotDePasse: sim.envoyer,
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => ({
    auth: { admin: { generateLink: sim.generateLink } },
    rpc: sim.rpcService,
  }),
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => ({
    auth: {
      getClaims: sim.getClaims,
      updateUser: sim.updateUser,
      verifyOtp: sim.verifyOtp,
      signOut: sim.signOut,
    },
    rpc: sim.rpcSession,
  }),
}));

import { genererLienMotDePasse } from "@/lib/actions/admin";
import { choisirMotDePasse, confirmerLien, demanderLienMotDePasse } from "@/lib/actions/comptes";
import { messageErreur } from "@/lib/erreurs";
import {
  ETAT_CONFIRMATION_INITIAL,
  ETAT_DEMANDE_LIEN_INITIAL,
  ETAT_MOT_DE_PASSE_INITIAL,
  MESSAGE_DEMANDE_LIEN,
  MESSAGES_DEMANDE_LIEN,
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
const COLLABORATEUR = { ok: true, donnees: { ...ADMIN.donnees, role: "collaborateur", estAdmin: false } };
const MEMBRE_ID = "22222222-2222-4222-8222-222222222222";
const JETON = "c".repeat(56);
const ABRAHAM = "abraham@example.com";
const LIEN = `https://nova.example/auth/confirmer?token_hash=${JETON}&type=recovery`;

function formulaire(valeurs: Record<string, string>): FormData {
  const donnees = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) donnees.set(cle, valeur);
  return donnees;
}

/** Exécute les traitements programmés après la réponse. */
async function apresLaReponse() {
  const rappels = sim.apres.splice(0);
  for (const rappel of rappels) await rappel();
}

const avant = { site: process.env.NEXT_PUBLIC_SITE_URL, autorisees: process.env.EMAILS_AUTORISES };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://nova.example/";
  process.env.EMAILS_AUTORISES = ABRAHAM;
  sim.profil = ADMIN;
  sim.ordre = [];
  sim.sansEmpreinte = false;
  sim.signOut.mockResolvedValue({ error: null });
  sim.rpcService.mockImplementation(async (fonction: string) => {
    sim.ordre.push(fonction);
    return { data: { envoyer: true }, error: null };
  });
  sim.generateLink.mockImplementation(async () => {
    sim.ordre.push("generateLink");
    return { data: { user: { id: MEMBRE_ID }, properties: { hashed_token: JETON } }, error: null };
  });
  sim.envoyer.mockImplementation(async () => {
    sim.ordre.push("envoyer");
    return { etat: "envoye", code: null };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  sim.apres.length = 0;
  process.env.NEXT_PUBLIC_SITE_URL = avant.site;
  process.env.EMAILS_AUTORISES = avant.autorisees;
});

// --- Demande d'un lien -----------------------------------------------------------

describe("demanderLienMotDePasse", () => {
  const REPONSE = { erreurs: {}, envoyee: true, tentative: 1 };

  it("le message unique est celui de la spécification", () => {
    expect(MESSAGE_DEMANDE_LIEN).toBe(
      "Si un compte actif correspond à cette adresse, un email avec un lien valable 24 h vient de lui être envoyé. Sans email, demandez un lien à votre administrateur.",
    );
  });

  it.each(["", "pas une adresse"])("email %j : erreur sous le champ, rien de traité", async (email) => {
    const etat = await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email }));
    expect(etat.envoyee).toBe(false);
    expect(etat.erreurs.email).toBe(
      email === "" ? MESSAGES_DEMANDE_LIEN.emailVide : MESSAGES_DEMANDE_LIEN.emailInvalide,
    );
    expect(sim.apres).toEqual([]);
  });

  it("adresse autorisée, membre actif : réponse avant tout traitement, puis base → generateLink → email", async () => {
    const etat = await demanderLienMotDePasse(
      ETAT_DEMANDE_LIEN_INITIAL,
      formulaire({ email: ` ${ABRAHAM.toUpperCase()} ` }),
    );
    expect(etat).toEqual(REPONSE);
    // Rien n'a encore été fait : la réponse n'attend ni la base ni l'envoi.
    expect(sim.rpcService).not.toHaveBeenCalled();
    expect(sim.apres).toHaveLength(1);

    await apresLaReponse();
    expect(sim.ordre).toEqual(["demander_reinitialisation", "generateLink", "envoyer"]);
    const [, parametres] = sim.rpcService.mock.calls[0];
    expect(parametres.p_email).toBe(ABRAHAM);
    expect(parametres.p_empreinte_email).toMatch(/^[0-9a-f]{64}$/);
    expect(parametres.p_empreinte_ip).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(parametres)).not.toContain("127.0.0.1");
    expect(sim.generateLink).toHaveBeenCalledWith({ type: "recovery", email: ABRAHAM });
    expect(sim.envoyer).toHaveBeenCalledWith(ABRAHAM, { lien: LIEN, jetonHache: JETON });
  });

  it.each([
    ["inconnu, invité, désactivé ou limite atteinte (envoyer faux)", { data: { envoyer: false }, error: null }],
    ["base en panne", { data: null, error: { code: "08006", message: "panne" } }],
  ])("%s : même réponse, aucun lien généré", async (_cas, reponse) => {
    sim.rpcService.mockResolvedValue(reponse);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    expect(etat).toEqual(REPONSE);
    await apresLaReponse();
    expect(sim.generateLink).not.toHaveBeenCalled();
    expect(sim.envoyer).not.toHaveBeenCalled();
  });

  it("empreintes impossibles (en-tête IP ou secret absent) : même réponse, signalé à Sentry sans email", async () => {
    sim.sansEmpreinte = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    expect(etat).toEqual(REPONSE);
    expect(sim.apres).toEqual([]);
    const messages = sim.captureMessage.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes("empreintes impossibles"))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/abraham/i);
  });

  it("base en panne : signalé à Sentry sans email", async () => {
    sim.rpcService.mockResolvedValue({ data: null, error: { code: "08006", message: "panne" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    await apresLaReponse();
    const messages = sim.captureMessage.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes("demande non enregistrée"))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/abraham/i);
  });

  it("membre actif hors EMAILS_AUTORISES : même réponse, aucun lien généré ni envoyé", async () => {
    const etat = await demanderLienMotDePasse(
      ETAT_DEMANDE_LIEN_INITIAL,
      formulaire({ email: "leo@example.com" }),
    );
    expect(etat).toEqual(REPONSE);
    await apresLaReponse();
    expect(sim.rpcService).toHaveBeenCalledTimes(1);
    expect(sim.generateLink).not.toHaveBeenCalled();
    expect(sim.envoyer).not.toHaveBeenCalled();
  });

  it("liste vide (mode démonstration) : aucun lien", async () => {
    process.env.EMAILS_AUTORISES = "";
    await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    await apresLaReponse();
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("envoi impossible : même réponse, signalé à Sentry sans email", async () => {
    sim.envoyer.mockResolvedValue({ etat: "echec", code: "cle_absente" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    expect(etat).toEqual(REPONSE);
    await apresLaReponse();
    const messages = sim.captureMessage.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes("email non envoyé") && m.includes("cle_absente"))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/abraham/i);
  });

  it("generateLink en erreur ou exception : signalé sans email, jamais d'exception", async () => {
    sim.generateLink.mockResolvedValueOnce({ data: null, error: { code: "unexpected_failure", status: 500 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    await apresLaReponse();
    sim.generateLink.mockRejectedValueOnce(new Error(`panne ${ABRAHAM}`));
    await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    await expect(apresLaReponse()).resolves.toBeUndefined();
    expect(sim.envoyer).not.toHaveBeenCalled();
    expect(sim.captureMessage).toHaveBeenCalledTimes(2);
    expect(sim.captureMessage.mock.calls.map(([m]) => String(m)).join(" ")).not.toMatch(/abraham/i);
  });

  it("NEXT_PUBLIC_SITE_URL absente : aucun lien, signalé", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await demanderLienMotDePasse(ETAT_DEMANDE_LIEN_INITIAL, formulaire({ email: ABRAHAM }));
    await apresLaReponse();
    expect(sim.generateLink).not.toHaveBeenCalled();
    expect(sim.captureMessage).toHaveBeenCalled();
  });
});

// --- Lien généré par l'administrateur ----------------------------------------------

describe("genererLienMotDePasse", () => {
  beforeEach(() => {
    sim.rpcSession.mockImplementation(async (fonction: string) => {
      sim.ordre.push(fonction);
      return { data: { id: MEMBRE_ID, nom: "Léo Martin", email: "leo@example.com" }, error: null };
    });
  });

  it("collaborateur : ACCES_REFUSE, rien noté ni généré", async () => {
    sim.profil = COLLABORATEUR;
    const r = await genererLienMotDePasse(MEMBRE_ID);
    expect(r).toEqual({ ok: false, code: "ACCES_REFUSE", message: messageErreur("ACCES_REFUSE") });
    expect(sim.rpcSession).not.toHaveBeenCalled();
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("visiteur sans session : ACCES_REFUSE", async () => {
    sim.profil = { ok: true, donnees: null };
    expect((await genererLienMotDePasse(MEMBRE_ID)).ok).toBe(false);
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("identifiant invalide : DONNEES_INVALIDES", async () => {
    const r = await genererLienMotDePasse("pas-un-uuid");
    expect(r.ok === false && r.code).toBe("DONNEES_INVALIDES");
    expect(sim.rpcSession).not.toHaveBeenCalled();
  });

  it("membre actif : noter_lien_mot_de_passe puis generateLink (recovery) ; lien affiché", async () => {
    const r = await genererLienMotDePasse(MEMBRE_ID);
    expect(r).toEqual({ ok: true, donnees: { nom: "Léo Martin", lien: LIEN } });
    expect(sim.ordre).toEqual(["noter_lien_mot_de_passe", "generateLink"]);
    expect(sim.rpcSession).toHaveBeenCalledWith("noter_lien_mot_de_passe", { p_id: MEMBRE_ID });
    expect(sim.generateLink).toHaveBeenCalledWith({ type: "recovery", email: "leo@example.com" });
  });

  it.each([
    ["ETAT_COMPTE_INVALIDE", "ETAT_COMPTE_INVALIDE"],
    ["DROIT_INSUFFISANT", "ACCES_REFUSE"],
  ])("la base refuse (%s) : %s, aucun lien généré", async (code, attendu) => {
    sim.rpcSession.mockResolvedValue({ data: null, error: { code: "P0001", message: code } });
    const r = await genererLienMotDePasse(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe(attendu);
    expect(sim.generateLink).not.toHaveBeenCalled();
  });

  it("generateLink en erreur : ERREUR_INATTENDUE, signalé sans email", async () => {
    sim.generateLink.mockResolvedValue({ data: null, error: { code: "unexpected_failure", status: 500 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await genererLienMotDePasse(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ERREUR_INATTENDUE");
    expect(sim.captureMessage.mock.calls.map(([m]) => String(m)).join(" ")).not.toMatch(/leo/i);
  });

  it("NEXT_PUBLIC_SITE_URL absente : refus avant toute écriture au journal", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await genererLienMotDePasse(MEMBRE_ID);
    expect(r.ok === false && r.code).toBe("ADRESSE_SITE_MANQUANTE");
    expect(sim.rpcSession).not.toHaveBeenCalled();
  });
});

// --- /auth/confirmer en version réinitialisation -----------------------------------

describe("confirmerLien (recovery)", () => {
  it("lien valide : verifyOtp recovery, puis /nouveau-mot-de-passe", async () => {
    sim.verifyOtp.mockResolvedValue({ data: {}, error: null });
    await expect(
      confirmerLien(ETAT_CONFIRMATION_INITIAL, formulaire({ token_hash: JETON, type: "recovery" })),
    ).rejects.toThrow("NEXT_REDIRECT:/nouveau-mot-de-passe");
    expect(sim.verifyOtp).toHaveBeenCalledWith({ token_hash: JETON, type: "recovery" });
  });

  it("lien expiré, remplacé ou déjà utilisé : « Ce lien n'est plus valable. », lien refusé", async () => {
    sim.verifyOtp.mockResolvedValue({ data: {}, error: { code: "otp_expired", status: 403 } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const etat = await confirmerLien(
      ETAT_CONFIRMATION_INITIAL,
      formulaire({ token_hash: JETON, type: "recovery" }),
    );
    expect(etat).toEqual({ erreur: "Ce lien n'est plus valable.", lienRefuse: true, tentative: 1 });
  });

  it("lien mal formé : refusé sans appel à Auth, avec le message de réinitialisation", async () => {
    const etat = await confirmerLien(
      ETAT_CONFIRMATION_INITIAL,
      formulaire({ token_hash: "court", type: "recovery" }),
    );
    expect(etat.erreur).toBe(messageErreur("LIEN_REINITIALISATION_INVALIDE"));
    expect(etat.lienRefuse).toBe(true);
    expect(sim.verifyOtp).not.toHaveBeenCalled();
  });

  it("invitation refusée : garde « … Contactez votre administrateur. »", async () => {
    sim.verifyOtp.mockResolvedValue({ data: {}, error: { code: "otp_expired", status: 403 } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const etat = await confirmerLien(
      ETAT_CONFIRMATION_INITIAL,
      formulaire({ token_hash: JETON, type: "invite" }),
    );
    expect(etat.erreur).toBe("Ce lien n'est plus valable. Contactez votre administrateur.");
    expect(etat.lienRefuse).toBe(true);
  });

  it("panne d'Auth : erreur serveur, le lien n'est pas déclaré refusé", async () => {
    sim.verifyOtp.mockResolvedValue({ data: {}, error: { code: "x", status: 503 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const etat = await confirmerLien(
      ETAT_CONFIRMATION_INITIAL,
      formulaire({ token_hash: JETON, type: "recovery" }),
    );
    expect(etat.erreur).toBe(messageErreur("ERREUR_INATTENDUE"));
    expect(etat.lienRefuse).toBeUndefined();
  });
});

// --- Nouveau mot de passe après un lien --------------------------------------------

describe("choisirMotDePasse (réinitialisation)", () => {
  const BON = {
    mot_de_passe: "un-nouveau-mot-de-passe",
    confirmation: "un-nouveau-mot-de-passe",
    parcours: "reinitialisation",
  };
  const ACTIF = { nom: "Léo Martin", role: "collaborateur", etat: "actif" };

  /** Horodatage `amr` (secondes) il y a `minutes` minutes. */
  const ilYa = (minutes: number) => Math.floor(Date.now() / 1000) - minutes * 60;

  function session(amr: { method: string; timestamp: number }[]) {
    sim.getClaims.mockResolvedValue({ data: { claims: { sub: MEMBRE_ID, amr } }, error: null });
  }

  beforeEach(() => {
    session([{ method: "otp", timestamp: ilYa(1) }]);
    sim.updateUser.mockResolvedValue({ data: {}, error: null });
    sim.rpcSession.mockImplementation(async (fonction: string) => {
      if (fonction === "mon_profil") return { data: ACTIF, error: null };
      return { data: null, error: null };
    });
  });

  it("membre actif, session venue du lien : mot de passe mis à jour, puis /equipe (sans activation)", async () => {
    await expect(choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON))).rejects.toThrow(
      "NEXT_REDIRECT:/equipe",
    );
    expect(sim.updateUser).toHaveBeenCalledWith({ password: BON.mot_de_passe });
    expect(sim.rpcSession).not.toHaveBeenCalledWith("activer_mon_compte", undefined);
    expect(sim.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(sim.signOut.mock.invocationCallOrder[0]).toBeGreaterThan(
      sim.updateUser.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["erreur", async () => ({ error: { code: "unexpected_failure", status: 500 } })],
    ["exception", async () => Promise.reject(new Error("panne"))],
  ])("fermeture des autres sessions en %s : signalée, /equipe quand même", async (_cas, reponse) => {
    sim.signOut.mockImplementation(reponse);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON))).rejects.toThrow(
      "NEXT_REDIRECT:/equipe",
    );
    const messages = sim.captureMessage.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes("autres sessions non fermées"))).toBe(true);
  });

  it("refus (session par mot de passe) : aucune session fermée", async () => {
    session([{ method: "password", timestamp: ilYa(1) }]);
    await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(sim.signOut).not.toHaveBeenCalled();
  });

  it("connexion par lien plus récente qu'une connexion par mot de passe : permis", async () => {
    session([
      { method: "password", timestamp: ilYa(30) },
      { method: "otp", timestamp: ilYa(2) },
    ]);
    await expect(choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON))).rejects.toThrow(
      "NEXT_REDIRECT:/equipe",
    );
    expect(sim.updateUser).toHaveBeenCalled();
  });

  it.each([
    ["mot de passe seul", [{ method: "password", timestamp: ilYa(1) }]],
    [
      "mot de passe plus récent que le lien",
      [
        { method: "otp", timestamp: ilYa(5) },
        { method: "password", timestamp: ilYa(1) },
      ],
    ],
    ["amr absent", []],
    ["lien ouvert il y a plus d'une heure", [{ method: "otp", timestamp: ilYa(61) }]],
    ["méthode hors liste (totp)", [{ method: "totp", timestamp: ilYa(1) }]],
  ])("session ouverte par %s : « Ce lien n'est plus valable. », rien changé", async (_cas, amr) => {
    session(amr);
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale).toEqual({
      type: "lien",
      message: messageErreur("LIEN_REINITIALISATION_INVALIDE"),
    });
    expect(sim.updateUser).not.toHaveBeenCalled();
  });

  it("parcours invitation, compte ni invité ni actif : « … Contactez votre administrateur. »", async () => {
    sim.rpcSession.mockResolvedValue({ data: null, error: null });
    const etat = await choisirMotDePasse(
      ETAT_MOT_DE_PASSE_INITIAL,
      formulaire({ ...BON, parcours: "invitation" }),
    );
    expect(etat.erreurGenerale).toEqual({ type: "lien", message: messageErreur("LIEN_INVALIDE") });
    expect(sim.updateUser).not.toHaveBeenCalled();
  });

  it("compte désactivé (mon_profil nul) : lien plus valable, rien changé", async () => {
    sim.rpcSession.mockResolvedValue({ data: null, error: null });
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale?.type).toBe("lien");
    expect(sim.updateUser).not.toHaveBeenCalled();
  });

  it("session perdue sur la page de réinitialisation : « Ce lien n'est plus valable. »", async () => {
    sim.getClaims.mockResolvedValue({ data: null, error: null });
    const etat = await choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON));
    expect(etat.erreurGenerale?.message).toBe(messageErreur("LIEN_REINITIALISATION_INVALIDE"));
  });

  it("même mot de passe qu'avant (same_password) : accepté, /equipe", async () => {
    sim.updateUser.mockResolvedValue({ data: null, error: { code: "same_password", status: 422 } });
    await expect(choisirMotDePasse(ETAT_MOT_DE_PASSE_INITIAL, formulaire(BON))).rejects.toThrow(
      "NEXT_REDIRECT:/equipe",
    );
  });
});
