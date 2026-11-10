import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CategorieAdmin } from "@/lib/categories-admin";
import type { Resultat } from "@/lib/server/appeler";

// Story 5.2 — écran sans base : page /equipe/admin/categories (tableau Nom ·
// État · Demandes · Actions, cartes, bouton « Ajouter une catégorie »,
// bandeau d'erreur avec « Réessayer », collaborateur refusé), actions selon
// l'état (Active → Renommer, Désactiver ; Désactivée → Renommer, Réactiver),
// texte de la fenêtre « Désactiver » (0, 1, n demandes), schéma du nom,
// lecture de `lister_categories_admin()`, phrases du journal, menu.

const etat = vi.hoisted(() => ({
  admin: true,
  resultat: null as unknown,
  lue: false,
}));

vi.mock("@/lib/session", () => ({
  lireProfil: async () => ({
    ok: true,
    donnees: {
      id: "moi",
      nom: "Claire Roux",
      role: etat.admin ? "administrateur" : "collaborateur",
      prenom: "Claire",
      estAdmin: etat.admin,
    },
  }),
}));

vi.mock("@/lib/categories-admin", async (importer) => ({
  ...(await importer<typeof import("@/lib/categories-admin")>()),
  lireCategoriesAdmin: async () => {
    etat.lue = true;
    return etat.resultat;
  },
}));

import PageCategories, { generateMetadata } from "@/app/equipe/admin/categories/page";
import { ActionsCategorie } from "@/components/nova/categories/actions-categorie";
import { ListeCategories, texteDemandes } from "@/components/nova/categories/liste-categories";
import { FournisseurToasts } from "@/components/nova/toasts";
import { lireReponseCategories } from "@/lib/categories-admin";
import { MESSAGES_ERREUR } from "@/lib/erreurs";
import { CATEGORIE_SANS_NOM, descriptionJournal } from "@/lib/journal";
import {
  MESSAGES_CATEGORIE,
  texteDesactivationCategorie,
  verifierNomCategorie,
} from "@/lib/schemas/categorie";

const CATEGORIES: CategorieAdmin[] = [
  { id: "c1", nom: "Demande d'information", actif: true, ordre: 1, demandes: 1234 },
  { id: "c2", nom: "Formation", actif: false, ordre: 6, demandes: 3 },
];

function rendu(element: React.ReactNode): string {
  return renderToStaticMarkup(<FournisseurToasts>{element}</FournisseurToasts>);
}

async function rendre(): Promise<string> {
  return rendu(await PageCategories());
}

function boutons(element: React.ReactElement): string[] {
  // Texte visible de chaque bouton (sans le nom caché aux yeux).
  return [...rendu(element).matchAll(/<button[^>]*>([^<]*)/g)].map(([, texte]) => texte.trim());
}

beforeEach(() => {
  etat.admin = true;
  etat.resultat = null;
  etat.lue = false;
});

