import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 5.2 — actions `ajouterCategorie`, `renommerCategorie`,
// `desactiverCategorie`, `reactiverCategorie` (lib/actions/categories.ts),
// sans base : profil et client de session simulés. Refus du collaborateur
// (rien n'est appelé), Zod (nom vide, trop long, espaces retirés), codes de
// la base (nom pris, pris par une catégorie désactivée, dernière catégorie
// active, état déjà atteint, droit perdu), rafraîchissement de la page
// Catégories et du formulaire public.

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

import {
  ajouterCategorie,
  desactiverCategorie,
  reactiverCategorie,
  renommerCategorie,
} from "@/lib/actions/categories";
import { messageErreur } from "@/lib/erreurs";
import { MESSAGES_CATEGORIE } from "@/lib/schemas/categorie";

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
const ID = "22222222-2222-4222-8222-222222222222";

function erreurPrevue(code: string, details?: string) {
  return { data: null, error: { code: "P0001", message: code, details: details ?? null } };
}

beforeEach(() => {
  sim.profil = ADMIN;
  sim.rpc.mockImplementation(async (fonction: string) => {
    if (fonction === "ajouter_categorie")
      return { data: { id: ID, nom: "Formation", actif: true, ordre: 6 }, error: null };
    if (fonction === "renommer_categorie") return { data: { id: ID, modifie: true }, error: null };
    if (fonction === "desactiver_categorie") return { data: { id: ID, actif: false }, error: null };
    if (fonction === "activer_categorie") return { data: { id: ID, actif: true }, error: null };
    return { data: null, error: { code: "42883", message: "inconnue" } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  sim.rpc.mockReset();
});

const REFUS_ACCES = { ok: false, code: "ACCES_REFUSE", message: messageErreur("ACCES_REFUSE") };

describe("collaborateur ou visiteur : refus, rien n'est appelé", () => {
  it.each([
    ["collaborateur", () => COLLABORATEUR],
    ["visiteur", () => ({ ok: true, donnees: null })],
  ])("%s", async (_nom, profil) => {
    sim.profil = profil();
    for (const resultat of [
      await ajouterCategorie("Formation"),
      await renommerCategorie(ID, "Formation"),
      await desactiverCategorie(ID),
      await reactiverCategorie(ID),
    ]) {
      expect(resultat).toEqual(REFUS_ACCES);
    }
    expect(sim.rpc).not.toHaveBeenCalled();
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("profil illisible : ERREUR_INATTENDUE, rien n'est appelé", async () => {
    sim.profil = { ok: false, code: "ERREUR_INATTENDUE", message: "x" };
    expect((await ajouterCategorie("Formation")).ok).toBe(false);
    expect(sim.rpc).not.toHaveBeenCalled();
  });
});

describe("ajouterCategorie", () => {
  it("nom sans espaces aux extrémités, session, puis page Catégories et formulaire public rafraîchis", async () => {
    const resultat = await ajouterCategorie("  Formation \n");
    expect(resultat).toEqual({ ok: true, donnees: { id: ID, nom: "Formation", modifie: true } });
    expect(sim.rpc).toHaveBeenCalledWith("ajouter_categorie", { p_nom: "Formation" });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/categories");
    expect(sim.revalidatePath).toHaveBeenCalledWith("/");
  });

  it.each([
    ["vide", "   ", MESSAGES_CATEGORIE.nomRequis],
    ["trop long", "é".repeat(81), MESSAGES_CATEGORIE.nomTropLong],
    ["absent", undefined, MESSAGES_CATEGORIE.nomRequis],
  ])("nom %s : erreur sous le champ, aucun appel", async (_cas, nom, message) => {
    const resultat = await ajouterCategorie(nom);
    expect(resultat).toMatchObject({ ok: false, code: "DONNEES_INVALIDES", erreurNom: message });
    expect(sim.rpc).not.toHaveBeenCalled();
  });

  it("réponse sans identifiant : ERREUR_INATTENDUE, signalée", async () => {
    sim.rpc.mockResolvedValue({ data: { nom: "Formation" }, error: null });
    expect(await ajouterCategorie("Formation")).toEqual({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: messageErreur("ERREUR_INATTENDUE"),
    });
    expect(sim.captureMessage).toHaveBeenCalledWith(expect.stringContaining("[ajouterCategorie]"), "error");
  });

  it("nom fait seulement de ponctuation : nom requis, aucun appel", async () => {
    for (const nom of ["-", "'", " ‐ ’ "]) {
      expect(await ajouterCategorie(nom), nom).toMatchObject({ erreurNom: MESSAGES_CATEGORIE.nomRequis });
    }
    expect(sim.rpc).not.toHaveBeenCalled();
  });

  it("80 caractères accentués : accepté", async () => {
    expect((await ajouterCategorie("é".repeat(80))).ok).toBe(true);
  });

  it("NOM_CATEGORIE_PRIS : « Ce nom est déjà pris. » sous le champ", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("NOM_CATEGORIE_PRIS", '{"desactivee": false}'));
    const resultat = await ajouterCategorie("formation");
    expect(resultat).toEqual({
      ok: false,
      code: "NOM_CATEGORIE_PRIS",
      message: "Ce nom est déjà pris.",
      erreurNom: "Ce nom est déjà pris.",
    });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("NOM_CATEGORIE_PRIS par une catégorie désactivée : « réactivez-la » sous le champ", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("NOM_CATEGORIE_PRIS", '{"desactivee": true}'));
    const resultat = await ajouterCategorie("Formatión");
    expect(resultat).toMatchObject({
      ok: false,
      code: "NOM_CATEGORIE_PRIS",
      erreurNom: "Une catégorie désactivée porte déjà ce nom : réactivez-la.",
    });
    // Le détail interne ne part jamais au navigateur.
    expect(resultat).not.toHaveProperty("detail");
  });

  it("DROIT_INSUFFISANT de la base : ACCES_REFUSE, en bandeau", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("DROIT_INSUFFISANT"));
    expect(await ajouterCategorie("Formation")).toEqual(REFUS_ACCES);
  });

  it("erreur imprévue : ERREUR_INATTENDUE", async () => {
    sim.rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "délai" } });
    expect(await ajouterCategorie("Formation")).toEqual({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: messageErreur("ERREUR_INATTENDUE"),
    });
  });
});

