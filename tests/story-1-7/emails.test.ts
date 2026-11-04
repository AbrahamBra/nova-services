import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 1.7 — module d'envoi `lib/server/emails.ts` et branchement dans
// l'action `deposer`. Aucun appel réel à Resend : le paquet `resend` est
// remplacé par une simulation, et la plupart des tests passent un
// expéditeur simulé. La base est simulée aussi (la vraie est testée dans
// notation.test.ts).

const simulation = vi.hoisted(() => ({
  // Simulation du paquet `resend`.
  cles: [] as string[],
  envois: [] as { payload: Record<string, unknown>; options?: Record<string, unknown> }[],
  reponse: null as null | (() => Promise<unknown>),
  // Simulation du client Supabase de service.
  rpc: null as null | ((fonction: string, parametres?: Record<string, unknown>) => unknown),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        simulation.envois.push({ payload, options });
        return simulation.reponse
          ? simulation.reponse()
          : Promise.resolve({ data: { id: "email-simule" }, error: null, headers: null });
      },
    };
    constructor(cle: string) {
      simulation.cles.push(cle);
    }
  },
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
import { ETAT_DEPOT_INITIAL } from "@/lib/schemas/depot";
import {
  ADRESSE_EXPEDITEUR,
  DELAI_ENVOI_MS,
  contenuConfirmation,
  echapperHtml,
  enteteExpediteur,
  envoyerConfirmation,
  estAdresseAutorisee,
  expediteurResend,
  lireAdressesAutorisees,
  type Expediteur,
  type MessageEmail,
} from "@/lib/server/emails";

const DEMANDE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const JETON = "b".repeat(64);

const DONNEES = {
  demandeId: DEMANDE_ID,
  reference: "NOVA-2026-0042",
  objet: "Impression impossible",
  // 08:12 UTC = 09:12 à Paris (heure d'hiver).
  creeLe: "2026-11-03T08:12:00+00:00",
  nomAffiche: "Nova Services",
  emailContact: "contact@nova-services.example",
};

/** Expéditeur simulé qui garde les messages reçus. */
function expediteurSimule(resultat: Awaited<ReturnType<Expediteur>> = { ok: true }) {
  const messages: MessageEmail[] = [];
  const expediteur: Expediteur = async (message) => {
    messages.push(message);
    return resultat;
  };
  return { expediteur, messages };
}

