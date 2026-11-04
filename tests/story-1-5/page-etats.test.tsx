import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LigneDemande, PageDemandes as DonneesPage } from "@/lib/demandes";
import type { Resultat } from "@/lib/server/appeler";
import { messageErreur } from "@/lib/erreurs";

// Story 1.5 — états de la page /equipe/demandes (UX-DR4), sans base :
// chargement (8 lignes squelettes), base injoignable (bandeau « Réessayer »),
// aucune demande (message d'état vide), et liste avec badges.
// La lecture est simulée : la page reçoit ce que renverrait lib/demandes.ts.

const lecture = vi.hoisted(() => ({
  resultat: null as unknown,
  pageDemandee: null as number | null,
}));

vi.mock("@/lib/demandes", () => ({
  lireDemandes: async (page: number) => {
    lecture.pageDemandee = page;
    return lecture.resultat;
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: Record<string, unknown>) => (
    <a href={String(href)} className={className as string | undefined}>
      {children as React.ReactNode}
    </a>
  ),
}));

import ChargementDemandes from "@/app/equipe/demandes/loading";
import PageDemandes from "@/app/equipe/demandes/page";

function ligne(i: number, modifs: Partial<LigneDemande> = {}): LigneDemande {
  return {
    id: `id-${i}`,
    reference: `NOVA-2026-${String(i).padStart(4, "0")}`,
    creeLe: "2026-11-03T08:12:00Z",
    nom: "Sophie Garnier",
    societe: "Atelier Garnier",
    objet: `Objet ${i}`,
    categorie: "Problème technique",
    canal: "formulaire",
    statut: "nouvelle",
    priorite: "normale",
    responsable: null,
    ...modifs,
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
  lecture.resultat = null;
  lecture.pageDemandee = null;
});

describe("page /equipe/demandes — états", () => {
  it("chargement : 8 lignes squelettes (et 8 cartes sur téléphone)", () => {
    const html = renderToStaticMarkup(<ChargementDemandes />);
    expect(html.match(/data-squelette="ligne"/g)).toHaveLength(8);
    expect(html.match(/data-squelette="carte"/g)).toHaveLength(8);
    expect(html).toContain('role="status"');
  });

  it("base injoignable : bandeau « Le serveur ne répond pas » et « Réessayer »", async () => {
    donner({ ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") });
    const html = await rendre();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Le serveur ne répond pas.");
    expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
    expect(html).not.toContain("<table");
  });

  it("aucune demande : message d'état vide, sans tableau ni pagination", async () => {
    donner({ ok: true, donnees: { lignes: [], total: 0, page: 1, taillePage: 25 } });
    const html = await rendre();
    expect(html).toContain(
      "Aucune demande pour l&#x27;instant. Partagez le lien du formulaire à vos clients.",
    );
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Précédent");
  });

  it("liste : badges avec le mot, « — » sans responsable, lien vers le détail, pagination", async () => {
    donner({
      ok: true,
      donnees: {
        lignes: [
          ligne(42, { statut: "en_cours", priorite: "haute", responsable: "Karim Benali" }),
          ligne(41, { statut: "traitee", priorite: "basse", canal: "telephone", societe: null }),
        ],
        total: 40,
        page: 2,
        taillePage: 25,
      },
    });
    const html = await rendre({ page: "2" });
    expect(lecture.pageDemandee).toBe(2);
    expect(html).toContain("40 demandes");
    expect(html).toMatch(/data-statut="en_cours"[^>]*>En cours</);
    expect(html).toMatch(/data-statut="traitee"[^>]*>Traitée</);
    expect(html).toMatch(/data-priorite="haute"[^>]*>Haute</);
    expect(html).toMatch(/data-priorite="basse"[^>]*>Basse</);
    expect(html).toContain("Karim Benali");
    expect(html).toContain("—");
    expect(html).toContain("Téléphone");
    expect(html).toContain("03/11/2026 à 09:12");
    // Story 1.6 : la page de la liste est transmise au détail (retour).
    expect(html).toContain('href="/equipe/demandes/NOVA-2026-0042?page=2"');
    expect(html).toContain("26–40 sur 40");
    expect(html).toContain('href="/equipe/demandes"');
    expect(html).toMatch(/role="link" aria-disabled="true"[^>]*>Suivant</);
  });

  it("une page invalide est demandée comme la page 1", async () => {
    donner({ ok: true, donnees: { lignes: [], total: 0, page: 1, taillePage: 25 } });
    await expect(rendre({ page: "abc" })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/equipe\/demandes;/),
    });
    expect(lecture.pageDemandee).toBe(1);
  });

  it("une page au-delà de la fin redirige vers l'adresse de la dernière page", async () => {
    donner({ ok: true, donnees: { lignes: [ligne(1)], total: 40, page: 2, taillePage: 25 } });
    await expect(rendre({ page: "99" })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/equipe\/demandes\?page=2;/),
    });
    expect(lecture.pageDemandee).toBe(99);
  });

  it("tout tient sur une page : pas de pagination ; tableau nommé « Demandes »", async () => {
    donner({ ok: true, donnees: { lignes: [ligne(1)], total: 1, page: 1, taillePage: 25 } });
    const html = await rendre();
    expect(html).toContain('<table aria-label="Demandes"');
    expect(html).not.toContain("Précédent");
    expect(html).not.toContain("1–1 sur 1");
  });
});