describe("renommerCategorie", () => {
  it("appelle renommer_categorie avec la session, puis rafraîchit", async () => {
    const resultat = await renommerCategorie(ID, " Formations ");
    expect(resultat).toEqual({ ok: true, donnees: { id: ID, nom: "Formations", modifie: true } });
    expect(sim.rpc).toHaveBeenCalledWith("renommer_categorie", { p_id: ID, p_nom: "Formations" });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/categories");
    expect(sim.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("nom inchangé (modifie: false) : réussite sans changement, rien n'est rafraîchi", async () => {
    sim.rpc.mockResolvedValue({ data: { id: ID, nom: "Formation", modifie: false }, error: null });
    expect(await renommerCategorie(ID, "Formation")).toEqual({
      ok: true,
      donnees: { id: ID, nom: "Formation", modifie: false },
    });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("identifiant invalide : DONNEES_INVALIDES, aucun appel", async () => {
    expect(await renommerCategorie("pas-un-uuid", "Formation")).toMatchObject({
      ok: false,
      code: "DONNEES_INVALIDES",
    });
    expect(sim.rpc).not.toHaveBeenCalled();
  });

  it("NOM_CATEGORIE_PRIS : sous le champ", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("NOM_CATEGORIE_PRIS", '{"desactivee": false}'));
    expect(await renommerCategorie(ID, "Autre")).toMatchObject({ erreurNom: "Ce nom est déjà pris." });
  });

  it("DONNEES_INVALIDES de la base (catégorie disparue) : état périmé en bandeau, liste rafraîchie", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("DONNEES_INVALIDES"));
    const resultat = await renommerCategorie(ID, "Autre");
    expect(resultat).toEqual({
      ok: false,
      code: "ETAT_CATEGORIE_INVALIDE",
      message: messageErreur("ETAT_CATEGORIE_INVALIDE"),
    });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/categories");
  });

  it("DONNEES_INVALIDES de la base à l'ajout : sous le champ", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("DONNEES_INVALIDES"));
    expect(await ajouterCategorie("Autre")).toMatchObject({
      code: "DONNEES_INVALIDES",
      erreurNom: messageErreur("DONNEES_INVALIDES"),
    });
  });
});

describe("desactiverCategorie et reactiverCategorie", () => {
  it("désactiver : desactiver_categorie avec la session, puis rafraîchit", async () => {
    expect(await desactiverCategorie(ID)).toEqual({ ok: true, donnees: null });
    expect(sim.rpc).toHaveBeenCalledWith("desactiver_categorie", { p_id: ID });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("dernière catégorie active : « Il doit rester au moins une catégorie active. »", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("DERNIERE_CATEGORIE"));
    expect(await desactiverCategorie(ID)).toEqual({
      ok: false,
      code: "DERNIERE_CATEGORIE",
      message: "Il doit rester au moins une catégorie active.",
    });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("réactiver : activer_categorie avec la session, puis rafraîchit", async () => {
    expect(await reactiverCategorie(ID)).toEqual({ ok: true, donnees: null });
    expect(sim.rpc).toHaveBeenCalledWith("activer_categorie", { p_id: ID });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/categories");
  });

  it("ETAT_CATEGORIE_INVALIDE : la liste est rafraîchie pour montrer le vrai état", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("ETAT_CATEGORIE_INVALIDE"));
    expect(await reactiverCategorie(ID)).toMatchObject({ ok: false, code: "ETAT_CATEGORIE_INVALIDE" });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/categories");
  });

  it("catégorie disparue (DONNEES_INVALIDES de la base) : ETAT_CATEGORIE_INVALIDE, liste rafraîchie", async () => {
    sim.rpc.mockResolvedValue(erreurPrevue("DONNEES_INVALIDES"));
    expect(await desactiverCategorie(ID)).toMatchObject({ code: "ETAT_CATEGORIE_INVALIDE" });
    expect(await reactiverCategorie(ID)).toMatchObject({ code: "ETAT_CATEGORIE_INVALIDE" });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/categories");
  });

  it("identifiant invalide : DONNEES_INVALIDES, aucun appel", async () => {
    expect(await desactiverCategorie(42)).toMatchObject({ code: "DONNEES_INVALIDES" });
    expect(await reactiverCategorie(null)).toMatchObject({ code: "DONNEES_INVALIDES" });
    expect(sim.rpc).not.toHaveBeenCalled();
  });
});