describe("page /equipe/admin/categories", () => {
  it("titre de l'onglet « Catégories », ou « Accès refusé » pour un collaborateur", async () => {
    expect((await generateMetadata()).title).toBe("Catégories — Nova Services");
    etat.admin = false;
    expect((await generateMetadata()).title).toBe("Accès refusé — Nova Services");
  });

  it("tableau Nom · État · Demandes · Actions, cartes, « Ajouter une catégorie »", async () => {
    etat.resultat = { ok: true, donnees: CATEGORIES } satisfies Resultat<CategorieAdmin[]>;
    const html = await rendre();
    expect(html).toMatch(/<h1[^>]*>Catégories<\/h1>/);
    expect(html).toMatch(/<button[^>]*>Ajouter une catégorie<\/button>/);
    const entetes = [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map(([, t]) => t);
    expect(entetes).toEqual(["Nom", "État", "Demandes", "Actions"]);
    expect(html).toContain(">Active<");
    expect(html).toContain(">Désactivée<");
    // Nombre de demandes (espace insécable des milliers), et « n demandes » sur les cartes.
    expect(html).toContain("1 234");
    expect(html).toContain("3 demandes");
    // Deux vues (tableau et cartes), dans l'ordre reçu.
    expect(html.match(/data-categorie="c1"/g)).toHaveLength(2);
    expect(html.indexOf('data-categorie="c1"')).toBeLessThan(html.indexOf('data-categorie="c2"'));
  });

  it("erreur : bandeau role=alert et « Réessayer »", async () => {
    etat.resultat = { ok: false, code: "ERREUR_INATTENDUE", message: "Le serveur ne répond pas." };
    const html = await rendre();
    expect(html).toMatch(/role="alert" class="flex[^"]*"><p[^>]*>Le serveur ne répond pas\.<\/p>/);
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("<table");
  });

  it("collaborateur : accès refusé, catégories jamais lues", async () => {
    etat.admin = false;
    const html = await rendre();
    expect(html).toContain("Vous n&#x27;avez pas accès à cette page.");
    expect(etat.lue).toBe(false);
  });

  it("refus de la base (rôle changé entre-temps) : accès refusé", async () => {
    etat.resultat = { ok: false, code: "DROIT_INSUFFISANT", message: "x" };
    const html = await rendre();
    expect(html).toContain("Vous n&#x27;avez pas accès à cette page.");
    expect(html).not.toContain("Réessayer");
  });
});

describe("ActionsCategorie — selon l'état", () => {
  it("Active : Renommer, Désactiver", () => {
    expect(boutons(<ActionsCategorie categorie={CATEGORIES[0]} />)).toEqual(["Renommer", "Désactiver"]);
  });

  it("Désactivée : Renommer, Réactiver", () => {
    expect(boutons(<ActionsCategorie categorie={CATEGORIES[1]} />)).toEqual(["Renommer", "Réactiver"]);
  });

  it("le nom de la catégorie complète le nom accessible des boutons", () => {
    const html = rendu(<ActionsCategorie categorie={CATEGORIES[1]} />);
    expect(html).toContain('aria-label="Actions pour Formation"');
    expect(html).toContain('<span class="sr-only"> Formation</span>');
  });

  it("la liste affiche les actions dans le tableau et dans les cartes", () => {
    const html = rendu(<ListeCategories categories={CATEGORIES} />);
    expect(html.match(/aria-label="Actions pour Formation"/g)).toHaveLength(2);
  });
});

describe("textes", () => {
  it("fenêtre « Désactiver » : sans nombre à 0, singulier à 1, pluriel au-delà", () => {
    const debut = "« Formation » ne sera plus proposée dans le formulaire ni dans le choix de catégorie.";
    expect(texteDesactivationCategorie("Formation", 0)).toBe(debut);
    expect(texteDesactivationCategorie("Formation", 1)).toBe(`${debut} La demande qui l'utilise la garde.`);
    expect(texteDesactivationCategorie("Formation", 3)).toBe(
      `${debut} Les 3 demandes qui l'utilisent la gardent.`,
    );
    // Même format de nombre que la liste (espace insécable des milliers).
    expect(texteDesactivationCategorie("Formation", 1234)).toBe(
      `${debut} Les 1 234 demandes qui l'utilisent la gardent.`,
    );
  });

  it("nombre de demandes des cartes", () => {
    expect(texteDemandes(0)).toBe("0 demande");
    expect(texteDemandes(1)).toBe("1 demande");
    expect(texteDemandes(3)).toBe("3 demandes");
  });

  it("messages des nouveaux codes et des toasts", () => {
    expect(MESSAGES_ERREUR.NOM_CATEGORIE_PRIS).toBe("Ce nom est déjà pris.");
    expect(MESSAGES_ERREUR.DERNIERE_CATEGORIE).toBe("Il doit rester au moins une catégorie active.");
    expect(MESSAGES_CATEGORIE.nomDesactive).toBe(
      "Une catégorie désactivée porte déjà ce nom : réactivez-la.",
    );
    expect(MESSAGES_CATEGORIE.ajoutee).toBe("Catégorie ajoutée.");
    expect(MESSAGES_CATEGORIE.reactivee).toBe("Catégorie réactivée.");
  });
});

describe("schéma du nom", () => {
  it("espaces retirés aux extrémités, 1 à 80 caractères", () => {
    expect(verifierNomCategorie("  Formation  ")).toEqual({ ok: true, nom: "Formation" });
    expect(verifierNomCategorie("x".repeat(80))).toEqual({ ok: true, nom: "x".repeat(80) });
    expect(verifierNomCategorie(" \t ")).toEqual({ ok: false, erreur: MESSAGES_CATEGORIE.nomRequis });
    expect(verifierNomCategorie("x".repeat(81))).toEqual({
      ok: false,
      erreur: MESSAGES_CATEGORIE.nomTropLong,
    });
    // Ponctuation seule : nom vide une fois normalisé, refusé.
    for (const nom of ["-", "'", "– ’"]) {
      expect(verifierNomCategorie(nom), nom).toEqual({ ok: false, erreur: MESSAGES_CATEGORIE.nomRequis });
    }
    expect(verifierNomCategorie("5")).toEqual({ ok: true, nom: "5" });
    expect(verifierNomCategorie(undefined)).toEqual({ ok: false, erreur: MESSAGES_CATEGORIE.nomRequis });
  });
});

describe("lecture de lister_categories_admin()", () => {
  it("forme attendue : ordre de la base conservé", () => {
    expect(
      lireReponseCategories([
        { id: "b", nom: "Zèbre", actif: true, ordre: 1, demandes: 0 },
        { id: "a", nom: "Abeille", actif: false, ordre: 2, demandes: 4 },
      ]),
    ).toEqual([
      { id: "b", nom: "Zèbre", actif: true, ordre: 1, demandes: 0 },
      { id: "a", nom: "Abeille", actif: false, ordre: 2, demandes: 4 },
    ]);
  });

  it.each([
    ["pas un tableau", {}],
    ["actif manquant", [{ id: "a", nom: "A", ordre: 1, demandes: 0 }]],
    ["demandes négatives", [{ id: "a", nom: "A", actif: true, ordre: 1, demandes: -1 }]],
    ["ordre non entier", [{ id: "a", nom: "A", actif: true, ordre: 1.5, demandes: 0 }]],
  ])("%s : null", (_cas, valeur) => {
    expect(lireReponseCategories(valeur)).toBeNull();
  });
});

describe("phrases du journal", () => {
  it("ajoutée, renommée, désactivée, réactivée", () => {
    const base = { categorie_id: "c2", nom: "Formation" };
    expect(descriptionJournal({ evenement: "categorie_ajoutee", ...base })).toBe(
      "Catégorie ajoutée : Formation",
    );
    expect(
      descriptionJournal({
        evenement: "categorie_renommee",
        categorie_id: "c2",
        nom: "Formations",
        ancien_nom: "Formation",
      }),
    ).toBe("Catégorie renommée : Formation → Formations");
    expect(descriptionJournal({ evenement: "categorie_desactivee", ...base })).toBe(
      "Catégorie désactivée : Formation",
    );
    expect(descriptionJournal({ evenement: "categorie_reactivee", ...base })).toBe(
      "Catégorie réactivée : Formation",
    );
  });

  it("nom absent : jamais de JSON brut", () => {
    expect(descriptionJournal({ evenement: "categorie_ajoutee", categorie_id: "c2" })).toBe(
      `Catégorie ajoutée : ${CATEGORIE_SANS_NOM}`,
    );
    expect(descriptionJournal({ evenement: "categorie_renommee", categorie_id: "c2", nom: "B" })).toBe(
      "Catégorie renommée : B",
    );
  });
});
