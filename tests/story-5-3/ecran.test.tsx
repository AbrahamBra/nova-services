import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ParametresAdmin } from "@/lib/parametres-admin";
import type { Resultat } from "@/lib/server/appeler";

// Story 5.3 — écran sans base : page /equipe/admin/parametres (formulaire
// prérempli, liste des durées de 6 mois à 5 ans, aperçu de la phrase du
// formulaire public, bandeau d'erreur avec « Réessayer », collaborateur
// refusé), phrase de conservation partagée avec le formulaire public,
// schéma, lecture de `lire_parametres_admin()`, phrases du journal, clés.
// La mise à jour de l'aperçu pendant la saisie est vérifiée dans le
// navigateur (tests/story-5-3/parametres.spec.ts).

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

vi.mock("@/lib/parametres-admin", async (importer) => ({
  ...(await importer<typeof import("@/lib/parametres-admin")>()),
  lireParametresAdmin: async () => {
    etat.lue = true;
    return etat.resultat;
  },
}));

import PageParametres, { generateMetadata } from "@/app/equipe/admin/parametres/page";
import { FormulaireDepot } from "@/components/formulaire-depot";
import { MentionConservation } from "@/components/mention-conservation";
import { FournisseurToasts } from "@/components/nova/toasts";
import { EVENEMENTS_CLES_FACULTATIVES, clesJournalValides, descriptionJournal } from "@/lib/journal";
import { lireReponseParametres } from "@/lib/parametres-admin";
import {
  DUREES_CONSERVATION,
  MESSAGES_PARAMETRES,
  optionsDuree,
  verifierParametres,
} from "@/lib/schemas/parametres";

