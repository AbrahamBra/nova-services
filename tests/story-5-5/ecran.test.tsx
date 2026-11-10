import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Story 5.5 — écran sans base : bloc « Demandes expirées » de la page
// /equipe/admin/donnees (sous le bloc d'effacement ; « N demandes sont
// traitées depuis plus de [durée]. » et « Supprimer les demandes expirées »,
// désactivé avec « Aucune demande expirée. » à 0, ou si le nombre n'a pas
// pu être lu), squelette, textes au singulier et au pluriel, lecture de la
// réponse de `compter_expirees()`, message EXPIREES_CHANGEES, phrase du
// journal et clés. La fenêtre de confirmation est vérifiée dans le
// navigateur (tests/story-5-5/expirees.spec.ts).

const etat = vi.hoisted(() => ({
  admin: true,
  expirees: { ok: true, donnees: { nombre: 12, dureeMois: 24 } } as unknown,
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

vi.mock("@/lib/actions/donnees", () => ({
  chercherDemandesDemandeur: vi.fn(),
  effacerDemandeur: vi.fn(),
  purgerExpirees: vi.fn(),
}));

vi.mock("@/lib/expirees", () => ({
  lireExpirees: vi.fn(async () => etat.expirees),
}));

vi.mock("next/navigation", async (importer) => ({
  ...(await importer<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import PageDonnees from "@/app/equipe/admin/donnees/page";
import ChargementDonnees from "@/app/equipe/admin/donnees/loading";
import {
  DemandesExpirees,
  TEXTE_EXPIREES_ILLISIBLES,
  etatApresPurge,
  etatInitial,
  peutSupprimer,
  type EtatExpirees,
} from "@/components/nova/donnees/demandes-expirees";
import { FournisseurToasts } from "@/components/nova/toasts";
import { lireExpirees } from "@/lib/expirees";
import { messageErreur } from "@/lib/erreurs";
import { CLES_DETAILS_JOURNAL, TYPE_EVENEMENT_JOURNAL, clesJournalValides, descriptionJournal } from "@/lib/journal";
import {
  NOMBRE_EXPIREES_MAX,
  lireReponseExpirees,
  schemaNombreExpirees,
  texteConfirmationPurge,
  texteDemandesSupprimees,
  texteExpirees,
} from "@/lib/schemas/donnees";

function rendu(element: React.ReactNode): string {
  return renderToStaticMarkup(<FournisseurToasts>{element}</FournisseurToasts>);
}

function texte(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

const BOUTON = /<button[^>]*>Supprimer les demandes expirées<\/button>/;
const BOUTON_DESACTIVE = /<button[^>]*disabled=""[^>]*>Supprimer les demandes expirées<\/button>/;

beforeEach(() => {
  etat.admin = true;
  etat.expirees = { ok: true, donnees: { nombre: 12, dureeMois: 24 } };
  vi.mocked(lireExpirees).mockClear();
});

describe("page /equipe/admin/donnees : bloc « Demandes expirées »", () => {
  it("sous le bloc d'effacement : « 12 demandes sont traitées depuis plus de 2 ans. », bouton actif", async () => {
    const html = rendu(await PageDonnees());
    const t = texte(html);
    expect(t.indexOf("Droit à l'effacement")).toBeGreaterThan(-1);
    expect(t.indexOf("Demandes expirées")).toBeGreaterThan(t.indexOf("Droit à l'effacement"));
    expect(html).toMatch(/<h2[^>]*>Demandes expirées<\/h2>/);
    expect(t).toContain("12 demandes sont traitées depuis plus de 2 ans.");
    expect(html).toMatch(BOUTON);
    expect(html).not.toMatch(BOUTON_DESACTIVE);
    expect(lireExpirees).toHaveBeenCalledTimes(1);
  });

  it("aucune : « Aucune demande expirée. », bouton désactivé", async () => {
    etat.expirees = { ok: true, donnees: { nombre: 0, dureeMois: 24 } };
    const html = rendu(await PageDonnees());
    expect(texte(html)).toContain("Aucune demande expirée.");
    expect(html).toMatch(BOUTON_DESACTIVE);
  });

  it("nombre illisible : message, bouton désactivé", async () => {
    etat.expirees = { ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") };
    const html = rendu(await PageDonnees());
    expect(texte(html)).toContain(TEXTE_EXPIREES_ILLISIBLES);
    expect(html).toMatch(BOUTON_DESACTIVE);
  });

  it("collaborateur : accès refusé, rien n'est lu", async () => {
    etat.admin = false;
    const html = rendu(await PageDonnees());
    expect(texte(html)).toContain("Vous n'avez pas accès à cette page.");
    expect(html).not.toContain("Demandes expirées");
    expect(lireExpirees).not.toHaveBeenCalled();
  });

  it("chargement : un squelette pour chaque bloc", () => {
    const html = rendu(<ChargementDonnees />);
    expect(html).toContain('data-testid="squelette-donnees"');
    expect(html).toContain('data-testid="squelette-expirees"');
  });

  it("durée réglée à 3 ans : suivie par le texte", () => {
    const html = rendu(<DemandesExpirees initiales={{ nombre: 1, dureeMois: 36 }} />);
    expect(texte(html)).toContain("1 demande est traitée depuis plus de 3 ans.");
    expect(html).toMatch(BOUTON);
  });
});

describe("textes", () => {
  it("bloc, confirmation et toast au singulier et au pluriel", () => {
    expect(texteExpirees({ nombre: 12, dureeMois: 24 })).toBe("12 demandes sont traitées depuis plus de 2 ans.");
    expect(texteExpirees({ nombre: 1, dureeMois: 18 })).toBe("1 demande est traitée depuis plus de 18 mois.");
    expect(texteExpirees({ nombre: 0, dureeMois: 24 })).toBe("Aucune demande expirée.");
    expect(texteConfirmationPurge({ nombre: 12, dureeMois: 24 })).toBe(
      "12 demandes traitées depuis plus de 2 ans vont être supprimées définitivement, avec leur historique et leurs notes. Cette action ne peut pas être annulée.",
    );
    expect(texteConfirmationPurge({ nombre: 1, dureeMois: 12 })).toBe(
      "1 demande traitée depuis plus de 1 an va être supprimée définitivement, avec son historique et ses notes. Cette action ne peut pas être annulée.",
    );
    expect(texteDemandesSupprimees(12)).toBe("12 demandes supprimées.");
    expect(texteDemandesSupprimees(1)).toBe("1 demande supprimée.");
  });

  it("nombre changé : message prévu", () => {
    expect(messageErreur("EXPIREES_CHANGEES")).toBe(
      "Le nombre de demandes expirées a changé. Vérifiez-le avant de supprimer.",
    );
  });
});

describe("lecture de compter_expirees()", () => {
  it("réponse valide", () => {
    expect(lireReponseExpirees({ nombre: 4, duree_mois: 24 })).toEqual({ nombre: 4, dureeMois: 24 });
    expect(lireReponseExpirees({ nombre: 0, duree_mois: 6 })).toEqual({ nombre: 0, dureeMois: 6 });
  });

  it.each([
    ["null", null],
    ["liste", [4, 24]],
    ["nombre négatif", { nombre: -1, duree_mois: 24 }],
    ["nombre décimal", { nombre: 1.5, duree_mois: 24 }],
    ["durée nulle", { nombre: 4, duree_mois: 0 }],
    ["durée en texte", { nombre: 4, duree_mois: "24" }],
  ])("%s : null", (_cas, valeur) => {
    expect(lireReponseExpirees(valeur)).toBeNull();
  });
});

describe("journal : expirees_supprimees", () => {
  it("phrase au pluriel et au singulier, avec la durée", () => {
    expect(descriptionJournal({ evenement: "expirees_supprimees", nombre: 12, duree_mois: 24 })).toBe(
      "12 demandes expirées supprimées (traitées depuis plus de 2 ans)",
    );
    expect(descriptionJournal({ evenement: "expirees_supprimees", nombre: 1, duree_mois: 24 })).toBe(
      "1 demande expirée supprimée (traitée depuis plus de 2 ans)",
    );
    expect(descriptionJournal({ evenement: "expirees_supprimees", nombre: 3, duree_mois: 18 })).toBe(
      "3 demandes expirées supprimées (traitées depuis plus de 18 mois)",
    );
    expect(descriptionJournal({ evenement: "expirees_supprimees", nombre: "x", duree_mois: null })).toBe(
      "Demandes expirées supprimées",
    );
  });

  it("type « donnees », clés exactes : evenement, nombre, duree_mois", () => {
    expect(TYPE_EVENEMENT_JOURNAL.expirees_supprimees).toBe("donnees");
    expect(CLES_DETAILS_JOURNAL.expirees_supprimees).toEqual(["evenement", "nombre", "duree_mois"]);
    expect(clesJournalValides("expirees_supprimees", ["evenement", "nombre", "duree_mois"])).toBe(true);
    expect(clesJournalValides("expirees_supprimees", ["evenement", "nombre", "duree_mois", "reference"])).toBe(
      false,
    );
    expect(clesJournalValides("expirees_supprimees", ["evenement", "nombre"])).toBe(false);
  });
});

describe("après la confirmation (etatApresPurge)", () => {
  const DOUZE: EtatExpirees = etatInitial({ nombre: 12, dureeMois: 24 });
  const refus = (code: Parameters<typeof messageErreur>[0]) =>
    ({ ok: false, code, message: messageErreur(code) }) as const;
  /** Bandeau attendu pour ce code. */
  const bandeau = (code: Parameters<typeof messageErreur>[0]) => ({ code, message: messageErreur(code) });

  it("succès : toast « 12 demandes supprimées. », « Aucune demande expirée. », bouton désactivé, focus sur le texte", () => {
    const issue = etatApresPurge(DOUZE, { ok: true, donnees: { nombre: 12 } });
    expect(issue).toEqual({
      etat: { expirees: { nombre: 0, dureeMois: 24 }, erreur: null, incertain: false },
      toast: "12 demandes supprimées.",
      focus: "texte",
    });
    expect(texteExpirees(issue.etat.expirees!)).toBe("Aucune demande expirée.");
    expect(peutSupprimer(issue.etat, false)).toBe(false);
    expect(etatApresPurge(DOUZE, { ok: true, donnees: { nombre: 1 } }).toast).toBe("1 demande supprimée.");
  });

  it("succès après un bandeau : bandeau retiré", () => {
    const avecBandeau = { ...DOUZE, erreur: bandeau("EXPIREES_CHANGEES") };
    expect(etatApresPurge(avecBandeau, { ok: true, donnees: { nombre: 12 } }).etat.erreur).toBeNull();
  });

  it("nombre changé et relu : nouveau nombre, bandeau, bouton toujours utilisable, aucun toast", () => {
    const issue = etatApresPurge(DOUZE, {
      ...refus("EXPIREES_CHANGEES"),
      expirees: { nombre: 13, dureeMois: 24 },
    });
    expect(issue).toEqual({
      etat: {
        expirees: { nombre: 13, dureeMois: 24 },
        erreur: bandeau("EXPIREES_CHANGEES"),
        incertain: false,
      },
      toast: null,
      focus: "bandeau",
    });
    expect(issue.etat.erreur?.message).toBe(
      "Le nombre de demandes expirées a changé. Vérifiez-le avant de supprimer.",
    );
    expect(peutSupprimer(issue.etat, false)).toBe(true);
  });

  it("nombre changé, relu à 0 : bouton désactivé", () => {
    const issue = etatApresPurge(DOUZE, {
      ...refus("EXPIREES_CHANGEES"),
      expirees: { nombre: 0, dureeMois: 24 },
    });
    expect(peutSupprimer(issue.etat, false)).toBe(false);
  });

  it.each([["EXPIREES_CHANGEES"], ["ACCES_REFUSE"], ["DONNEES_INVALIDES"]] as const)(
    "%s sans nouveau nombre (rien n'a été supprimé) : bandeau, nombre et bouton inchangés",
    (code) => {
      const issue = etatApresPurge(DOUZE, refus(code));
      expect(issue).toEqual({
        etat: { ...DOUZE, erreur: bandeau(code), incertain: false },
        toast: null,
        focus: "bandeau",
      });
      expect(peutSupprimer(issue.etat, false)).toBe(true);
    },
  );

  it("erreur imprévue : bandeau, « La suppression a peut-être eu lieu… », bouton désactivé", () => {
    const issue = etatApresPurge(DOUZE, refus("ERREUR_INATTENDUE"));
    expect(issue).toEqual({
      etat: { ...DOUZE, erreur: bandeau("ERREUR_INATTENDUE"), incertain: true },
      toast: null,
      focus: "bandeau",
    });
    expect(peutSupprimer(issue.etat, false)).toBe(false);
  });

  it("action qui lève une exception : comme une erreur imprévue", () => {
    expect(etatApresPurge(DOUZE, null)).toEqual(etatApresPurge(DOUZE, refus("ERREUR_INATTENDUE")));
  });

  it("bouton : désactivé pendant l'envoi (pas de double envoi), à 0, nombre illisible ou après une erreur imprévue", () => {
    expect(peutSupprimer(DOUZE, false)).toBe(true);
    expect(peutSupprimer(DOUZE, true)).toBe(false);
    expect(peutSupprimer(etatInitial({ nombre: 0, dureeMois: 24 }), false)).toBe(false);
    expect(peutSupprimer(etatInitial(null), false)).toBe(false);
    expect(peutSupprimer({ ...DOUZE, incertain: true }, false)).toBe(false);
  });

  it("texte du nombre sans zone annoncée (toast et bandeau annoncent déjà le résultat)", () => {
    const html = rendu(<DemandesExpirees initiales={{ nombre: 12, dureeMois: 24 }} />);
    const paragraphe = html.match(/<p[^>]*data-testid="nombre-expirees"[^>]*>/)?.[0] ?? "";
    expect(paragraphe).not.toBe("");
    expect(paragraphe).not.toContain("aria-live");
  });
});

describe("nombre envoyé à la purge (schemaNombreExpirees)", () => {
  it("entier SQL de 1 à 2 147 483 647", () => {
    expect(NOMBRE_EXPIREES_MAX).toBe(2147483647);
    expect(schemaNombreExpirees.safeParse(1).success).toBe(true);
    expect(schemaNombreExpirees.safeParse(2147483647).success).toBe(true);
    expect(schemaNombreExpirees.safeParse(2147483648).success).toBe(false);
    expect(schemaNombreExpirees.safeParse(0).success).toBe(false);
  });
});
