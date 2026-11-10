import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TypeJournal } from "@/lib/domaine";
import type { LigneJournal, PageJournal as DonneesJournal } from "@/lib/journal";
import type { Resultat } from "@/lib/server/appeler";

// Story 5.1 — page /equipe/admin/journal sans base : tableau Date · Type ·
// Description · Par (et cartes), « Système », filtre « Tous » + 6 types,
// type et page lus dans l'adresse, adresse non canonique redirigée, vide,
// bandeau d'erreur avec « Réessayer », collaborateur refusé.

const etat = vi.hoisted(() => ({
  admin: true,
  resultat: null as unknown,
  type: null as TypeJournal | undefined | null,
  page: null as number | null,
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

vi.mock("@/lib/journal", async (importer) => ({
  ...(await importer<typeof import("@/lib/journal")>()),
  lireJournal: async (type: TypeJournal | undefined, page: number) => {
    etat.type = type;
    etat.page = page;
    return etat.resultat;
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...reste }: Record<string, unknown>) => (
    <a
      href={String(href)}
      className={className as string | undefined}
      aria-current={reste["aria-current"] as "true" | undefined}
    >
      {children as React.ReactNode}
    </a>
  ),
}));

import PageJournal, { generateMetadata } from "@/app/equipe/admin/journal/page";

const LIGNES: LigneJournal[] = [
  {
    id: 3,
    creeLe: "2026-11-03T08:12:00Z",
    type: "compte",
    auteurType: "membre",
    auteurNom: "Claire Roux",
    details: { evenement: "compte_cree", membre_id: "x", nom: "Léo Martin", role: "collaborateur" },
  },
  {
    id: 2,
    creeLe: "2026-11-03T07:00:00Z",
    type: "email",
    auteurType: "systeme",
    auteurNom: null,
    details: { evenement: "echec_confirmation", reference: "NOVA-2026-0042", code: "delai_depasse" },
  },
];

async function rendre(parametres: Record<string, string | string[]> = {}): Promise<string> {
  const element = await PageJournal({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(parametres),
  } as unknown as PageProps<"/equipe/admin/journal">);
  return renderToStaticMarkup(element);
}

function donner(resultat: Resultat<DonneesJournal>) {
  etat.resultat = resultat;
}

beforeEach(() => {
  etat.admin = true;
  etat.resultat = null;
  etat.type = null;
  etat.page = null;
});

describe("page /equipe/admin/journal", () => {
  it("titre de l'onglet « Journal », ou « Accès refusé » pour un collaborateur", async () => {
    expect((await generateMetadata()).title).toBe("Journal — Nova Services");
    etat.admin = false;
    expect((await generateMetadata()).title).toBe("Accès refusé — Nova Services");
  });

  it("tableau Date · Type · Description · Par, cartes, « Système »", async () => {
    donner({ ok: true, donnees: { lignes: LIGNES, total: 2, page: 1, taillePage: 50 } });
    const html = await rendre();
    expect(etat.type).toBeUndefined();
    expect(etat.page).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Journal<\/h1>/);
    const entetes = [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map(([, t]) => t);
    expect(entetes).toEqual(["Date", "Type", "Description", "Par"]);
    expect(html).toContain("03/11/2026 à 09:12");
    expect(html).toContain("Compte créé : Léo Martin (Collaborateur)");
    expect(html).toContain("Email de confirmation non envoyé pour NOVA-2026-0042 (code : delai_depasse)");
    expect(html).toContain(">Système<");
    expect(html).toContain("Par Système");
    expect(html).toContain(">Claire Roux<");
    // Deux vues (tableau et cartes) : chaque ligne apparaît deux fois, dans l'ordre reçu.
    expect(html.match(/data-journal="3"/g)).toHaveLength(2);
    expect(html.indexOf('data-journal="3"')).toBeLessThan(html.indexOf('data-journal="2"'));
    // Jamais de JSON brut.
    expect(html).not.toContain("evenement");
    // Tout tient sur une page : pas de pagination.
    expect(html).not.toContain('aria-label="Pagination"');
  });

  it("filtre : « Tous » et les six types, le choix courant marqué", async () => {
    donner({ ok: true, donnees: { lignes: [LIGNES[0]], total: 1, page: 1, taillePage: 50 } });
    const html = await rendre({ type: "compte" });
    expect(etat.type).toBe("compte");
    const liens = [...html.matchAll(/<a href="([^"]+)"[^>]*>(Tous|Compte|Paramètre|Catégorie|Données|Email|Connexion)<\/a>/g)]
      .map(([, href, libelle]) => [libelle, href.replaceAll("&amp;", "&")]);
    expect(liens).toEqual([
      ["Tous", "/equipe/admin/journal"],
      ["Compte", "/equipe/admin/journal?type=compte"],
      ["Paramètre", "/equipe/admin/journal?type=parametre"],
      ["Catégorie", "/equipe/admin/journal?type=categorie"],
      ["Données", "/equipe/admin/journal?type=donnees"],
      ["Email", "/equipe/admin/journal?type=email"],
      ["Connexion", "/equipe/admin/journal?type=connexion"],
    ]);
    expect(html).toMatch(/<a href="\/equipe\/admin\/journal\?type=compte"[^>]*aria-current="true"[^>]*>Compte<\/a>/);
    expect(html).not.toMatch(/aria-current="true"[^>]*>Tous</);
  });

  it("pagination de 50 : « 51–51 sur 51 », liens avec le type", async () => {
    donner({ ok: true, donnees: { lignes: [LIGNES[0]], total: 51, page: 2, taillePage: 50 } });
    const html = await rendre({ type: "compte", page: "2" });
    expect(etat.page).toBe(2);
    expect(html).toContain("51–51 sur 51");
    expect(html).toContain('href="/equipe/admin/journal?type=compte"');
    expect(html).toMatch(/>Précédent</);
  });

  it("type inconnu : ignoré, adresse ramenée à sa forme canonique", async () => {
    donner({ ok: true, donnees: { lignes: LIGNES, total: 2, page: 1, taillePage: 50 } });
    await expect(rendre({ type: "xyz" })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/equipe\/admin\/journal;/),
    });
    expect(etat.type).toBeUndefined();
  });

  it("page au-delà de la fin : redirigée vers la page lue", async () => {
    donner({ ok: true, donnees: { lignes: [LIGNES[0]], total: 51, page: 2, taillePage: 50 } });
    await expect(rendre({ type: "compte", page: "9" })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/equipe\/admin\/journal\?type=compte&page=2;/),
    });
  });

  it("vide : « Aucun événement. », le filtre reste", async () => {
    donner({ ok: true, donnees: { lignes: [], total: 0, page: 1, taillePage: 50 } });
    const html = await rendre({ type: "parametre" });
    expect(html).toContain("Aucun événement.");
    expect(html).not.toContain("<table");
    expect(html).toContain('aria-label="Filtrer par type"');
  });

  it("erreur : bandeau role=alert et « Réessayer »", async () => {
    donner({ ok: false, code: "ERREUR_INATTENDUE", message: "Le serveur ne répond pas." });
    const html = await rendre();
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("<table");
  });

  it("collaborateur : accès refusé, journal jamais lu", async () => {
    etat.admin = false;
    const html = await rendre();
    expect(html).toContain("Vous n&#x27;avez pas accès à cette page.");
    expect(etat.page).toBeNull();
  });

  it("refus de la base (rôle changé entre-temps) : accès refusé", async () => {
    donner({ ok: false, code: "DROIT_INSUFFISANT", message: "Vous n'avez pas le droit de faire cette action." });
    const html = await rendre();
    expect(html).toContain("Vous n&#x27;avez pas accès à cette page.");
    expect(html).not.toContain('role="alert"');
  });
});
