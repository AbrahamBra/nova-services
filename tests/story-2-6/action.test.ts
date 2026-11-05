import { afterEach, describe, expect, it, vi } from "vitest";

// Story 2.6 — action serveur `saisir` et schéma partagé `lib/schemas/saisie.ts`,
// avec des clients Supabase simulés (la base réelle est testée dans
// saisie.test.ts) : session pour `saisir_demande` (jamais la clé secrète),
// email de confirmation seulement si une adresse est renseignée (envoyé,
// mode démonstration, échec), `noter_resultat_email` avec la clé secrète
// comme `deposer`, erreurs sous les champs ou en bandeau, saisie jamais
// annulée par l'email. Aucun appel réel à Resend.

const simulation = vi.hoisted(() => ({
  // Client porteur de la session du membre.
  rpcSession: null as null | ((fonction: string, parametres?: Record<string, unknown>) => unknown),
  // Client avec la clé secrète (notation du résultat de l'email).
  rpcService: null as null | ((fonction: string, parametres?: Record<string, unknown>) => unknown),
  envois: [] as Record<string, unknown>[],
  reponseResend: null as null | (() => Promise<unknown>),
  rafraichissements: 0,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: Record<string, unknown>) => {
        simulation.envois.push(payload);
        return simulation.reponseResend
          ? simulation.reponseResend()
          : Promise.resolve({ data: { id: "email-simule" }, error: null, headers: null });
      },
    };
  },
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => {
    if (!simulation.rpcSession) throw new Error("variables d'environnement manquantes");
    return { rpc: simulation.rpcSession };
  },
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => {
    if (!simulation.rpcService) throw new Error("variables d'environnement manquantes");
    return { rpc: simulation.rpcService };
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
}));

import { saisir } from "@/lib/actions/demandes";
import { messageErreur } from "@/lib/erreurs";
import {
  ETAT_SAISIE_INITIAL,
  MESSAGES_SAISIE,
  RAPPEL_DONNEES,
  lireSaisie,
  messageSaisieEnregistree,
  premierChampSaisieEnErreur,
  verifierSaisie,
} from "@/lib/schemas/saisie";

const CATEGORIE = "6f1c2b0e-3d4a-4b5c-8d9e-0a1b2c3d4e5f";
const CLE = "0b8f5c3e-1a2b-4c3d-9e4f-5a6b7c8d9e0f";
const DEMANDE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const REFERENCE = "NOVA-2026-0043";

function formulaire(modifs: Record<string, string | null> = {}): FormData {
  const valeurs: Record<string, string | null> = {
    cle_envoi: CLE,
    canal: "telephone",
    nom: "TEST-M. Lambert",
    email: "",
    telephone: "06 12 34 56 78",
    societe: "",
    categorie_id: CATEGORIE,
    objet: "Demande de rendez-vous",
    description: "Souhaite un rendez-vous.",
    ...modifs,
  };
  const donnees = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    if (valeur !== null) donnees.set(cle, valeur);
  }
  return donnees;
}

type Appel = { client: "session" | "service"; fonction: string; parametres?: Record<string, unknown> };

/** Réponse de `saisir_demande` (migration 0020). */
function reponseSaisie(modifs: Record<string, unknown> = {}) {
  return {
    reference: REFERENCE,
    id: DEMANDE_ID,
    objet: "Demande de rendez-vous",
    cree_le: "2026-11-05T08:12:00+00:00",
    nom_affiche: "Nova Services",
    email_contact: "contact@nova-services.example",
    nouvelle: true,
    etat_email: "sans_email",
    ...modifs,
  };
}

/** Base simulée : `saisir_demande` répond `reponse`, la notation réussit. */
function base(reponse: { data?: unknown; error?: unknown }): Appel[] {
  const appels: Appel[] = [];
  simulation.rpcSession = (fonction, parametres) => {
    appels.push({ client: "session", fonction, parametres });
    return Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null });
  };
  simulation.rpcService = (fonction, parametres) => {
    appels.push({ client: "service", fonction, parametres });
    return Promise.resolve({ data: null, error: null });
  };
  return appels;
}

function erreurPrevue(code: string) {
  return { error: { code: "P0001", message: code, details: null } };
}

