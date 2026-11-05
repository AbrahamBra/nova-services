import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DetailDemande } from "@/lib/detail-demande";
import { messageErreur } from "@/lib/erreurs";
import type { Resultat } from "@/lib/server/appeler";

// Story 1.6 — états de la page /equipe/demandes/[reference], sans base :
// chargement (squelettes), base injoignable (bandeau « Réessayer »),
// introuvable, détail complet (description en texte, bandeaux d'email,
// « Non renseigné », société absente, lien de retour avec la page).

const lecture = vi.hoisted(() => ({
  resultat: null as unknown,
  reference: null as string | null,
}));

vi.mock("@/lib/detail-demande", () => ({
  lireDetail: async (reference: string) => {
    lecture.reference = reference;
    return lecture.resultat;
  },
}));

// Story 2.4 : catégories de la liste « Catégorie », lues avec la session (sans base).
const categories = vi.hoisted(() => ({ resultat: null as unknown, appels: 0 }));

vi.mock("@/lib/categories", () => ({
  lireCategoriesActives: async () => {
    categories.appels++;
    return categories.resultat;
  },
}));

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: Record<string, unknown>) => (
    <a href={String(href)} className={className as string | undefined}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { FournisseurToasts } from "@/components/nova/toasts";
import ChargementDetail from "@/app/equipe/demandes/[reference]/loading";
import PageDetailDemande, { generateMetadata } from "@/app/equipe/demandes/[reference]/page";

const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";
const CATEGORIE = "0b6c1f7e-0000-4000-8000-0000000000c1";

function detail(modifs: Partial<DetailDemande> = {}): DetailDemande {
  return {
    id: "id-42",
    reference: "NOVA-2026-0042",
    creeLe: "2026-11-03T07:47:00Z",
    canal: "formulaire",
    nom: "Sophie Garnier",
    email: "sophie.garnier@example.com",
    telephone: "06 12 34 56 78",
    societe: "Atelier Garnier Architectes",
    objet: "Impression impossible depuis la mise à jour",
    description: "Ligne 1\n<script>alert('piège')</script>\nLigne 3",
    categorieId: CATEGORIE,
    statut: "en_cours",
    priorite: "haute",
    responsableId: KARIM,
    etatEmail: "envoye",
    historique: [
      {
        id: "1",
        creeLe: "2026-11-03T07:47:00Z",
        auteurType: "demandeur",
        auteurId: null,
        type: "creation",
        ancienneValeur: null,
        nouvelleValeur: "formulaire",
      },
    ],
    nomsMembres: { [KARIM]: "Karim Benali" },
    nomsCategories: { [CATEGORIE]: "Problème technique" },
    lignesIllisibles: 0,
    // Story 2.2 : notes internes.
    notes: [],
    notesIllisibles: 0,
    ...modifs,
  };
}

function donner(resultat: Resultat<DetailDemande | null>) {
  lecture.resultat = resultat;
}

async function rendre(reference: string, parametres: Record<string, string> = {}): Promise<string> {
  const element = await PageDetailDemande({
    params: Promise.resolve({ reference }),
    searchParams: Promise.resolve(parametres),
  } as unknown as PageProps<"/equipe/demandes/[reference]">);
  // Les toasts (story 2.1) sont fournis par la mise en page de l'espace équipe.
  return renderToStaticMarkup(<FournisseurToasts>{element}</FournisseurToasts>);
}

const CATEGORIES_LISIBLES = {
  ok: true,
  donnees: {
    actives: [
      { id: "0b6c1f7e-0000-4000-8000-0000000000c0", nom: "Demande d'information" },
      { id: CATEGORIE, nom: "Problème technique" },
    ],
    actuelle: { id: CATEGORIE, nom: "Problème technique", actif: true },
  },
};

beforeEach(() => {
  lecture.resultat = null;
  lecture.reference = null;
  categories.resultat = CATEGORIES_LISIBLES;
  categories.appels = 0;
});

describe("page /equipe/demandes/[reference] — états", () => {
  it("chargement : squelette des blocs", () => {
    const html = renderToStaticMarkup(<ChargementDetail />);
    expect(html.match(/data-squelette="bloc"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('role="status"');
  });

  it("base injoignable : bandeau « Le serveur ne répond pas » et « Réessayer »", async () => {
    donner({ ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") });
    const html = await rendre("NOVA-2026-0042");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Le serveur ne répond pas.");
    expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
    expect(html).not.toContain("Description");
  });

  it("introuvable : « Demande introuvable. » et lien vers la liste", async () => {
    donner({ ok: true, donnees: null });
    const html = await rendre("abc");
    expect(lecture.reference).toBe("abc");
    expect(html).toContain("Demande introuvable.");
    expect(html).toContain('href="/equipe/demandes"');
    // Story 2.4 : les catégories ne sont lues que pour une demande trouvée.
    expect(categories.appels).toBe(0);
  });

  it("détail complet : en-tête, badges, « Reçue le … via Formulaire », demandeur, historique", async () => {
    donner({ ok: true, donnees: detail() });
    const html = await rendre("NOVA-2026-0042", { page: "2" });
    expect(lecture.reference).toBe("NOVA-2026-0042");
    expect(html).toContain("NOVA-2026-0042");
    expect(html).toContain("Impression impossible depuis la mise à jour");
    expect(html).toMatch(/data-statut="en_cours"[^>]*>En cours</);
    expect(html).toMatch(/data-priorite="haute"[^>]*>Haute</);
    expect(html).toContain("Reçue le 03/11/2026 à 08:47 via Formulaire");
    expect(html).toContain("Atelier Garnier Architectes");
    expect(html).toContain('href="mailto:sophie.garnier@example.com"');
    expect(html).toContain('href="tel:0612345678"');
    expect(html).toContain("Karim Benali");
    expect(html).toContain("Problème technique");
    expect(html).toContain("<b class=\"font-semibold\">Demandeur (formulaire)</b> a créé la demande");
    // Retour à la même page de la liste.
    expect(html).toContain('href="/equipe/demandes?page=2"');
    expect(html).toContain("← Retour aux demandes");
    // Email envoyé : aucun bandeau ; demande En cours : seuls le bouton des
    // notes internes (story 2.2) et « Marquer comme traitée » (story 2.3).
    expect(html).not.toContain('data-testid="bandeau-email"');
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).toMatch(/<button\b[^>]*>Marquer comme traitée<\/button>/);
    expect(html).toMatch(/<button\b[^>]*>Ajouter la note<\/button>/);
  });

  it("description : texte échappé, retours à la ligne conservés", async () => {
    donner({ ok: true, donnees: detail() });
    const html = await rendre("NOVA-2026-0042");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&#x27;piège&#x27;)&lt;/script&gt;");
    expect(html).toContain("Ligne 1\n&lt;script&gt;");
    expect(html).toMatch(/data-testid="description"[^>]*whitespace-pre-wrap/);
  });

  it("sans téléphone ni société ni responsable : « Non renseigné », pas de ligne Société, « Aucun »", async () => {
    donner({ ok: true, donnees: detail({ telephone: null, societe: null, responsableId: null }) });
    const html = await rendre("NOVA-2026-0042");
    expect(html).toContain("Non renseigné");
    expect(html).not.toContain("Société");
    expect(html).not.toContain("tel:");
    expect(html).toContain(">Aucun<");
  });

  it.each([
    ["non_envoye_demo", "Email non envoyé (mode démonstration)"],
    ["echec", "Email de confirmation non envoyé"],
  ] as const)("email %s : bandeau « %s »", async (etatEmail, texte) => {
    donner({ ok: true, donnees: detail({ etatEmail }) });
    const html = await rendre("NOVA-2026-0042");
    expect(html).toMatch(new RegExp(`data-testid="bandeau-email"[^>]*>${texte.replace(/[()]/g, "\\$&")}<`));
  });

  it("titre : la référence, ou « Demande introuvable »", async () => {
    const titre = async (reference: string) =>
      (
        await generateMetadata({
          params: Promise.resolve({ reference }),
          searchParams: Promise.resolve({}),
        } as unknown as PageProps<"/equipe/demandes/[reference]">)
      ).title;
    donner({ ok: true, donnees: detail() });
    expect(await titre("NOVA-2026-0042")).toBe("NOVA-2026-0042 — Nova Services");
    donner({ ok: true, donnees: null });
    expect(await titre("abc")).toBe("Demande introuvable — Nova Services");
  });

  it("mailto : adresse encodée ; téléphone sans chiffre : texte simple, sans lien", async () => {
    donner({ ok: true, donnees: detail({ email: "a&b?c@example.com", telephone: "voir email" }) });
    const html = await rendre("NOVA-2026-0042");
    expect(html).toContain('href="mailto:a%26b%3Fc@example.com"');
    expect(html).not.toContain("tel:");
    expect(html).toContain("voir email");
  });

  it("lignes d'historique illisibles : signalées sous l'historique", async () => {
    donner({ ok: true, donnees: detail({ historique: [], lignesIllisibles: 2 }) });
    const html = await rendre("NOVA-2026-0042");
    expect(html).toMatch(/data-testid="historique-illisibles"[^>]*>2 événements illisibles</);
    expect(html).not.toContain("Aucun événement.");
  });

  it.each(["en_attente", "sans_email"] as const)("email %s : aucun bandeau", async (etatEmail) => {
    donner({ ok: true, donnees: detail({ etatEmail }) });
    expect(await rendre("NOVA-2026-0042")).not.toContain('data-testid="bandeau-email"');
  });

  it.each([
    ["illisibles", { ok: false, code: "ERREUR_INATTENDUE", message: "x" }],
    ["vides", { ok: true, donnees: { actives: [], actuelle: null } }],
  ])("catégories %s : nom seul et « Liste des catégories indisponible. », sans liste", async (_cas, resultat) => {
    categories.resultat = resultat;
    donner({ ok: true, donnees: detail() });
    const html = await rendre("NOVA-2026-0042");
    expect(categories.appels).toBe(1);
    expect(html).toContain("Problème technique");
    expect(html).toMatch(/data-testid="categories-indisponibles"[^>]*>Liste des catégories indisponible\.</);
    expect(html).not.toContain('data-testid="choix-categorie"');
    expect(html).toContain('data-testid="choix-priorite"');
  });

  it("listes libellées par les <dt> du panneau (aria-labelledby)", async () => {
    donner({ ok: true, donnees: detail() });
    const html = await rendre("NOVA-2026-0042");
    expect(html).toMatch(/<dt id="libelle-priorite"[^>]*>Priorité<\/dt>/);
    expect(html).toMatch(/<dt id="libelle-categorie"[^>]*>Catégorie<\/dt>/);
    expect(html).toMatch(/<select[^>]*aria-labelledby="libelle-priorite"/);
    expect(html).toMatch(/<select[^>]*aria-labelledby="libelle-categorie"/);
  });
});
