import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Story 2.4 — actions serveur `changerPriorite` et `changerCategorie` avec un
// client Supabase simulé (la base réelle est testée dans
// priorite-categorie.test.ts) : session (jamais la clé secrète), schémas,
// refus sans appel, résultat sans `detail`, rafraîchissement du détail.
// Et : phrases de l'historique, messages des toasts, options des listes.

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
  useRouter: () => ({ refresh: () => {} }),
  RedirectType: { push: "push", replace: "replace" },
  redirect: () => {
    throw new Error("REDIRECTION");
  },
}));

import { changerCategorie, changerPriorite } from "@/lib/actions/demandes";
import {
  ChoixCategorie,
  ChoixPriorite,
  messageCategorieModifiee,
  messagePrioriteModifiee,
  optionsCategorie,
} from "@/components/nova/actions-demande";
import { phraseLigneHistorique } from "@/components/nova/historique";
import { FournisseurToasts } from "@/components/nova/toasts";
import type { LigneHistorique } from "@/lib/detail-demande";
import { messageErreur } from "@/lib/erreurs";
import { schemaIdentifiantCategorie, schemaPrioriteDemande } from "@/lib/schemas/traitement";

const DEMANDE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";
const INFORMATION = "0b6c1f7e-0000-4000-8000-0000000000c0";
const TECHNIQUE = "0b6c1f7e-0000-4000-8000-0000000000c1";
const ANCIENNE = "0b6c1f7e-0000-4000-8000-0000000000c9";

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
  it("priorité : basse, normale ou haute seulement", () => {
    for (const valeur of ["basse", "normale", "haute"]) {
      expect(schemaPrioriteDemande.safeParse(valeur).success, valeur).toBe(true);
    }
    for (const valeur of ["urgente", "Haute", "", null, 1]) {
      expect(schemaPrioriteDemande.safeParse(valeur).success, String(valeur)).toBe(false);
    }
  });

  it("catégorie : un uuid", () => {
    expect(schemaIdentifiantCategorie.safeParse(TECHNIQUE).success).toBe(true);
    for (const valeur of ["abc", "", null, 3]) {
      expect(schemaIdentifiantCategorie.safeParse(valeur).success, String(valeur)).toBe(false);
    }
  });
});