vi.mock("next/navigation", async (importer) => ({
  ...(await importer<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const PARAMETRES: ParametresAdmin = {
  nomAffiche: "Nova Services",
  emailContact: "contact@nova-services.example",
  dureeConservationMois: 24,
};

function rendu(element: React.ReactNode): string {
  return renderToStaticMarkup(<FournisseurToasts>{element}</FournisseurToasts>);
}

async function rendre(): Promise<string> {
  return rendu(await PageParametres());
}

/** Texte sans balises, entités décodées pour les apostrophes. */
function texte(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

beforeEach(() => {
  etat.admin = true;
  etat.resultat = null;
  etat.lue = false;
});

describe("page /equipe/admin/parametres", () => {
  it("titre de l'onglet « Paramètres », ou « Accès refusé » pour un collaborateur", async () => {
    expect((await generateMetadata()).title).toBe("Paramètres — Nova Services");
    etat.admin = false;
    expect((await generateMetadata()).title).toBe("Accès refusé — Nova Services");
  });

  it("formulaire prérempli, durées de 6 mois à 5 ans, bouton « Enregistrer les paramètres »", async () => {
    etat.resultat = { ok: true, donnees: PARAMETRES } satisfies Resultat<ParametresAdmin>;
    const html = await rendre();
    expect(html).toMatch(/<h1[^>]*>Paramètres<\/h1>/);
    for (const libelle of ["Nom affiché", "Email de contact", "Durée de conservation"]) {
      expect(html).toMatch(new RegExp(`<label[^>]*>${libelle}</label>`));
    }
    expect(html).toMatch(/name="nom_affiche"[^>]*value="Nova Services"/);
    expect(html).toMatch(/name="email_contact"[^>]*value="contact@nova-services.example"/);
    const options = [...html.matchAll(/<option([^>]*)>([^<]+)<\/option>/g)].map(([, attributs, libelle]) => ({
      valeur: attributs.match(/value="(\d+)"/)?.[1],
      choisie: /\sselected=""/.test(attributs),
      libelle,
    }));
    expect(options.map((o) => o.libelle)).toEqual([
      "6 mois",
      "1 an",
      "18 mois",
      "2 ans",
      "3 ans",
      "4 ans",
      "5 ans",
    ]);
    expect(options.filter((o) => o.choisie).map((o) => o.valeur)).toEqual(["24"]);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Enregistrer les paramètres<\/button>/);
  });

  it("aperçu : la phrase du formulaire public, avec la durée et l'email actuels", async () => {
    etat.resultat = { ok: true, donnees: { ...PARAMETRES, dureeConservationMois: 36 } };
    const html = await rendre();
    expect(html).toMatch(/<h2[^>]*>Aperçu<\/h2>/);
    const apercu = html.match(/data-testid="apercu-mention"[^>]*>(.*?)<\/p>/)?.[1] ?? "";
    expect(texte(apercu)).toBe(
      "Vos informations servent uniquement à traiter votre demande. Elles sont conservées 3 ans " +
        "après son traitement, puis supprimées. Pour les faire effacer, écrivez à " +
        "contact@nova-services.example.",
    );
    // Pas de lien mailto dans l'aperçu (email en cours de saisie).
    expect(apercu).not.toContain("mailto:");
  });

  it("durée enregistrée hors liste (30 mois) : choisie, « 30 mois », aperçu « 30 mois »", async () => {
    etat.resultat = { ok: true, donnees: { ...PARAMETRES, dureeConservationMois: 30 } };
    const html = await rendre();
    const choisies = [...html.matchAll(/<option([^>]*)>([^<]+)<\/option>/g)].filter(([, attributs]) =>
      /\sselected=""/.test(attributs),
    );
    expect(choisies).toHaveLength(1);
    expect(choisies[0][1]).toContain('value="30"');
    expect(choisies[0][2]).toBe("30 mois");
    const apercu = html.match(/data-testid="apercu-mention"[^>]*>(.*?)<\/p>/)?.[1] ?? "";
    expect(texte(apercu)).toContain("Elles sont conservées 30 mois après son traitement");
  });

  it("erreur : bandeau role=alert et « Réessayer », pas de formulaire", async () => {
    etat.resultat = { ok: false, code: "ERREUR_INATTENDUE", message: "Le serveur ne répond pas." };
    const html = await rendre();
    expect(html).toMatch(/role="alert" class="flex[^"]*"><p[^>]*>Le serveur ne répond pas\.<\/p>/);
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("<form");
  });

  it("collaborateur : accès refusé, paramètres jamais lus", async () => {
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

describe("phrase de conservation partagée", () => {
  it("même texte dans le formulaire public et dans l'aperçu", () => {
    const publique = renderToStaticMarkup(
      <FormulaireDepot
        categories={[{ id: "c1", nom: "Autre" }]}
        emailContact="accueil@nova.example"
        dureeConservation="3 ans"
        cleEnvoi="cle"
      />,
    );
    const mention = renderToStaticMarkup(
      <MentionConservation dureeConservation="3 ans" emailContact="accueil@nova.example" />,
    );
    expect(publique).toContain(mention);
    expect(mention).toContain('href="mailto:accueil@nova.example"');
    const apercu = renderToStaticMarkup(
      <MentionConservation dureeConservation="3 ans" emailContact="accueil@nova.example" avecLien={false} />,
    );
    expect(texte(apercu)).toBe(texte(mention));
  });
});

describe("liste des durées", () => {
  it("6 mois, 1 an, 18 mois, 2 ans, 3 ans, 4 ans, 5 ans", () => {
    expect([...DUREES_CONSERVATION]).toEqual([6, 12, 18, 24, 36, 48, 60]);
    expect(optionsDuree().map((o) => o.libelle)).toEqual([
      "6 mois",
      "1 an",
      "18 mois",
      "2 ans",
      "3 ans",
      "4 ans",
      "5 ans",
    ]);
  });

  it("durée enregistrée hors liste (30 mois) : ajoutée à sa place, jamais remplacée", () => {
    expect(optionsDuree(30).map((o) => o.valeur)).toEqual([6, 12, 18, 24, 30, 36, 48, 60]);
    expect(optionsDuree(30)[4].libelle).toBe("30 mois");
    expect(optionsDuree(24)).toHaveLength(7);
    expect(optionsDuree(99)).toHaveLength(7);
    // Enregistrée 30, choisie 36 : 30 reste proposée (on peut y revenir).
    expect(optionsDuree(30, 36).map((o) => o.valeur)).toEqual([6, 12, 18, 24, 30, 36, 48, 60]);
    expect(optionsDuree(30, 42).map((o) => o.valeur)).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 60]);
  });
});

describe("schéma", () => {
  it("valeurs normalisées : espaces retirés, email en minuscules, durée en nombre", () => {
    expect(
      verifierParametres({
        nom_affiche: "  Nova  ",
        email_contact: " Accueil@Nova.Example ",
        duree_conservation_mois: "36",
      }),
    ).toEqual({
      ok: true,
      donnees: { nom_affiche: "Nova", email_contact: "accueil@nova.example", duree_conservation_mois: 36 },
    });
  });

  it("email mal écrit : « Cette adresse email ne semble pas valide. » sous le champ", () => {
    expect(
      verifierParametres({ nom_affiche: "Nova", email_contact: "accueil@nova", duree_conservation_mois: "24" }),
    ).toEqual({ ok: false, erreurs: { email_contact: "Cette adresse email ne semble pas valide." } });
    expect(MESSAGES_PARAMETRES.emailInvalide).toBe("Cette adresse email ne semble pas valide.");
    expect(MESSAGES_PARAMETRES.enregistres).toBe("Paramètres enregistrés.");
  });

  it("plusieurs erreurs : une par champ", () => {
    const r = verifierParametres({ nom_affiche: "", email_contact: "x", duree_conservation_mois: "61" });
    expect(r).toEqual({
      ok: false,
      erreurs: {
        nom_affiche: MESSAGES_PARAMETRES.nomVide,
        email_contact: MESSAGES_PARAMETRES.emailInvalide,
        duree_conservation_mois: MESSAGES_PARAMETRES.duree,
      },
    });
  });

  it("nom de 150 caractères accepté, 151 refusé", () => {
    const saisie = { email_contact: "a@b.example", duree_conservation_mois: "6" };
    expect(verifierParametres({ ...saisie, nom_affiche: "é".repeat(150) }).ok).toBe(true);
    expect(verifierParametres({ ...saisie, nom_affiche: "é".repeat(151) })).toEqual({
      ok: false,
      erreurs: { nom_affiche: MESSAGES_PARAMETRES.nomLong },
    });
  });
});

describe("lecture de lire_parametres_admin()", () => {
  it("forme attendue", () => {
    expect(
      lireReponseParametres({
        nom_affiche: "Nova Services",
        email_contact: "contact@nova-services.example",
        duree_conservation_mois: 24,
        mis_a_jour_le: "2026-11-03T13:56:42+00:00",
      }),
    ).toEqual(PARAMETRES);
  });

  it.each([
    ["nul", null],
    ["tableau", []],
    ["durée hors bornes", { nom_affiche: "N", email_contact: "a@b.c", duree_conservation_mois: 61 }],
    ["email manquant", { nom_affiche: "N", duree_conservation_mois: 24 }],
  ])("%s : null", (_cas, valeur) => {
    expect(lireReponseParametres(valeur)).toBeNull();
  });
});

describe("journal", () => {
  it("phrase avec seulement les champs changés", () => {
    expect(
      descriptionJournal({
        evenement: "parametres_modifies",
        email_contact: "b@nova.example",
        ancien_email_contact: "a@nova.example",
        duree_conservation_mois: 36,
        ancienne_duree_conservation_mois: 24,
      }),
    ).toBe(
      "Paramètres modifiés : email de contact « a@nova.example » → « b@nova.example » ; " +
        "durée de conservation « 2 ans » → « 3 ans »",
    );
    expect(
      descriptionJournal({
        evenement: "parametres_modifies",
        nom_affiche: "Nova Accueil",
        ancien_nom_affiche: "Nova Services",
      }),
    ).toBe("Paramètres modifiés : nom affiché « Nova Services » → « Nova Accueil »");
    // Valeurs contenant « ; » ou « → » : sans ambiguïté.
    expect(
      descriptionJournal({
        evenement: "parametres_modifies",
        nom_affiche: "A ; B → C",
        ancien_nom_affiche: "Nova",
      }),
    ).toBe("Paramètres modifiés : nom affiché « Nova » → « A ; B → C »");
    expect(
      descriptionJournal({
        evenement: "parametres_modifies",
        duree_conservation_mois: 18,
        ancienne_duree_conservation_mois: 6,
      }),
    ).toBe("Paramètres modifiés : durée de conservation « 6 mois » → « 18 mois »");
  });

  it("valeurs illisibles : jamais de JSON brut ni d'erreur", () => {
    expect(descriptionJournal({ evenement: "parametres_modifies" })).toBe("Paramètres modifiés");
    expect(
      descriptionJournal({
        evenement: "parametres_modifies",
        duree_conservation_mois: "x",
        ancienne_duree_conservation_mois: -1,
      }),
    ).toBe("Paramètres modifiés");
  });

  it("clés permises : evenement plus au moins une paire complète, rien d'autre", () => {
    const ok = (cles: string[]) => clesJournalValides("parametres_modifies", cles);
    expect(ok(["evenement", "email_contact", "ancien_email_contact"])).toBe(true);
    expect(
      ok([
        "evenement",
        "nom_affiche",
        "ancien_nom_affiche",
        "email_contact",
        "ancien_email_contact",
        "duree_conservation_mois",
        "ancienne_duree_conservation_mois",
      ]),
    ).toBe(true);
    expect(ok(["evenement"])).toBe(false);
    expect(ok(["evenement", "email_contact"])).toBe(false);
    expect(ok(["email_contact", "ancien_email_contact"])).toBe(false);
    expect(ok(["evenement", "email_contact", "ancien_email_contact", "telephone"])).toBe(false);
    // Les autres événements : toujours exactement leurs clés.
    expect(clesJournalValides("compte_reactive", ["evenement", "membre_id", "nom"])).toBe(true);
    expect(clesJournalValides("compte_reactive", ["evenement", "membre_id"])).toBe(false);
    expect(clesJournalValides("inconnu", ["evenement"])).toBe(false);
  });

  it("événement à clés facultatives sans paires déclarées : erreur claire", () => {
    const facultatives = EVENEMENTS_CLES_FACULTATIVES as Set<string>;
    facultatives.add("compte_reactive");
    try {
      expect(() => clesJournalValides("compte_reactive", ["evenement"])).toThrow(/PAIRES_CLES/);
    } finally {
      facultatives.delete("compte_reactive");
    }
  });
});