afterEach(() => {
  simulation.rpcSession = null;
  simulation.rpcService = null;
  simulation.envois = [];
  simulation.reponseResend = null;
  simulation.rafraichissements = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("schéma de la saisie (partagé écran / action)", () => {
  it("canal absent ou « formulaire » : « Choisissez le canal. »", () => {
    for (const canal of ["", "formulaire", "fax"]) {
      const v = verifierSaisie(lireSaisie(formulaire({ canal })));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.erreurs.canal).toBe(MESSAGES_SAISIE.canal);
    }
  });

  it("ni email ni téléphone : message sous Email, avec les autres erreurs", () => {
    const v = verifierSaisie(
      lireSaisie(formulaire({ canal: "", email: " ", telephone: "", objet: "" })),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.erreurs).toEqual({
        canal: MESSAGES_SAISIE.canal,
        email: "Indiquez au moins un email ou un téléphone.",
        objet: MESSAGES_SAISIE.objetVide,
      });
      expect(premierChampSaisieEnErreur(v.erreurs)).toBe("canal");
    }
  });

  it("email seul (sans téléphone) accepté, en minuscules ; téléphone seul accepté", () => {
    const email = verifierSaisie(
      lireSaisie(formulaire({ canal: "email", email: " M.Lambert@Example.COM ", telephone: "" })),
    );
    expect(email).toMatchObject({
      ok: true,
      donnees: { canal: "email", email: "m.lambert@example.com", telephone: null, societe: null },
    });
    const telephone = verifierSaisie(lireSaisie(formulaire()));
    expect(telephone).toMatchObject({ ok: true, donnees: { email: null, telephone: "06 12 34 56 78" } });
  });

  it("email mal formé : « Cette adresse email ne semble pas valide. »", () => {
    const v = verifierSaisie(lireSaisie(formulaire({ email: "lambert@" })));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.erreurs.email).toBe(MESSAGES_SAISIE.emailInvalide);
  });

  it("aucun champ de consentement ni champ piège : ignorés", () => {
    const donnees = formulaire({ consentement: "oui", site_web: "robot" });
    expect(Object.keys(lireSaisie(donnees)).sort()).toEqual(
      ["canal", "categorie_id", "cle_envoi", "description", "email", "nom", "objet", "societe", "telephone"],
    );
  });

  it("textes : rappel et toast", () => {
    expect(RAPPEL_DONNEES).toBe("Pensez à informer le demandeur de l'usage de ses données.");
    expect(messageSaisieEnregistree(REFERENCE)).toBe("Demande NOVA-2026-0043 enregistrée.");
  });
});

