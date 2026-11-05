import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Story 2.3 — actions serveur `changerStatut` et `classerSansSuite` avec un
// client Supabase simulé (la base réelle est testée dans statuts.test.ts) :
// session (jamais la clé secrète), schémas partagés avec l'écran (AD-8),
// refus sans appel, résultat sans `detail`, rafraîchissement du détail.
// Et : phrases de l'historique, messages des toasts, boutons de la partie
// « Statut » selon le statut.

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
}));

import { changerStatut, classerSansSuite } from "@/lib/actions/demandes";
import {
  ActionsStatut,
  LIBELLE_RAISON_CLASSEMENT,
  MESSAGES_STATUT,
  TEXTE_FENETRE_CLASSEMENT,
  messageReussiteStatut,
} from "@/components/nova/actions-demande";
import { phraseLigneHistorique } from "@/components/nova/historique";
import { FournisseurToasts } from "@/components/nova/toasts";
import type { LigneHistorique } from "@/lib/detail-demande";
import type { Statut } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { ESPACE_INSECABLE } from "@/lib/format";
import {
  MESSAGES_CLASSEMENT,
  schemaStatutDemande,
  verifierRaisonClassement,
} from "@/lib/schemas/traitement";

const DEMANDE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";

afterEach(() => {
  simulation.rpc = null;
  simulation.rafraichissements = 0;
  simulation.clientService = 0;
  vi.restoreAllMocks();
});

function base(reponse: { data?: unknown; error?: unknown }) {
  const appels: { fonction: string; parametres?: Record<string, unknown> }[] = [];
  simulation.rpc = (fonction, parametres) => {
    appels.push({ fonction, parametres });
    return Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null });
  };
  return appels;
}

describe("schémas", () => {
  it("statut demandé : en_cours ou traitee seulement", () => {
    expect(schemaStatutDemande.safeParse("traitee").success).toBe(true);
    expect(schemaStatutDemande.safeParse("en_cours").success).toBe(true);
    for (const valeur of ["nouvelle", "fermee", "", null, 1]) {
      expect(schemaStatutDemande.safeParse(valeur).success, String(valeur)).toBe(false);
    }
  });

  it("raison du classement : même règle que la note, messages propres", () => {
    expect(verifierRaisonClassement("  Spam \n")).toEqual({ ok: true, texte: "Spam" });
    for (const vide of ["", "  \n", "\u00a0\u3000\ufeff", undefined, 42]) {
      expect(verifierRaisonClassement(vide)).toEqual({
        ok: false,
        message: "Écrivez la raison du classement.",
      });
    }
    expect(verifierRaisonClassement("a".repeat(2001))).toEqual({
      ok: false,
      message: MESSAGES_CLASSEMENT.long,
    });
    expect(MESSAGES_CLASSEMENT.long).toBe(
      `La raison ne doit pas dépasser 2${ESPACE_INSECABLE}000 caractères.`,
    );
    expect(verifierRaisonClassement("🙂".repeat(2000))).toMatchObject({ ok: true });
  });
});

