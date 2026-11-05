import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LigneDemande, PageDemandes as DonneesPage } from "@/lib/demandes";
import type { Filtres } from "@/lib/filtres";
import type { Resultat } from "@/lib/server/appeler";

// Story 2.5 — page /equipe/demandes avec filtres, sans base : filtres lus
// dans l'adresse et transmis à la lecture, barre (cinq listes, recherche),
// sans résultat (message et « Effacer les filtres »), liste vide sans filtre
// inchangée, liens du détail et de la pagination avec tous les filtres,
// adresse non canonique redirigée.

const lecture = vi.hoisted(() => ({
  optionsIllisibles: false,
  resultat: null as unknown,
  page: null as number | null,
  filtres: null as Filtres | null,
}));

vi.mock("@/lib/demandes", () => ({
  lireDemandes: async (page: number, filtres: Filtres) => {
    lecture.page = page;
    lecture.filtres = filtres;
    return lecture.resultat;
  },
}));

vi.mock("@/lib/options-filtres", () => ({
  lireOptionsFiltres: async () =>
    lecture.optionsIllisibles
      ? { ok: false, code: "ERREUR_INATTENDUE", message: "Le serveur ne répond pas." }
      : {
    ok: true,
    donnees: {
      categories: [
        { id: "0b9f2c4e-3d6a-4b1c-9e8f-7a6b5c4d3e2f", nom: "Problème technique", desactive: false },
        { id: "1b9f2c4e-3d6a-4b1c-9e8f-7a6b5c4d3e2f", nom: "Ancienne", desactive: true },
      ],
      membres: [
        { id: "2b9f2c4e-3d6a-4b1c-9e8f-7a6b5c4d3e2f", nom: "Karim Benali", desactive: false },
        { id: "3b9f2c4e-3d6a-4b1c-9e8f-7a6b5c4d3e2f", nom: "Léo Martin", desactive: true },
      ],
    },
        },
}));

vi.mock("next/navigation", async (importer) => ({
  ...(await importer<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: Record<string, unknown>) => (
    <a href={String(href)} className={className as string | undefined}>
      {children as React.ReactNode}
    </a>
  ),
}));

import PageDemandes from "@/app/equipe/demandes/page";

function ligne(i: number): LigneDemande {
  return {
    id: `id-${i}`,
    reference: `NOVA-2026-${String(i).padStart(4, "0")}`,
    creeLe: "2026-11-03T08:12:00Z",
    nom: "Jean Dupont",
    societe: null,
    objet: `Objet ${i}`,
    categorie: "Problème technique",
    canal: "formulaire",
    statut: "nouvelle",
    priorite: "haute",
    responsable: null,
  };
}

async function rendre(parametres: Record<string, string> = {}): Promise<string> {
  const element = await PageDemandes({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(parametres),
  } as unknown as PageProps<"/equipe/demandes">);
  return renderToStaticMarkup(element);
}

function donner(resultat: Resultat<DonneesPage>) {
  lecture.resultat = resultat;
}

beforeEach(() => {
  lecture.optionsIllisibles = false;
  lecture.resultat = null;
  lecture.page = null;
  lecture.filtres = null;
});

