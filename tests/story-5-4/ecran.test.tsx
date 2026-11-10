import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Story 5.4 — écran sans base : page /equipe/admin/donnees (bloc « Droit à
// l'effacement », champ et bouton, aucun résultat au départ, formulaire
// jamais envoyé par l'adresse, collaborateur refusé), résultat d'une
// recherche (liste Référence · Date · Objet · Statut avec lien vers le
// détail, « Effacer ces N demandes », « Aucune demande avec cet email. »),
// textes au singulier et au pluriel, schéma de l'email, lecture de la
// réponse de `chercher_demandes_demandeur()`, phrase du journal et clés.
// La recherche, la fenêtre et l'effacement sont vérifiés dans le navigateur
// (tests/story-5-4/donnees.spec.ts).

const etat = vi.hoisted(() => ({ admin: true }));

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

vi.mock("@/lib/actions/donnees", () => ({
  chercherDemandesDemandeur: vi.fn(),
  effacerDemandeur: vi.fn(),
}));

vi.mock("next/navigation", async (importer) => ({
  ...(await importer<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import PageDonnees, { generateMetadata } from "@/app/equipe/admin/donnees/page";
import ChargementDonnees from "@/app/equipe/admin/donnees/loading";
import { ResultatRecherche, type Trouvees } from "@/components/nova/donnees/effacement-demandeur";
import { FournisseurToasts } from "@/components/nova/toasts";
import { messageErreur } from "@/lib/erreurs";
import { CLES_DETAILS_JOURNAL, TYPE_EVENEMENT_JOURNAL, clesJournalValides, descriptionJournal } from "@/lib/journal";
import {
  MESSAGES_DONNEES,
  lireReponseDemandesDemandeur,
  texteBoutonEffacer,
  texteConfirmationEffacement,
  texteDemandesEffacees,
  verifierEmailDemandeur,
} from "@/lib/schemas/donnees";

function rendu(element: React.ReactNode): string {
  return renderToStaticMarkup(<FournisseurToasts>{element}</FournisseurToasts>);
}

/** Texte sans balises, entités décodées pour les apostrophes. */
function texte(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

const TROUVEES: Trouvees = {
  email: "jean.dupont@example.com",
  demandes: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      reference: "NOVA-2026-0003",
      creeLe: "2026-11-05T09:12:00+00:00",
      objet: "Devis cuisine",
      statut: "en_cours",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      reference: "NOVA-2026-0002",
      creeLe: "2026-10-20T09:12:00+00:00",
      objet: "Pose de parquet",
      statut: "nouvelle",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      reference: "NOVA-2026-0001",
      creeLe: "2026-10-01T09:12:00+00:00",
      objet: "Ancienne demande",
      statut: "traitee",
    },
  ],
};

beforeEach(() => {
  etat.admin = true;
});

describe("page /equipe/admin/donnees", () => {
  it("titre de l'onglet « Données personnelles », ou « Accès refusé » pour un collaborateur", async () => {
    expect((await generateMetadata()).title).toBe("Données personnelles — Nova Services");
    etat.admin = false;
    expect((await generateMetadata()).title).toBe("Accès refusé — Nova Services");
  });

  it("bloc « Droit à l'effacement » : champ « Email du demandeur », « Rechercher », aucun résultat", async () => {
    const html = rendu(await PageDonnees());
    expect(html).toMatch(/<h1[^>]*>Données personnelles<\/h1>/);
    expect(texte(html)).toContain("Droit à l'effacement");
    expect(html).toMatch(/<label[^>]*>Email du demandeur<\/label>/);
    expect(html).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Rechercher<\/button>/);
    // Jamais envoyé par l'adresse : pas de GET, pas d'action vers une autre page.
    const formulaire = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(formulaire).toMatch(/method="post"/);
    expect(formulaire).not.toMatch(/\saction=/);
    expect(texte(html)).not.toContain(MESSAGES_DONNEES.aucune);
    expect(html).not.toContain("<table");
  });

  it("collaborateur : « Vous n'avez pas accès à cette page. », aucun champ", async () => {
    etat.admin = false;
    const html = rendu(await PageDonnees());
    expect(texte(html)).toContain("Vous n'avez pas accès à cette page.");
    expect(html).not.toContain("Email du demandeur");
  });

  it("chargement : même en-tête, squelette annoncé", () => {
    const html = rendu(<ChargementDonnees />);
    expect(html).toMatch(/<h1[^>]*>Données personnelles<\/h1>/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-testid="squelette-donnees"');
  });
});

describe("résultat d'une recherche", () => {
  it("liste Référence · Date · Objet · Statut, liens vers le détail, badges, « Effacer ces 3 demandes »", () => {
    const html = rendu(<ResultatRecherche trouvees={TROUVEES} apresEffacement={() => {}} />);
    const entetes = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map(([, t]) => t);
    expect(entetes).toEqual(["Référence", "Date", "Objet", "Statut"]);
    // Dans l'ordre reçu (le plus récent d'abord), tableau et cartes.
    const references = [...html.matchAll(/<tr[^>]*data-reference="([^"]+)"/g)].map(([, r]) => r);
    expect(references).toEqual(["NOVA-2026-0003", "NOVA-2026-0002", "NOVA-2026-0001"]);
    expect(html).toContain('href="/equipe/demandes/NOVA-2026-0003"');
    expect(html).toContain('aria-label="Demandes de jean.dupont@example.com"');
    expect(texte(html)).toContain("05/11/2026");
    expect(html).toContain('data-statut="en_cours"');
    expect(html).toContain('data-statut="traitee"');
    expect(texte(html)).toContain("3 demandes trouvées pour jean.dupont@example.com.");
    expect(html).toMatch(/<button[^>]*>Effacer ces 3 demandes<\/button>/);
  });

  it("« Effacer » désactivé pendant une recherche ou après un échec", () => {
    const html = rendu(<ResultatRecherche trouvees={TROUVEES} desactive apresEffacement={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Effacer ces 3 demandes<\/button>/);
  });

  it("une seule demande : « Effacer cette demande »", () => {
    const une: Trouvees = { ...TROUVEES, demandes: TROUVEES.demandes.slice(0, 1) };
    const html = rendu(<ResultatRecherche trouvees={une} apresEffacement={() => {}} />);
    expect(texte(html)).toContain("1 demande trouvée pour jean.dupont@example.com.");
    expect(html).toMatch(/<button[^>]*>Effacer cette demande<\/button>/);
  });

  it("aucune : « Aucune demande avec cet email. », aucun bouton", () => {
    const html = rendu(
      <ResultatRecherche trouvees={{ email: TROUVEES.email, demandes: [] }} apresEffacement={() => {}} />,
    );
    expect(texte(html)).toBe("Aucune demande avec cet email.");
    expect(html).not.toContain("<button");
  });
});

describe("textes", () => {
  it("bouton, confirmation et toast au singulier et au pluriel", () => {
    expect(texteBoutonEffacer(3)).toBe("Effacer ces 3 demandes");
    expect(texteBoutonEffacer(1)).toBe("Effacer cette demande");
    expect(texteConfirmationEffacement(3, "jean.dupont@example.com")).toBe(
      "3 demandes de jean.dupont@example.com vont être effacées définitivement, avec leur historique et leurs notes. Cette action ne peut pas être annulée.",
    );
    expect(texteConfirmationEffacement(1, "jean.dupont@example.com")).toBe(
      "1 demande de jean.dupont@example.com va être effacée définitivement, avec son historique et ses notes. Cette action ne peut pas être annulée.",
    );
    expect(texteDemandesEffacees(3)).toBe("3 demandes effacées.");
    expect(texteDemandesEffacees(1)).toBe("1 demande effacée.");
  });

  it("liste changée : message prévu", () => {
    expect(messageErreur("DEMANDES_CHANGEES")).toBe(
      "La liste a changé depuis votre recherche. Vérifiez-la avant d'effacer.",
    );
  });
});

describe("schéma de l'email", () => {
  it("normalisé (espaces retirés, minuscules)", () => {
    expect(verifierEmailDemandeur("  Jean.Dupont@Example.com ")).toEqual({
      ok: true,
      email: "jean.dupont@example.com",
    });
  });

  it.each([
    ["jean@dupont", MESSAGES_DONNEES.emailInvalide],
    ["jean.dupont.example.com", MESSAGES_DONNEES.emailInvalide],
    ["   ", MESSAGES_DONNEES.emailVide],
    [42, MESSAGES_DONNEES.emailVide],
  ])("« %s » refusé", (saisie, message) => {
    expect(verifierEmailDemandeur(saisie)).toEqual({ ok: false, erreur: message });
  });

  it("même message que les autres formulaires pour un email mal écrit", () => {
    expect(MESSAGES_DONNEES.emailInvalide).toBe("Cette adresse email ne semble pas valide.");
  });
});

describe("lecture de chercher_demandes_demandeur()", () => {
  const LIGNE = {
    id: "22222222-2222-4222-8222-222222222222",
    reference: "NOVA-2026-0003",
    cree_le: "2026-11-05T09:12:00+00:00",
    objet: "Devis cuisine",
    statut: "nouvelle",
  };

  it("liste valide", () => {
    expect(lireReponseDemandesDemandeur([LIGNE])).toEqual([
      {
        id: LIGNE.id,
        reference: LIGNE.reference,
        creeLe: LIGNE.cree_le,
        objet: LIGNE.objet,
        statut: "nouvelle",
      },
    ]);
    expect(lireReponseDemandesDemandeur([])).toEqual([]);
  });

  it.each([
    ["pas une liste", null],
    ["objet", {}],
    ["statut inconnu", [{ ...LIGNE, statut: "close" }]],
    ["date illisible", [{ ...LIGNE, cree_le: "demain" }]],
    ["objet manquant", [{ ...LIGNE, objet: undefined }]],
    ["ligne qui n'est pas un objet", ["NOVA-2026-0003"]],
    ["id qui n'est pas un UUID", [{ ...LIGNE, id: "NOVA-2026-0003" }]],
  ])("%s : null (rien d'affiché ni d'effaçable)", (_cas, valeur) => {
    expect(lireReponseDemandesDemandeur(valeur)).toBeNull();
  });
});

describe("journal : demandeur_efface", () => {
  it("phrase au pluriel et au singulier, jamais d'email", () => {
    expect(descriptionJournal({ evenement: "demandeur_efface", nombre: 3 })).toBe(
      "3 demandes effacées (droit à l'effacement)",
    );
    expect(descriptionJournal({ evenement: "demandeur_efface", nombre: 1 })).toBe(
      "1 demande effacée (droit à l'effacement)",
    );
    expect(descriptionJournal({ evenement: "demandeur_efface", nombre: "x" })).toBe(
      "Demandes effacées (droit à l'effacement)",
    );
  });

  it("type « donnees », clés exactes : evenement et nombre", () => {
    expect(TYPE_EVENEMENT_JOURNAL.demandeur_efface).toBe("donnees");
    expect(CLES_DETAILS_JOURNAL.demandeur_efface).toEqual(["evenement", "nombre"]);
    expect(clesJournalValides("demandeur_efface", ["evenement", "nombre"])).toBe(true);
    expect(clesJournalValides("demandeur_efface", ["evenement", "nombre", "email"])).toBe(false);
    expect(clesJournalValides("demandeur_efface", ["evenement"])).toBe(false);
  });
});