describe("action changerPriorite", () => {
  it("réussite : appelle changer_priorite avec la session, rafraîchit", async () => {
    const appels = base({ data: { id: DEMANDE, priorite: "haute", modifiee: true } });
    expect(await changerPriorite(DEMANDE, "haute")).toEqual({
      ok: true,
      donnees: { priorite: "haute", modifiee: true },
    });
    expect(appels).toEqual([
      { fonction: "changer_priorite", parametres: { p_demande_id: DEMANDE, p_priorite: "haute" } },
    ]);
    expect(simulation.rafraichissements).toBe(1);
    expect(simulation.clientService).toBe(0);
  });

  it("même valeur : succès sans modification", async () => {
    base({ data: { id: DEMANDE, priorite: "haute", modifiee: false } });
    expect(await changerPriorite(DEMANDE, "haute")).toEqual({
      ok: true,
      donnees: { priorite: "haute", modifiee: false },
    });
  });

  it("priorité hors liste : DONNEES_INVALIDES sans appeler la base", async () => {
    const appels = base({});
    for (const priorite of ["urgente", "", null, 3]) {
      expect(await changerPriorite(DEMANDE, priorite), String(priorite)).toEqual({
        ok: false,
        code: "DONNEES_INVALIDES",
        message: messageErreur("DONNEES_INVALIDES"),
      });
    }
    expect(appels).toEqual([]);
  });

  it("identifiant mal formé : refusé sans appeler la base", async () => {
    const appels = base({});
    for (const valeur of ["abc", "", null, `${DEMANDE}' or 1=1`]) {
      expect(await changerPriorite(valeur, "haute")).toMatchObject({
        ok: false,
        code: "DEMANDE_INTROUVABLE",
      });
    }
    expect(appels).toEqual([]);
  });

  it.each(["DONNEES_INVALIDES", "DEMANDE_INTROUVABLE", "DROIT_INSUFFISANT"] as const)(
    "%s : message de lib/erreurs.ts, sans détail, détail rafraîchi",
    async (code) => {
      base({ error: { code: "P0001", message: code, details: '{"x": 1}' } });
      const resultat = await changerPriorite(DEMANDE, "haute");
      expect(resultat).toEqual({ ok: false, code, message: messageErreur(code) });
      expect(resultat).not.toHaveProperty("detail");
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("base injoignable : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.reject(new Error("fetch failed"));
    expect(await changerPriorite(DEMANDE, "haute")).toMatchObject({
      ok: false,
      code: "ERREUR_INATTENDUE",
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("réponse inattendue : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    base({ data: { priorite: "urgente", modifiee: true } });
    expect(await changerPriorite(DEMANDE, "haute")).toMatchObject({ code: "ERREUR_INATTENDUE" });
    base({ data: { priorite: "haute" } });
    expect(await changerPriorite(DEMANDE, "haute")).toMatchObject({ code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("client serveur indisponible : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = null;
    expect(await changerPriorite(DEMANDE, "haute")).toMatchObject({ code: "ERREUR_INATTENDUE" });
  });
});

describe("action changerCategorie", () => {
  it("réussite : appelle changer_categorie avec la session, rafraîchit", async () => {
    const appels = base({ data: { id: DEMANDE, categorie_id: TECHNIQUE, modifiee: true } });
    expect(await changerCategorie(DEMANDE, TECHNIQUE)).toEqual({
      ok: true,
      donnees: { categorieId: TECHNIQUE, modifiee: true },
    });
    expect(appels).toEqual([
      {
        fonction: "changer_categorie",
        parametres: { p_demande_id: DEMANDE, p_categorie_id: TECHNIQUE },
      },
    ]);
    expect(simulation.rafraichissements).toBe(1);
    expect(simulation.clientService).toBe(0);
  });

  it("catégorie mal formée : CATEGORIE_INVALIDE sans appeler la base", async () => {
    const appels = base({});
    for (const valeur of ["abc", "", null, 3]) {
      expect(await changerCategorie(DEMANDE, valeur), String(valeur)).toEqual({
        ok: false,
        code: "CATEGORIE_INVALIDE",
        message: messageErreur("CATEGORIE_INVALIDE"),
      });
    }
    expect(appels).toEqual([]);
  });

  it("identifiant de demande mal formé : refusé sans appeler la base", async () => {
    const appels = base({});
    expect(await changerCategorie("abc", TECHNIQUE)).toMatchObject({ code: "DEMANDE_INTROUVABLE" });
    expect(appels).toEqual([]);
  });

  it.each(["CATEGORIE_INVALIDE", "DEMANDE_INTROUVABLE", "DROIT_INSUFFISANT"] as const)(
    "%s : message de lib/erreurs.ts, détail rafraîchi",
    async (code) => {
      base({ error: { code: "P0001", message: code } });
      expect(await changerCategorie(DEMANDE, TECHNIQUE)).toEqual({
        ok: false,
        code,
        message: messageErreur(code),
      });
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("identifiant de demande malveillant : refusé sans appeler la base", async () => {
    const appels = base({});
    for (const valeur of ["", null, `${DEMANDE}' or 1=1`]) {
      expect(await changerCategorie(valeur, TECHNIQUE)).toMatchObject({ code: "DEMANDE_INTROUVABLE" });
    }
    expect(appels).toEqual([]);
    expect(simulation.rafraichissements).toBe(0);
  });

  it("catégorie mal formée : rien n'est rafraîchi", async () => {
    base({});
    await changerCategorie(DEMANDE, "abc");
    expect(simulation.rafraichissements).toBe(0);
  });

  it("base injoignable : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.reject(new Error("fetch failed"));
    expect(await changerCategorie(DEMANDE, TECHNIQUE)).toMatchObject({
      ok: false,
      code: "ERREUR_INATTENDUE",
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("client serveur indisponible : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = null;
    expect(await changerCategorie(DEMANDE, TECHNIQUE)).toMatchObject({ code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("réponse inattendue : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    base({ data: { categorie_id: 4, modifiee: true } });
    expect(await changerCategorie(DEMANDE, TECHNIQUE)).toMatchObject({ code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
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

describe("phrases de l'historique", () => {
  const noms = {
    nomsMembres: { [KARIM]: "Karim Benali" },
    nomsCategories: { [INFORMATION]: "Demande d'information", [TECHNIQUE]: "Problème technique" },
  };

  it("priorité : « [nom] a changé la priorité : Normale → Haute »", () => {
    expect(
      phraseLigneHistorique(
        ligne("changement_priorite", { ancienneValeur: "normale", nouvelleValeur: "haute" }),
        noms,
      ),
    ).toBe("Karim Benali a changé la priorité : Normale → Haute");
  });

  it("catégorie : noms actuels des deux catégories", () => {
    expect(
      phraseLigneHistorique(
        ligne("changement_categorie", { ancienneValeur: INFORMATION, nouvelleValeur: TECHNIQUE }),
        noms,
      ),
    ).toBe("Karim Benali a changé la catégorie : Demande d'information → Problème technique");
  });
});

describe("messages des toasts", () => {
  it("réussites", () => {
    expect(messagePrioriteModifiee("haute")).toBe("Priorité modifiée : Haute.");
    expect(messageCategorieModifiee("Problème technique")).toBe(
      "Catégorie modifiée : Problème technique.",
    );
  });
});

describe("listes « Priorité » et « Catégorie »", () => {
  const actives = [
    { id: INFORMATION, nom: "Demande d'information" },
    { id: TECHNIQUE, nom: "Problème technique" },
  ];

  it("catégorie active : les catégories actives seulement, dans l'ordre reçu", () => {
    expect(optionsCategorie({ id: TECHNIQUE, nom: "Problème technique", actif: true }, actives)).toEqual([
      { valeur: INFORMATION, texte: "Demande d'information" },
      { valeur: TECHNIQUE, texte: "Problème technique" },
    ]);
  });

  it("catégorie active absente de la liste reçue : jamais « (désactivée) » par déduction", () => {
    expect(optionsCategorie({ id: ANCIENNE, nom: "Ancienne", actif: true }, actives)).toEqual([
      { valeur: INFORMATION, texte: "Demande d'information" },
      { valeur: TECHNIQUE, texte: "Problème technique" },
    ]);
  });

  it("catégorie désactivée (état réel) : en tête, « (désactivée) », non proposée", () => {
    expect(optionsCategorie({ id: ANCIENNE, nom: "Ancienne", actif: false }, actives)).toEqual([
      { valeur: ANCIENNE, texte: "Ancienne (désactivée)", disabled: true },
      { valeur: INFORMATION, texte: "Demande d'information" },
      { valeur: TECHNIQUE, texte: "Problème technique" },
    ]);
  });

  function rendre(element: ReturnType<typeof createElement>): string {
    return renderToStaticMarkup(createElement(FournisseurToasts, null, element));
  }

  it("priorité : libellée par le <dt> du panneau, Basse / Normale / Haute, valeur actuelle choisie", () => {
    const html = rendre(
      createElement(ChoixPriorite, { demandeId: DEMANDE, priorite: "normale", idLibelle: "lib-p" }),
    );
    expect(html).not.toContain("<label");
    expect(html).toMatch(/<select[^>]*aria-labelledby="lib-p"/);
    expect([...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])).toEqual([
      "Basse",
      "Normale",
      "Haute",
    ]);
    expect(html).toMatch(/<option[^>]*value="normale" selected=""/);
  });

  it("catégorie : libellée, valeur actuelle choisie", () => {
    const html = rendre(
      createElement(ChoixCategorie, {
        demandeId: DEMANDE,
        actuelle: { id: ANCIENNE, nom: "Ancienne", actif: false },
        actives,
        idLibelle: "lib-c",
      }),
    );
    expect(html).toMatch(/<select[^>]*aria-labelledby="lib-c"/);
    expect(html).toMatch(new RegExp(`<option[^>]*value="${ANCIENNE}" disabled="" selected="">Ancienne \\(désactivée\\)`));
  });
});