describe("action saisir", () => {
  it("téléphone sans email : saisir_demande avec la session, référence renvoyée, aucun email", async () => {
    const appels = base({ data: reponseSaisie() });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ nom: "  TEST-M. Lambert " }));
    expect(etat).toEqual({ erreurs: {}, erreurGenerale: null, tentative: 1, reference: REFERENCE });
    expect(appels).toEqual([
      {
        client: "session",
        fonction: "saisir_demande",
        parametres: {
          p_cle_envoi: CLE,
          p_canal: "telephone",
          p_nom: "TEST-M. Lambert",
          p_email: null,
          p_telephone: "06 12 34 56 78",
          p_societe: null,
          p_categorie_id: CATEGORIE,
          p_objet: "Demande de rendez-vous",
          p_description: "Souhaite un rendez-vous.",
        },
      },
    ]);
    expect(simulation.envois).toHaveLength(0);
  });

  it("email autorisé : envoi puis notation « envoye » avec la clé secrète", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "m.lambert@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = base({
      data: reponseSaisie({ etat_email: "en_attente", email: "m.lambert@example.com" }),
    });
    const etat = await saisir(
      ETAT_SAISIE_INITIAL,
      formulaire({ canal: "email", email: "M.Lambert@Example.com", telephone: "" }),
    );
    expect(etat.reference).toBe(REFERENCE);
    expect(simulation.envois).toHaveLength(1);
    expect(simulation.envois[0].to).toBe("M.Lambert@Example.com");
    expect(appels.map((a) => `${a.client}:${a.fonction}`)).toEqual([
      "session:saisir_demande",
      "service:noter_resultat_email",
    ]);
    expect(appels[0].parametres?.p_email).toBe("m.lambert@example.com");
    expect(appels[1].parametres).toEqual({
      p_demande_id: DEMANDE_ID,
      p_etat: "envoye",
      p_code_erreur: null,
    });
  });

  it("mode démonstration (adresse hors liste) : aucun envoi, notation « non_envoye_demo »", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = base({ data: reponseSaisie({ etat_email: "en_attente", email: "lambert@example.com" }) });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ email: "lambert@example.com" }));
    expect(etat.reference).toBe(REFERENCE);
    expect(simulation.envois).toHaveLength(0);
    expect(appels[1]).toEqual({
      client: "service",
      fonction: "noter_resultat_email",
      parametres: { p_demande_id: DEMANDE_ID, p_etat: "non_envoye_demo", p_code_erreur: null },
    });
  });

  it("échec de Resend : notation « echec », la saisie réussit quand même", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "*");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    simulation.reponseResend = () =>
      Promise.resolve({ data: null, error: { name: "invalid_api_key" }, headers: null });
    const appels = base({ data: reponseSaisie({ etat_email: "en_attente", email: "lambert@example.com" }) });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ email: "lambert@example.com" }));
    expect(etat).toMatchObject({ reference: REFERENCE, erreurGenerale: null });
    expect(appels[1].parametres).toEqual({
      p_demande_id: DEMANDE_ID,
      p_etat: "echec",
      p_code_erreur: "invalid_api_key",
    });
  });

  it("clé secrète indisponible : email non envoyé, la saisie réussit quand même", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "*");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    base({ data: reponseSaisie({ etat_email: "en_attente", email: "lambert@example.com" }) });
    simulation.rpcService = null;
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ email: "lambert@example.com" }));
    expect(etat.reference).toBe(REFERENCE);
    expect(simulation.envois).toHaveLength(0);
  });

  it("second envoi, email déjà noté : pas de second email", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "*");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = base({
      data: reponseSaisie({ nouvelle: false, etat_email: "envoye", email: "lambert@example.com" }),
    });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ email: "lambert@example.com" }));
    expect(etat.reference).toBe(REFERENCE);
    expect(simulation.envois).toHaveLength(0);
    expect(appels).toHaveLength(1);
  });

  it("saisie invalide : erreurs sous les champs, sans appel à la base", async () => {
    const appels = base({ data: reponseSaisie() });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ canal: "", telephone: "" }));
    expect(etat).toEqual({
      erreurs: { canal: MESSAGES_SAISIE.canal, email: MESSAGES_SAISIE.coordonnees },
      erreurGenerale: null,
      tentative: 1,
      reference: null,
    });
    expect(appels).toEqual([]);
  });

  it("clé d'envoi falsifiée : bandeau, sans appel à la base", async () => {
    const appels = base({ data: reponseSaisie() });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ cle_envoi: "abc" }));
    expect(etat.erreurGenerale).toBe(messageErreur("DONNEES_INVALIDES"));
    expect(appels).toEqual([]);
  });

  it.each<[string, { champ?: "email" | "categorie_id" }]>([
    ["COORDONNEES_REQUISES", { champ: "email" }],
    ["CATEGORIE_INVALIDE", { champ: "categorie_id" }],
    ["DROIT_INSUFFISANT", {}],
    ["DONNEES_INVALIDES", {}],
  ])("refus %s de la base : sous le champ ou en bandeau", async (code, { champ }) => {
    base(erreurPrevue(code));
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire());
    const message = messageErreur(code as Parameters<typeof messageErreur>[0]);
    expect(etat.reference).toBeNull();
    expect(simulation.rafraichissements).toBe(code === "DROIT_INSUFFISANT" ? 1 : 0);
    if (champ) {
      expect(etat.erreurs).toEqual({ [champ]: message });
      expect(etat.erreurGenerale).toBeNull();
    } else {
      expect(etat.erreurs).toEqual({});
      expect(etat.erreurGenerale).toBe(message);
    }
  });

  it("erreur imprévue ou session indisponible : bandeau « Le serveur ne répond pas… »", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    base({ error: { code: "XX000", message: "boum", details: null } });
    expect((await saisir(ETAT_SAISIE_INITIAL, formulaire())).erreurGenerale).toBe(
      messageErreur("ERREUR_INATTENDUE"),
    );
    simulation.rpcSession = null;
    expect((await saisir(ETAT_SAISIE_INITIAL, formulaire())).erreurGenerale).toBe(
      messageErreur("ERREUR_INATTENDUE"),
    );
  });

  it("réponse sans référence valide : bandeau, jamais de détail ouvert", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    base({ data: reponseSaisie({ reference: "abc" }) });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire());
    expect(etat).toMatchObject({ reference: null, erreurGenerale: messageErreur("ERREUR_INATTENDUE") });
  });

  it("second envoi, email encore en_attente : email renvoyé à l'adresse enregistrée et noté", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "*");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = base({
      data: reponseSaisie({ nouvelle: false, etat_email: "en_attente", email: "lambert@example.com" }),
    });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ email: "autre@example.com" }));
    expect(etat.reference).toBe(REFERENCE);
    expect(simulation.envois).toHaveLength(1);
    expect(simulation.envois[0].to).toBe("lambert@example.com");
    expect(appels.map((a) => `${a.client}:${a.fonction}`)).toEqual([
      "session:saisir_demande",
      "service:noter_resultat_email",
    ]);
    expect(appels[1].parametres).toMatchObject({ p_demande_id: DEMANDE_ID, p_etat: "envoye" });
  });

  it("second envoi avec l'email effacé du formulaire, email enregistré en_attente : envoyé quand même", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "*");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = base({
      data: reponseSaisie({ nouvelle: false, etat_email: "en_attente", email: "lambert@example.com" }),
    });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ email: "" }));
    expect(etat.reference).toBe(REFERENCE);
    expect(simulation.envois).toHaveLength(1);
    expect(simulation.envois[0].to).toBe("lambert@example.com");
    expect(appels[1]?.fonction).toBe("noter_resultat_email");
  });

  it("données de l'email absentes de la réponse : notation « echec » (donnees_absentes)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = base({ data: { reference: REFERENCE, id: DEMANDE_ID } });
    const etat = await saisir(ETAT_SAISIE_INITIAL, formulaire({ email: "lambert@example.com" }));
    expect(etat.reference).toBe(REFERENCE);
    expect(simulation.envois).toHaveLength(0);
    expect(appels[1]).toEqual({
      client: "service",
      fonction: "noter_resultat_email",
      parametres: { p_demande_id: DEMANDE_ID, p_etat: "echec", p_code_erreur: "donnees_absentes" },
    });
  });
});