describe("action changerStatut", () => {
  it.each([
    ["traitee", { statut: "traitee", responsable_id: KARIM, avait_responsable: true }, "traitee", KARIM, true],
    ["en_cours", { statut: "en_cours", responsable_id: KARIM, avait_responsable: true }, "en_cours", KARIM, true],
    ["en_cours", { statut: "nouvelle", responsable_id: null, avait_responsable: true }, "nouvelle", null, true],
    ["en_cours", { statut: "nouvelle", responsable_id: null, avait_responsable: false }, "nouvelle", null, false],
  ] as const)(
    "vers %s : appelle changer_statut avec la session, renvoie le statut obtenu, rafraîchit",
    async (vers, donnees, statut, responsableId, avaitResponsable) => {
      const appels = base({ data: { id: DEMANDE, ...donnees } });
      expect(await changerStatut(DEMANDE, vers)).toEqual({
        ok: true,
        donnees: { statut, responsableId, avaitResponsable },
      });
      expect(appels).toEqual([
        { fonction: "changer_statut", parametres: { p_demande_id: DEMANDE, p_statut: vers } },
      ]);
      expect(simulation.rafraichissements).toBe(1);
      expect(simulation.clientService).toBe(0);
    },
  );

  it("statut hors liste : PASSAGE_INTERDIT sans appeler la base", async () => {
    const appels = base({});
    for (const statut of ["nouvelle", "fermee", null, 3]) {
      expect(await changerStatut(DEMANDE, statut), String(statut)).toEqual({
        ok: false,
        code: "PASSAGE_INTERDIT",
        message: "Ce changement de statut n'est pas autorisé.",
      });
    }
    expect(appels).toEqual([]);
  });

  it("identifiant mal formé : refusé sans appeler la base", async () => {
    const appels = base({});
    for (const valeur of ["abc", "", null, `${DEMANDE}' or 1=1`]) {
      expect(await changerStatut(valeur, "traitee")).toMatchObject({
        ok: false,
        code: "DEMANDE_INTROUVABLE",
      });
    }
    expect(appels).toEqual([]);
  });

  it.each(["PASSAGE_INTERDIT", "DEMANDE_INTROUVABLE", "DROIT_INSUFFISANT"] as const)(
    "%s : message de lib/erreurs.ts, sans détail, détail rafraîchi",
    async (code) => {
      base({ error: { code: "P0001", message: code, details: '{"x": 1}' } });
      const resultat = await changerStatut(DEMANDE, "traitee");
      expect(resultat).toEqual({ ok: false, code, message: messageErreur(code) });
      expect(resultat).not.toHaveProperty("detail");
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("base injoignable : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.reject(new Error("fetch failed"));
    expect(await changerStatut(DEMANDE, "traitee")).toMatchObject({
      ok: false,
      code: "ERREUR_INATTENDUE",
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("réponse inattendue : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    base({ data: { statut: "fermee", responsable_id: null } });
    expect(await changerStatut(DEMANDE, "traitee")).toMatchObject({ code: "ERREUR_INATTENDUE" });
    base({ data: { statut: "traitee", responsable_id: 3, avait_responsable: true } });
    expect(await changerStatut(DEMANDE, "traitee")).toMatchObject({ code: "ERREUR_INATTENDUE" });
    base({ data: { statut: "traitee", responsable_id: KARIM } });
    expect(await changerStatut(DEMANDE, "traitee")).toMatchObject({ code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("client serveur indisponible : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = null;
    expect(await changerStatut(DEMANDE, "traitee")).toMatchObject({ code: "ERREUR_INATTENDUE" });
  });
});

describe("action classerSansSuite", () => {
  it("réussite : appelle classer_sans_suite avec la raison nettoyée, rafraîchit", async () => {
    const appels = base({
      data: { id: DEMANDE, statut: "traitee", responsable_id: null, avait_responsable: false, note_id: 4 },
    });
    expect(await classerSansSuite(DEMANDE, "  Doublon \n")).toEqual({
      ok: true,
      donnees: { statut: "traitee", responsableId: null, avaitResponsable: false },
    });
    expect(appels).toEqual([
      { fonction: "classer_sans_suite", parametres: { p_demande_id: DEMANDE, p_note: "Doublon" } },
    ]);
    expect(simulation.rafraichissements).toBe(1);
    expect(simulation.clientService).toBe(0);
  });

  it.each([
    ["vide", "", MESSAGES_CLASSEMENT.vide],
    ["espaces seulement", "  \n ", MESSAGES_CLASSEMENT.vide],
    ["trop longue", "a".repeat(2001), MESSAGES_CLASSEMENT.long],
    ["pas un texte", { raison: "x" }, MESSAGES_CLASSEMENT.vide],
  ])("raison %s : DONNEES_INVALIDES sans appeler la base", async (_cas, raison, message) => {
    const appels = base({});
    expect(await classerSansSuite(DEMANDE, raison)).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message,
    });
    expect(appels).toEqual([]);
    expect(simulation.rafraichissements).toBe(0);
  });

  it("DONNEES_INVALIDES renvoyé par la base : message du champ, rien n'est rafraîchi", async () => {
    base({ error: { code: "P0001", message: "DONNEES_INVALIDES" } });
    expect(await classerSansSuite(DEMANDE, "Spam")).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message: MESSAGES_CLASSEMENT.vide,
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it.each(["PASSAGE_INTERDIT", "DEMANDE_INTROUVABLE", "DROIT_INSUFFISANT"] as const)(
    "%s : message de lib/erreurs.ts, détail rafraîchi",
    async (code) => {
      base({ error: { code: "P0001", message: code } });
      expect(await classerSansSuite(DEMANDE, "Spam")).toEqual({
        ok: false,
        code,
        message: messageErreur(code),
      });
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("identifiant mal formé : refusé sans appeler la base", async () => {
    const appels = base({});
    expect(await classerSansSuite("abc", "Spam")).toMatchObject({ code: "DEMANDE_INTROUVABLE" });
    expect(appels).toEqual([]);
  });
});

function ligne(type: LigneHistorique["type"], modifs: Partial<LigneHistorique> = {}): LigneHistorique {
  return {
    id: "1",
    creeLe: "2026-11-03T08:47:00Z",
    auteurType: "membre",
    auteurId: KARIM,
    type,
    ancienneValeur: null,
    nouvelleValeur: null,
    ...modifs,
  };
}

const NOMS = { nomsMembres: { [KARIM]: "Karim Benali" }, nomsCategories: {} };

describe("phrases de l'historique", () => {
  it("changement de statut : « [nom] a changé le statut : En cours → Traitée »", () => {
    expect(
      phraseLigneHistorique(
        ligne("changement_statut", { ancienneValeur: "en_cours", nouvelleValeur: "traitee" }),
        NOMS,
      ),
    ).toBe("Karim Benali a changé le statut : En cours → Traitée");
    expect(
      phraseLigneHistorique(
        ligne("changement_statut", { ancienneValeur: "traitee", nouvelleValeur: "nouvelle" }),
        NOMS,
      ),
    ).toBe("Karim Benali a changé le statut : Traitée → Nouvelle");
  });

  it("classement : « Classée sans suite par [nom] : Nouvelle → Traitée »", () => {
    expect(
      phraseLigneHistorique(
        ligne("classement_sans_suite", { ancienneValeur: "nouvelle", nouvelleValeur: "traitee" }),
        NOMS,
      ),
    ).toBe("Classée sans suite par Karim Benali : Nouvelle → Traitée");
  });

  it("ancienne ligne de classement sans valeurs (ou valeurs inconnues) : lisible", () => {
    expect(phraseLigneHistorique(ligne("classement_sans_suite"), NOMS)).toBe(
      "Classée sans suite par Karim Benali",
    );
    expect(
      phraseLigneHistorique(
        ligne("classement_sans_suite", { ancienneValeur: "x", nouvelleValeur: KARIM }),
        NOMS,
      ),
    ).toBe("Classée sans suite par Karim Benali");
  });
});

describe("messages des toasts", () => {
  it("réussites", () => {
    expect(messageReussiteStatut("traitee", { statut: "traitee", avaitResponsable: true })).toBe(
      "Demande marquée comme traitée.",
    );
    expect(messageReussiteStatut("en_cours", { statut: "en_cours", avaitResponsable: true })).toBe(
      "Demande rouverte.",
    );
    expect(messageReussiteStatut("en_cours", { statut: "nouvelle", avaitResponsable: true })).toBe(
      "Demande rouverte. Son responsable n'est plus actif : elle revient en Nouvelle.",
    );
    // Demande classée sans suite (aucun responsable) puis rouverte.
    expect(messageReussiteStatut("en_cours", { statut: "nouvelle", avaitResponsable: false })).toBe(
      "Demande rouverte. Elle revient en Nouvelle, sans responsable.",
    );
    expect(MESSAGES_STATUT.classee).toBe("Demande classée sans suite.");
  });

  it("fenêtre : texte et libellé", () => {
    expect(TEXTE_FENETRE_CLASSEMENT).toBe(
      "La demande passera à Traitée sans être traitée. Indiquez la raison (spam, doublon…) : elle sera ajoutée aux notes internes.",
    );
    expect(LIBELLE_RAISON_CLASSEMENT).toBe("Raison du classement");
  });
});

describe("partie « Statut » : seul le passage permis", () => {
  function boutons(statut: Statut): string[] {
    const html = renderToStaticMarkup(
      createElement(
        FournisseurToasts,
        null,
        createElement(ActionsStatut, { demandeId: DEMANDE, statut }),
      ),
    );
    return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)]
      .map((m) => m[1])
      .filter((texte) => texte !== "");
  }

  it.each([
    ["nouvelle", ["Classer sans suite"]],
    ["en_cours", ["Marquer comme traitée"]],
    ["traitee", ["Rouvrir"]],
  ] as const)("%s : %j", (statut, attendus) => {
    expect(boutons(statut)).toEqual(attendus);
  });
});