describe("page /equipe/demandes — filtres", () => {
  it("filtres lus dans l'adresse et transmis à la lecture ; barre avec les cinq listes", async () => {
    donner({ ok: true, donnees: { lignes: [ligne(42)], total: 40, page: 2, taillePage: 25 } });
    const html = await rendre({ q: "dupont", statut: "non_traitees", priorite: "haute", page: "2" });
    expect(lecture.filtres).toEqual({ q: "dupont", statut: "non_traitees", priorite: "haute" });
    expect(lecture.page).toBe(2);

    expect(html).toContain('role="search"');
    expect(html).toContain(
      'placeholder="Rechercher une référence, un nom, une société, un email, un objet…"',
    );
    expect(html).toContain('value="dupont"');
    for (const libelle of ["Statut", "Priorité", "Catégorie", "Canal", "Responsable"]) {
      expect(html).toMatch(new RegExp(`<label[^>]*>${libelle}</label>`));
    }
    for (const option of ["Non traitées", "Sans responsable", "Mes demandes", "Karim Benali"]) {
      expect(html).toContain(`>${option}</option>`);
    }
    expect(html).toContain(">Ancienne (désactivée)</option>");
    expect(html).toContain(">Léo Martin (désactivé)</option>");
    expect(html).toContain("Effacer les filtres");

    // Détail et pagination : tous les filtres, et la page.
    expect(html).toContain(
      'href="/equipe/demandes/NOVA-2026-0042?q=dupont&amp;statut=non_traitees&amp;priorite=haute&amp;page=2"',
    );
    expect(html).toContain('href="/equipe/demandes?q=dupont&amp;statut=non_traitees&amp;priorite=haute"');
    expect(html).toContain("40 demandes");
  });

  it("sans filtre : pas de « Effacer les filtres »", async () => {
    donner({ ok: true, donnees: { lignes: [ligne(1)], total: 1, page: 1, taillePage: 25 } });
    const html = await rendre();
    expect(html).toContain('role="search"');
    expect(html).not.toContain("Effacer les filtres");
  });

  it("aucun résultat : message et « Effacer les filtres »", async () => {
    donner({ ok: true, donnees: { lignes: [], total: 0, page: 1, taillePage: 25 } });
    const html = await rendre({ statut: "traitee", canal: "email" });
    expect(html).toContain("Aucune demande ne correspond à ces filtres.");
    expect(html).toMatch(/<a href="\/equipe\/demandes"[^>]*>Effacer les filtres<\/a>/);
    expect(html).toContain('role="search"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Partagez le lien du formulaire");
  });

  it("liste vide sans filtre : message de la story 1.5 inchangé, sans barre", async () => {
    donner({ ok: true, donnees: { lignes: [], total: 0, page: 1, taillePage: 25 } });
    const html = await rendre();
    expect(html).toContain(
      "Aucune demande pour l&#x27;instant. Partagez le lien du formulaire à vos clients.",
    );
    expect(html).not.toContain("ne correspond");
    expect(html).not.toContain('role="search"');
  });

  it("total dans une zone role=\"status\", résultats dans une zone aria-busy pendant la lecture", async () => {
    donner({ ok: true, donnees: { lignes: [ligne(1)], total: 3, page: 1, taillePage: 25 } });
    const html = await rendre({ statut: "nouvelle" });
    expect(html).toContain('<p role="status" data-testid="total"');
    expect(html).toContain(">3 demandes</p>");
    expect(html).toContain('data-testid="resultats"');
  });

  it("lecture en échec : la barre reste, avec « Effacer les filtres » et « Réessayer »", async () => {
    donner({ ok: false, code: "ERREUR_INATTENDUE", message: "Le serveur ne répond pas." });
    const html = await rendre({ q: "dupont" });
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="search"');
    expect(html).toContain('<a href="/equipe/demandes"');
    expect(html).toContain(">Effacer les filtres</a>");
    expect(html).toContain(">Réessayer</button>");
  });

  it("listes illisibles : « Liste indisponible », jamais « introuvable »", async () => {
    lecture.optionsIllisibles = true;
    donner({ ok: true, donnees: { lignes: [ligne(1)], total: 1, page: 1, taillePage: 25 } });
    const html = await rendre({
      categorie: "0b9f2c4e-3d6a-4b1c-9e8f-7a6b5c4d3e2f",
    });
    expect(html.split(">Liste indisponible</option>")).toHaveLength(3);
    expect(html).not.toContain("introuvable");
    // Les choix fixes du responsable restent.
    expect(html).toContain(">Mes demandes</option>");
  });

  it("valeur invalide : ignorée, adresse canonique", async () => {
    donner({ ok: true, donnees: { lignes: [ligne(1)], total: 1, page: 1, taillePage: 25 } });
    await expect(rendre({ statut: "fermee", categorie: "abc", priorite: "haute" })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/equipe\/demandes\?priorite=haute;/),
    });
    expect(lecture.filtres).toEqual({ priorite: "haute" });
  });
});
