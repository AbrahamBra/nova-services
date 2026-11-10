import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 5.3 — action `modifierParametres` (lib/actions/parametres.ts), sans
// base : profil et client de session simulés. Refus du collaborateur (rien
// n'est appelé), Zod (email mal écrit, nom vide ou trop long, durée hors
// bornes : erreur sous le champ, rien n'est appelé), valeurs normalisées
// envoyées à la base, codes de la base, rafraîchissement de la page
// Paramètres et du formulaire public seulement si quelque chose a changé.

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

import { modifierParametres } from "@/lib/actions/parametres";
import { messageErreur } from "@/lib/erreurs";
import { MESSAGES_PARAMETRES } from "@/lib/schemas/parametres";

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

const SAISIE = {
  nom_affiche: "  Nova Services ",
  email_contact: " Accueil@Nova.Example ",
  duree_conservation_mois: "36",
};

function erreurPrevue(code: string) {
  return { data: null, error: { code: "P0001", message: code, details: null } };
}

let modifie = true;

beforeEach(() => {
  sim.profil = ADMIN;
  modifie = true;
  sim.rpc.mockImplementation(async (fonction: string, p: Record<string, unknown>) => {
    if (fonction === "modifier_parametres") {
      return {
        data: {
          nom_affiche: p.p_nom_affiche,
          email_contact: p.p_email_contact,
          duree_conservation_mois: p.p_duree_mois,
          modifie,
        },
        error: null,
      };
    }
    return { data: null, error: { code: "42883", message: "inconnue" } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  sim.rpc.mockReset();
});

describe("collaborateur ou visiteur : refus, rien n'est appelé", () => {
  it.each([
    ["collaborateur", () => COLLABORATEUR],
    ["visiteur", () => ({ ok: true, donnees: null })],
  ])("%s", async (_nom, profil) => {
    sim.profil = profil();
    expect(await modifierParametres(SAISIE)).toEqual({
      ok: false,
      code: "ACCES_REFUSE",
      message: messageErreur("ACCES_REFUSE"),
    });
    expect(sim.rpc).not.toHaveBeenCalled();
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("profil illisible : ERREUR_INATTENDUE", async () => {
    sim.profil = { ok: false, code: "ERREUR_INATTENDUE", message: "x" };
    expect((await modifierParametres(SAISIE)).ok).toBe(false);
    expect(sim.rpc).not.toHaveBeenCalled();
  });
});

describe("réussite", () => {
  it("valeurs normalisées envoyées à la base, page Paramètres et formulaire public rafraîchis", async () => {
    const resultat = await modifierParametres(SAISIE);
    expect(sim.rpc).toHaveBeenCalledWith("modifier_parametres", {
      p_nom_affiche: "Nova Services",
      p_email_contact: "accueil@nova.example",
      p_duree_mois: 36,
    });
    expect(resultat).toEqual({
      ok: true,
      donnees: {
        nomAffiche: "Nova Services",
        emailContact: "accueil@nova.example",
        dureeConservationMois: 36,
        modifie: true,
      },
    });
    expect(sim.revalidatePath).toHaveBeenCalledWith("/equipe/admin/parametres");
    expect(sim.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("rien de changé : réussite (le toast s'affiche), rien n'est rafraîchi", async () => {
    modifie = false;
    const resultat = await modifierParametres(SAISIE);
    expect(resultat).toMatchObject({ ok: true, donnees: { modifie: false } });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saisie refusée par Zod : erreur sous le champ, rien n'est appelé", () => {
  it.each([
    ["email mal écrit", { email_contact: "accueil@nova" }, "email_contact", MESSAGES_PARAMETRES.emailInvalide],
    ["email vide", { email_contact: "  " }, "email_contact", MESSAGES_PARAMETRES.emailVide],
    ["nom vide", { nom_affiche: "   " }, "nom_affiche", MESSAGES_PARAMETRES.nomVide],
    ["nom trop long", { nom_affiche: "x".repeat(151) }, "nom_affiche", MESSAGES_PARAMETRES.nomLong],
    ["durée 5", { duree_conservation_mois: "5" }, "duree_conservation_mois", MESSAGES_PARAMETRES.duree],
    ["durée 61", { duree_conservation_mois: "61" }, "duree_conservation_mois", MESSAGES_PARAMETRES.duree],
    ["durée vide", { duree_conservation_mois: "" }, "duree_conservation_mois", MESSAGES_PARAMETRES.duree],
    ["durée décimale", { duree_conservation_mois: "24.5" }, "duree_conservation_mois", MESSAGES_PARAMETRES.duree],
  ])("%s", async (_cas, changement, champ, message) => {
    const resultat = await modifierParametres({ ...SAISIE, ...changement });
    expect(resultat).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message: messageErreur("DONNEES_INVALIDES"),
      erreurs: { [champ]: message },
    });
    expect(sim.rpc).not.toHaveBeenCalled();
  });

  it("saisie qui n'est pas un objet : refusée", async () => {
    expect(await modifierParametres(null)).toMatchObject({ ok: false, code: "DONNEES_INVALIDES" });
    expect(sim.rpc).not.toHaveBeenCalled();
  });
});

describe("refus de la base", () => {
  it("DROIT_INSUFFISANT (plus administrateur) : ACCES_REFUSE, rien n'est rafraîchi", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DROIT_INSUFFISANT"));
    expect(await modifierParametres(SAISIE)).toEqual({
      ok: false,
      code: "ACCES_REFUSE",
      message: messageErreur("ACCES_REFUSE"),
    });
    expect(sim.revalidatePath).not.toHaveBeenCalled();
  });

  it("DONNEES_INVALIDES : bandeau (aucun champ)", async () => {
    sim.rpc.mockResolvedValueOnce(erreurPrevue("DONNEES_INVALIDES"));
    expect(await modifierParametres(SAISIE)).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message: messageErreur("DONNEES_INVALIDES"),
    });
  });

  it("réponse inattendue : ERREUR_INATTENDUE, signalée", async () => {
    sim.rpc.mockResolvedValueOnce({ data: { modifie: true }, error: null });
    expect(await modifierParametres(SAISIE)).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(sim.captureMessage).toHaveBeenCalled();
  });
});