beforeEach(() => {
  simulation.cles = [];
  simulation.envois = [];
  simulation.reponse = null;
  simulation.rpc = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("liste autorisée (EMAILS_AUTORISES)", () => {
  it("adresses séparées par des virgules, espaces et majuscules ignorés", () => {
    const liste = lireAdressesAutorisees(" Abraham@Example.com , autre@example.com,, ");
    expect([...liste]).toEqual(["abraham@example.com", "autre@example.com"]);
  });

  it("vide ou absente → aucune adresse autorisée", () => {
    expect(lireAdressesAutorisees(undefined).size).toBe(0);
    expect(lireAdressesAutorisees("").size).toBe(0);
    expect(estAdresseAutorisee("abraham@example.com", lireAdressesAutorisees(""))).toBe(false);
  });

  it("« * » → toutes les adresses (production avec un domaine vérifié)", () => {
    expect(estAdresseAutorisee("quiconque@example.org", lireAdressesAutorisees("*"))).toBe(true);
    expect(
      estAdresseAutorisee("quiconque@example.org", lireAdressesAutorisees(" * , a@b.fr")),
    ).toBe(true);
  });

  it("majuscules dans l'adresse → considérée comme autorisée", () => {
    const liste = lireAdressesAutorisees("abraham@example.com");
    expect(estAdresseAutorisee("Abraham@Example.COM", liste)).toBe(true);
    expect(estAdresseAutorisee("abraham@example.co", liste)).toBe(false);
  });
});

describe("contenu de l'email de confirmation", () => {
  it("objet, référence, objet de la demande, date à l'heure de Paris et contact", () => {
    const c = contenuConfirmation(DONNEES);
    expect(c.objet).toBe("Votre demande NOVA-2026-0042 a bien été enregistrée");
    for (const version of [c.texte, c.html]) {
      expect(version).toContain("NOVA-2026-0042");
      expect(version).toContain("Impression impossible");
      expect(version).toContain("03/11/2026 à 09:12");
      expect(version).toContain("Nova Services");
      expect(version).toContain("contact@nova-services.example");
    }
  });

  it("<b> dans l'objet → affiché comme du texte dans la version HTML", () => {
    const c = contenuConfirmation({
      ...DONNEES,
      objet: `<b>Urgent</b> & "vite" <script>alert('x')</script>`,
      nomAffiche: "Nova <Services>",
    });
    expect(c.html).not.toContain("<b>");
    expect(c.html).not.toContain("<script>");
    expect(c.html).toContain("&lt;b&gt;Urgent&lt;/b&gt; &amp; &quot;vite&quot;");
    expect(c.html).toContain("Nova &lt;Services&gt;");
    // La version texte garde le texte tel quel.
    expect(c.texte).toContain(`<b>Urgent</b> & "vite"`);
  });

  it("echapperHtml échappe les 5 caractères spéciaux", () => {
    expect(echapperHtml(`<a href="x">l'&</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;l&#39;&amp;&lt;/a&gt;",
    );
  });
});

describe("envoyerConfirmation (expéditeur simulé)", () => {
  it("adresse autorisée, envoi réussi → envoye, un message vers l'adresse", async () => {
    const { expediteur, messages } = expediteurSimule();
    const resultat = await envoyerConfirmation("Abraham@Example.com", DONNEES, {
      expediteur,
      adressesAutorisees: "abraham@example.com",
    });
    expect(resultat).toEqual({ etat: "envoye", code: null });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      // Adresse telle que saisie : la casse ne compte que pour la liste.
      a: "Abraham@Example.com",
      de: `"Nova Services" <${ADRESSE_EXPEDITEUR}>`,
      objet: "Votre demande NOVA-2026-0042 a bien été enregistrée",
      cleIdempotence: `confirmation-demande/${DEMANDE_ID}`,
    });
  });

  it("adresse non autorisée → non_envoye_demo, aucun envoi", async () => {
    const { expediteur, messages } = expediteurSimule();
    const resultat = await envoyerConfirmation("sophie@example.com", DONNEES, {
      expediteur,
      adressesAutorisees: "abraham@example.com",
    });
    expect(resultat).toEqual({ etat: "non_envoye_demo", code: null });
    expect(messages).toHaveLength(0);
  });

  it("liste vide → non_envoye_demo pour tout le monde", async () => {
    const { expediteur, messages } = expediteurSimule();
    const resultat = await envoyerConfirmation("abraham@example.com", DONNEES, {
      expediteur,
      adressesAutorisees: "",
    });
    expect(resultat.etat).toBe("non_envoye_demo");
    expect(messages).toHaveLength(0);
  });

  it("échec de l'expéditeur → echec avec son code", async () => {
    const { expediteur } = expediteurSimule({ ok: false, code: "rate_limit_exceeded" });
    const resultat = await envoyerConfirmation("abraham@example.com", DONNEES, {
      expediteur,
      adressesAutorisees: "abraham@example.com",
    });
    expect(resultat).toEqual({ etat: "echec", code: "rate_limit_exceeded" });
  });

  it("code d'erreur non conforme (pourrait contenir une adresse) → « inconnu »", async () => {
    const { expediteur } = expediteurSimule({ ok: false, code: "Refusé pour abraham@example.com" });
    const resultat = await envoyerConfirmation("abraham@example.com", DONNEES, {
      expediteur,
      adressesAutorisees: "abraham@example.com",
    });
    expect(resultat).toEqual({ etat: "echec", code: "inconnu" });
  });

  it("exception de l'expéditeur → echec, aucune exception ne remonte", async () => {
    const expediteur: Expediteur = () => Promise.reject(new Error("panne"));
    const resultat = await envoyerConfirmation("abraham@example.com", DONNEES, {
      expediteur,
      adressesAutorisees: "abraham@example.com",
    });
    expect(resultat).toEqual({ etat: "echec", code: "exception" });
  });

  it("EMAIL_EXPEDITEUR et EMAILS_AUTORISES=* (production) → expéditeur du domaine, toute adresse", async () => {
    vi.stubEnv("EMAIL_EXPEDITEUR", "contact@nova.example");
    vi.stubEnv("EMAILS_AUTORISES", "*");
    const { expediteur, messages } = expediteurSimule();
    const resultat = await envoyerConfirmation(" Client@Example.org ", DONNEES, { expediteur });
    expect(resultat.etat).toBe("envoye");
    expect(messages[0]).toMatchObject({
      a: "Client@Example.org",
      de: `"Nova Services" <contact@nova.example>`,
    });
  });

  it("EMAIL_EXPEDITEUR vide → onboarding@resend.dev", async () => {
    vi.stubEnv("EMAIL_EXPEDITEUR", "  ");
    const { expediteur, messages } = expediteurSimule();
    await envoyerConfirmation("abraham@example.com", DONNEES, {
      expediteur,
      adressesAutorisees: "abraham@example.com",
    });
    expect(messages[0].de).toBe(`"Nova Services" <onboarding@resend.dev>`);
  });

  it("lit EMAILS_AUTORISES dans l'environnement par défaut", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    const { expediteur, messages } = expediteurSimule();
    const resultat = await envoyerConfirmation("abraham@example.com", DONNEES, { expediteur });
    expect(resultat.etat).toBe("envoye");
    expect(messages).toHaveLength(1);
  });
});

describe("en-tête « From » (RFC 5322)", () => {
  it("nom entre guillemets : une virgule ne casse pas l'en-tête", () => {
    expect(enteteExpediteur("Nova, Services", ADRESSE_EXPEDITEUR)).toBe(
      `"Nova, Services" <onboarding@resend.dev>`,
    );
  });

  it("guillemets et barres obliques inverses échappés, retours à la ligne retirés", () => {
    expect(enteteExpediteur(String.raw`Nova "S" \ <x>` + "\r\nBcc: a@b.fr", "e@x.fr")).toBe(
      String.raw`"Nova \"S\" \\ <x> Bcc: a@b.fr" <e@x.fr>`,
    );
  });

  it("nom vide ou blanc → l'adresse seule", () => {
    expect(enteteExpediteur("", "e@x.fr")).toBe("e@x.fr");
    expect(enteteExpediteur("  \n ", "e@x.fr")).toBe("e@x.fr");
  });
});

describe("expéditeur Resend (paquet resend simulé)", () => {
  const MESSAGE: MessageEmail = {
    a: "abraham@example.com",
    de: `"Nova Services" <${ADRESSE_EXPEDITEUR}>`,
    objet: "Objet",
    texte: "Texte",
    html: "<p>Texte</p>",
    cleIdempotence: "confirmation-demande/1",
  };

  it("clé absente ou vide → échec cle_absente, Resend jamais créé ni appelé", async () => {
    for (const cle of [undefined, "", "   "]) {
      expect(await expediteurResend(cle)(MESSAGE)).toEqual({ ok: false, code: "cle_absente" });
    }
    expect(simulation.cles).toEqual([]);
    expect(simulation.envois).toEqual([]);
  });

  it("clé absente dans l'environnement → l'envoi échoue (comme un échec)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const resultat = await envoyerConfirmation("abraham@example.com", DONNEES, {
      adressesAutorisees: "abraham@example.com",
    });
    expect(resultat).toEqual({ etat: "echec", code: "cle_absente" });
    expect(simulation.envois).toEqual([]);
  });

  it("succès → expéditeur onboarding@resend.dev, texte, HTML et clé d'idempotence", async () => {
    expect(await expediteurResend("re_simulee")(MESSAGE)).toEqual({ ok: true });
    expect(simulation.cles).toEqual(["re_simulee"]);
    expect(simulation.envois).toEqual([
      {
        payload: {
          from: `"Nova Services" <onboarding@resend.dev>`,
          to: "abraham@example.com",
          subject: "Objet",
          text: "Texte",
          html: "<p>Texte</p>",
        },
        options: { idempotencyKey: "confirmation-demande/1" },
      },
    ]);
  });

  it("erreur de l'API → échec avec le nom de l'erreur, jamais son message", async () => {
    simulation.reponse = () =>
      Promise.resolve({
        data: null,
        error: { name: "validation_error", message: "abraham@example.com refusée", statusCode: 422 },
        headers: null,
      });
    expect(await expediteurResend("re_simulee")(MESSAGE)).toEqual({
      ok: false,
      code: "validation_error",
    });
  });

  it("exception réseau → échec « exception »", async () => {
    simulation.reponse = () => Promise.reject(new Error("réseau coupé"));
    expect(await expediteurResend("re_simulee")(MESSAGE)).toEqual({
      ok: false,
      code: "exception",
    });
  });

  it("délai dépassé (5 s par défaut) → échec « delai_depasse »", async () => {
    expect(DELAI_ENVOI_MS).toBe(5_000);
    vi.useFakeTimers();
    simulation.reponse = () => new Promise(() => {});
    const envoi = expediteurResend("re_simulee")(MESSAGE);
    await vi.advanceTimersByTimeAsync(DELAI_ENVOI_MS);
    expect(await envoi).toEqual({ ok: false, code: "delai_depasse" });
  });
});

describe("action deposer — email après l'enregistrement", () => {
  type Appel = { fonction: string; parametres?: Record<string, unknown> };

  function reponseDepot(modifs: Record<string, unknown> = {}) {
    return {
      reference: "NOVA-2026-0042",
      jeton: JETON,
      id: DEMANDE_ID,
      objet: "Impression impossible",
      cree_le: "2026-11-03T08:12:00+00:00",
      nom_affiche: "Nova Services",
      email_contact: "contact@nova-services.example",
      nouvelle: true,
      etat_email: "en_attente",
      ...modifs,
    };
  }

  function formulaire(email = "Abraham@Example.com"): FormData {
    const donnees = new FormData();
    for (const [cle, valeur] of Object.entries({
      cle_envoi: "0b8f5c3e-1a2b-4c3d-9e4f-5a6b7c8d9e0f",
      nom: "TEST-Sophie Garnier",
      email,
      telephone: "06 12 34 56 78",
      societe: "Atelier Garnier",
      categorie_id: "6f1c2b0e-3d4a-4b5c-8d9e-0a1b2c3d4e5f",
      objet: "Impression impossible",
      description: "Description secrète du demandeur.",
      consentement: "oui",
    })) {
      donnees.set(cle, valeur);
    }
    return donnees;
  }

  /** Base simulée : deposer_demande puis noter_resultat_email. */
  function baseSimulee(
    depot: Record<string, unknown> = reponseDepot(),
    notation: { data: unknown; error: unknown } = { data: null, error: null },
  ) {
    const appels: Appel[] = [];
    simulation.rpc = (fonction, parametres) => {
      appels.push({ fonction, parametres });
      if (fonction === "deposer_demande") return Promise.resolve({ data: depot, error: null });
      if (fonction === "noter_resultat_email") return Promise.resolve(notation);
      return Promise.resolve({ data: null, error: { code: "42883", message: "inconnue" } });
    };
    return appels;
  }

  const REDIRECTION = { message: "REDIRECTION", adresse: `/confirmation/${JETON}`, type: "replace" };

  it("adresse autorisée → enregistrement, envoi, notation « envoye », puis redirection", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = baseSimulee();

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);

    expect(appels.map((a) => a.fonction)).toEqual(["deposer_demande", "noter_resultat_email"]);
    expect(appels[1].parametres).toEqual({
      p_demande_id: DEMANDE_ID,
      p_etat: "envoye",
      p_code_erreur: null,
    });
    expect(simulation.envois).toHaveLength(1);
    const envoi = simulation.envois[0].payload;
    expect(envoi.to).toBe("Abraham@Example.com");
    // Jamais la description, le téléphone ni la société.
    for (const version of [envoi.text, envoi.html] as string[]) {
      expect(version).toContain("NOVA-2026-0042");
      expect(version).not.toContain("Description secrète");
      expect(version).not.toContain("06 12 34 56 78");
      expect(version).not.toContain("Atelier Garnier");
      expect(version).not.toContain("Sophie Garnier");
    }
  });

  it("adresse non autorisée → aucun appel à Resend, notation « non_envoye_demo »", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = baseSimulee();

    await expect(
      deposer(ETAT_DEPOT_INITIAL, formulaire("sophie@example.com")),
    ).rejects.toMatchObject(REDIRECTION);

    expect(simulation.envois).toHaveLength(0);
    expect(appels[1]).toEqual({
      fonction: "noter_resultat_email",
      parametres: { p_demande_id: DEMANDE_ID, p_etat: "non_envoye_demo", p_code_erreur: null },
    });
  });

  it("clé absente → notation « echec » (cle_absente), redirection inchangée", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "");
    const appels = baseSimulee();

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);

    expect(simulation.envois).toHaveLength(0);
    expect(appels[1].parametres).toEqual({
      p_demande_id: DEMANDE_ID,
      p_etat: "echec",
      p_code_erreur: "cle_absente",
    });
  });

  it("Resend en échec → notation « echec », trace sans l'adresse, redirection inchangée", async () => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    simulation.reponse = () =>
      Promise.resolve({
        data: null,
        error: { name: "internal_server_error", message: "abraham@example.com", statusCode: 500 },
        headers: null,
      });
    const appels = baseSimulee();

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);

    expect(appels[1].parametres).toMatchObject({
      p_etat: "echec",
      p_code_erreur: "internal_server_error",
    });
    const traces = erreurs.mock.calls.flat().join("\n");
    expect(traces).not.toContain("abraham@example.com");
  });

  it("notation refusée (double notation) → redirection inchangée", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "");
    baseSimulee(reponseDepot(), {
      data: null,
      error: { code: "P0001", message: "EMAIL_DEJA_NOTE" },
    });
    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);
  });

  it("notation en panne (exception) → redirection inchangée", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "");
    simulation.rpc = (fonction) =>
      fonction === "deposer_demande"
        ? Promise.resolve({ data: reponseDepot(), error: null })
        : Promise.reject(new Error("connexion perdue"));
    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);
  });

  it("second envoi de la même clé, email déjà noté → ni email ni notation", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = baseSimulee(reponseDepot({ nouvelle: false, etat_email: "envoye" }));

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);

    expect(appels.map((a) => a.fonction)).toEqual(["deposer_demande"]);
    expect(simulation.envois).toHaveLength(0);
  });

  it("second envoi de la même clé, email encore en_attente → envoyé (même clé d'idempotence) et noté", async () => {
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = baseSimulee(reponseDepot({ nouvelle: false, etat_email: "en_attente" }));

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);

    expect(appels.map((a) => a.fonction)).toEqual(["deposer_demande", "noter_resultat_email"]);
    expect(simulation.envois).toHaveLength(1);
    expect(simulation.envois[0].options).toEqual({
      idempotencyKey: `confirmation-demande/${DEMANDE_ID}`,
    });
  });

  it("envoi simultané refusé par Resend (concurrent_idempotent_requests) → pas de notation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    simulation.reponse = () =>
      Promise.resolve({
        data: null,
        error: { name: "concurrent_idempotent_requests", message: "x", statusCode: 409 },
        headers: null,
      });
    const appels = baseSimulee(reponseDepot({ nouvelle: false }));

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);

    expect(appels.map((a) => a.fonction)).toEqual(["deposer_demande"]);
  });

  it("réponse sans les données de l'email → dépôt confirmé, noté « echec » (donnees_absentes)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAILS_AUTORISES", "abraham@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_simulee");
    const appels = baseSimulee({ reference: "NOVA-2026-0042", jeton: JETON, id: DEMANDE_ID });

    await expect(deposer(ETAT_DEPOT_INITIAL, formulaire())).rejects.toMatchObject(REDIRECTION);

    expect(simulation.envois).toHaveLength(0);
    expect(appels[1]).toEqual({
      fonction: "noter_resultat_email",
      parametres: { p_demande_id: DEMANDE_ID, p_etat: "echec", p_code_erreur: "donnees_absentes" },
    });
  });
});
