import { describe, expect, it, vi } from "vitest";
import {
  AUTEUR_MEMBRE_INCONNU,
  AUTEUR_SYSTEME,
  CLES_DETAILS_JOURNAL,
  PHRASES_JOURNAL,
  TYPE_EVENEMENT_JOURNAL,
  auteurJournal,
  descriptionJournal,
  lireJournalAvec,
  lireReponseJournal,
} from "@/lib/journal";
import {
  TAILLE_PAGE_JOURNAL,
  adresseJournal,
  estAdresseJournalCanonique,
  lireTypeJournal,
  parametresJournal,
} from "@/lib/filtres";
import type { ClientRpc } from "@/lib/server/appeler";

// Story 5.1 — phrases du journal (une par événement, code inconnu), auteur,
// validation de la réponse de `lire_journal`, lecture (page bornée, erreurs)
// et filtre de type dans l'adresse. Sans base.

describe("descriptionJournal", () => {
  const leo = { membre_id: "id-leo", nom: "Léo Martin" };

  it("compte_cree : « Compte créé : Léo Martin (Collaborateur) »", () => {
    expect(descriptionJournal({ evenement: "compte_cree", ...leo, role: "collaborateur" })).toBe(
      "Compte créé : Léo Martin (Collaborateur)",
    );
    expect(descriptionJournal({ evenement: "compte_cree", ...leo, role: "administrateur" })).toBe(
      "Compte créé : Léo Martin (Administrateur)",
    );
  });

  it("compte_modifie : nom et rôle changés, seulement ce qui change", () => {
    expect(
      descriptionJournal({
        evenement: "compte_modifie",
        ...leo,
        role: "administrateur",
        ancien_nom: "Léo Martine",
        ancien_role: "collaborateur",
      }),
    ).toBe("Compte modifié : Léo Martin, nom : Léo Martine → Léo Martin, rôle : Collaborateur → Administrateur");
    expect(
      descriptionJournal({
        evenement: "compte_modifie",
        ...leo,
        role: "collaborateur",
        ancien_nom: "Léo Martin",
        ancien_role: "administrateur",
      }),
    ).toBe("Compte modifié : Léo Martin, rôle : Administrateur → Collaborateur");
    expect(
      descriptionJournal({
        evenement: "compte_modifie",
        ...leo,
        role: "collaborateur",
        ancien_nom: "Leo",
        ancien_role: "collaborateur",
      }),
    ).toBe("Compte modifié : Léo Martin, nom : Leo → Léo Martin");
  });

  it("compte_desactive : demandes remises seulement si n > 0, au singulier ou au pluriel", () => {
    expect(descriptionJournal({ evenement: "compte_desactive", ...leo, demandes_remises: 0 })).toBe(
      "Compte désactivé : Léo Martin",
    );
    expect(descriptionJournal({ evenement: "compte_desactive", ...leo, demandes_remises: 1 })).toBe(
      "Compte désactivé : Léo Martin, 1 demande remise en Nouvelle",
    );
    expect(descriptionJournal({ evenement: "compte_desactive", ...leo, demandes_remises: 2 })).toBe(
      "Compte désactivé : Léo Martin, 2 demandes remises en Nouvelle",
    );
  });

  it("réactivation, lien de mot de passe, invitation renvoyée et annulée", () => {
    expect(descriptionJournal({ evenement: "compte_reactive", ...leo })).toBe("Compte réactivé : Léo Martin");
    expect(descriptionJournal({ evenement: "lien_mot_de_passe_genere", ...leo })).toBe(
      "Lien de mot de passe généré pour Léo Martin",
    );
    expect(descriptionJournal({ evenement: "invitation_renvoyee", ...leo })).toBe(
      "Invitation renvoyée à Léo Martin",
    );
    // Le membre n'existe plus : le nom enregistré dans les détails suffit.
    expect(descriptionJournal({ evenement: "invitation_annulee", membre_id: "disparu", nom: "Léo Martin" })).toBe(
      "Invitation annulée : Léo Martin",
    );
  });

  it("connexion_bloquee : même email, même adresse IP, ou les deux", () => {
    const base = { evenement: "connexion_bloquee", duree_minutes: 15 };
    expect(descriptionJournal({ ...base, bloque: "email" })).toBe(
      "Connexion bloquée 15 minutes après 5 échecs (même email)",
    );
    expect(descriptionJournal({ ...base, bloque: "ip" })).toBe(
      "Connexion bloquée 15 minutes après 5 échecs (même adresse IP)",
    );
    expect(descriptionJournal({ ...base, bloque: "email_et_ip" })).toBe(
      "Connexion bloquée 15 minutes après 5 échecs (même email et même adresse IP)",
    );
  });

  it("connexion_bloquee : durée absente ou invalide, jamais inventée", () => {
    expect(descriptionJournal({ evenement: "connexion_bloquee", bloque: "ip" })).toBe(
      "Connexion bloquée après 5 échecs (même adresse IP)",
    );
    for (const duree of [0, -3, 2.5, "15", null]) {
      expect(descriptionJournal({ evenement: "connexion_bloquee", duree_minutes: duree })).toBe(
        "Connexion bloquée après 5 échecs",
      );
    }
    expect(descriptionJournal({ evenement: "connexion_bloquee", duree_minutes: 30 })).toBe(
      "Connexion bloquée 30 minutes après 5 échecs",
    );
  });

  it("echec_confirmation : référence et code", () => {
    expect(
      descriptionJournal({ evenement: "echec_confirmation", reference: "NOVA-2026-0042", code: "invalid_api_key" }),
    ).toBe("Email de confirmation non envoyé pour NOVA-2026-0042 (code : invalid_api_key)");
  });

  it("code inconnu : « Événement « code » », jamais de JSON brut", () => {
    // Story 5.2 : « categorie_ajoutee » est devenu connu ; un code jamais écrit.
    expect(descriptionJournal({ evenement: "evenement_futur", categorie_id: "x" })).toBe(
      "Événement « evenement_futur »",
    );
    const sans = descriptionJournal({ autre: { a: 1 } });
    expect(sans).toBe("Événement « inconnu »");
    // Clés héritées d'Object : jamais prises pour un événement connu.
    expect(descriptionJournal({ evenement: "toString" })).toBe("Événement « toString »");
    for (const phrase of [sans, descriptionJournal({ evenement: "compte_cree" })]) {
      expect(phrase).not.toMatch(/[{}"]/);
    }
  });

  it("clés, phrases et types : mêmes événements dans les deux sens", () => {
    const cles = Object.keys(CLES_DETAILS_JOURNAL).sort();
    expect(Object.keys(PHRASES_JOURNAL).sort()).toEqual(cles);
    expect(Object.keys(TYPE_EVENEMENT_JOURNAL).sort()).toEqual(cles);
    for (const evenement of cles) {
      expect(descriptionJournal({ evenement }), evenement).not.toMatch(/^Événement « /);
    }
  });
});

describe("auteurJournal", () => {
  it("Système, nom actuel, ou Membre inconnu", () => {
    expect(auteurJournal({ auteurType: "systeme", auteurNom: null })).toBe(AUTEUR_SYSTEME);
    expect(AUTEUR_SYSTEME).toBe("Système");
    expect(auteurJournal({ auteurType: "membre", auteurNom: "Claire Roux" })).toBe("Claire Roux");
    expect(auteurJournal({ auteurType: "membre", auteurNom: null })).toBe(AUTEUR_MEMBRE_INCONNU);
    expect(AUTEUR_MEMBRE_INCONNU).toBe("Membre inconnu");
  });
});

const LIGNE = {
  id: 7,
  cree_le: "2026-11-03T08:12:00.123+00:00",
  type: "compte",
  auteur_type: "membre",
  auteur_nom: "Claire Roux",
  details: { evenement: "compte_cree", nom: "Léo Martin", role: "collaborateur" },
};

describe("lireReponseJournal", () => {
  it("réponse correcte", () => {
    expect(lireReponseJournal({ total: 1, lignes: [LIGNE] })).toEqual({
      total: 1,
      lignes: [
        {
          id: 7,
          creeLe: LIGNE.cree_le,
          type: "compte",
          auteurType: "membre",
          auteurNom: "Claire Roux",
          details: LIGNE.details,
        },
      ],
    });
  });

  it.each([
    ["pas un objet", []],
    ["total manquant", { lignes: [] }],
    ["total négatif", { total: -1, lignes: [] }],
    ["lignes absentes", { total: 1 }],
  ])("%s : null", (_cas, valeur) => {
    expect(lireReponseJournal(valeur)).toBeNull();
  });

  it.each([
    ["type inconnu", { ...LIGNE, id: 8, type: "autre" }, "id=8 champ=type"],
    ["auteur inconnu", { ...LIGNE, id: 8, auteur_type: "x" }, "id=8 champ=auteur_type"],
    ["date invalide", { ...LIGNE, id: 8, cree_le: "hier" }, "id=8 champ=cree_le"],
    ["détails en tableau", { ...LIGNE, id: 8, details: [] }, "id=8 champ=details"],
    ["pas un objet", "x", "id=inconnu champ=ligne"],
  ])("ligne invalide (%s) : écartée et signalée, les autres gardées", (_cas, mauvaise, trace) => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const lu = lireReponseJournal({ total: 2, lignes: [mauvaise, LIGNE] });
      expect(lu?.total).toBe(2);
      expect(lu?.lignes.map((l) => l.id)).toEqual([7]);
      expect(erreurs).toHaveBeenCalledWith(`[journal] ligne écartée : ${trace}`);
      // Jamais le contenu de la ligne dans la trace.
      expect(String(erreurs.mock.calls[0][0])).not.toContain("Léo");
    } finally {
      erreurs.mockRestore();
    }
  });
});

function clientFactice(reponses: (total: number, page: number) => unknown, appels: unknown[]): ClientRpc {
  return {
    rpc: async (fonction, parametres) => {
      appels.push({ fonction, parametres });
      const page = Number((parametres as { p_page: number }).p_page);
      return { data: reponses(120, page), error: null };
    },
  };
}

describe("lireJournalAvec", () => {
  it("transmet le type et la page ; page au-delà de la fin ramenée à la dernière", async () => {
    const appels: unknown[] = [];
    const client = clientFactice(
      (total, page) => ({ total, lignes: page === 3 ? [LIGNE] : [] }),
      appels,
    );
    const resultat = await lireJournalAvec(client, "compte", 9);
    expect(appels).toEqual([
      { fonction: "lire_journal", parametres: { p_type: "compte", p_page: 9 } },
      { fonction: "lire_journal", parametres: { p_type: "compte", p_page: 3 } },
    ]);
    expect(resultat).toEqual({
      ok: true,
      donnees: {
        total: 120,
        page: 3,
        taillePage: TAILLE_PAGE_JOURNAL,
        lignes: [expect.objectContaining({ id: 7 })],
      },
    });
  });

  it("« Tous » : p_type null", async () => {
    const appels: unknown[] = [];
    await lireJournalAvec(clientFactice(() => ({ total: 0, lignes: [] }), appels), undefined, 1);
    expect(appels).toEqual([{ fonction: "lire_journal", parametres: { p_type: null, p_page: 1 } }]);
  });

  it("refus de la base : DROIT_INSUFFISANT transmis", async () => {
    const client: ClientRpc = {
      rpc: async () => ({ data: null, error: { code: "P0001", message: "DROIT_INSUFFISANT" } }),
    };
    expect(await lireJournalAvec(client, undefined, 1)).toMatchObject({ ok: false, code: "DROIT_INSUFFISANT" });
  });

  it("réponse inattendue : ERREUR_INATTENDUE", async () => {
    const client: ClientRpc = { rpc: async () => ({ data: { total: "x" }, error: null }) };
    const origine = console.error;
    console.error = () => {};
    try {
      expect(await lireJournalAvec(client, undefined, 1)).toMatchObject({
        ok: false,
        code: "ERREUR_INATTENDUE",
      });
    } finally {
      console.error = origine;
    }
  });
});

describe("filtre de type dans l'adresse", () => {
  const CHEMIN = "/equipe/admin/journal";

  it("type connu lu, inconnu ignoré", () => {
    expect(TAILLE_PAGE_JOURNAL).toBe(50);
    expect(lireTypeJournal("compte")).toBe("compte");
    expect(lireTypeJournal(["email", "compte"])).toBe("email");
    expect(lireTypeJournal("xyz")).toBeUndefined();
    expect(lireTypeJournal("Compte")).toBeUndefined();
    expect(lireTypeJournal(undefined)).toBeUndefined();
  });

  it("adresse canonique : type puis page, page 1 absente", () => {
    expect(adresseJournal(CHEMIN, undefined)).toBe(CHEMIN);
    expect(adresseJournal(CHEMIN, "compte", 2)).toBe(`${CHEMIN}?type=compte&page=2`);
    expect(parametresJournal(undefined, 3)).toEqual({ page: "3" });
    expect(estAdresseJournalCanonique({ type: "compte", page: "2" }, "compte", 2)).toBe(true);
    expect(estAdresseJournalCanonique({}, undefined, 1)).toBe(true);
    expect(estAdresseJournalCanonique({ type: "xyz" }, undefined, 1)).toBe(false);
    expect(estAdresseJournalCanonique({ page: "1" }, undefined, 1)).toBe(false);
    expect(estAdresseJournalCanonique({ type: ["compte", "email"] }, "compte", 1)).toBe(false);
    expect(estAdresseJournalCanonique({ type: "compte", page: "9" }, "compte", 3)).toBe(false);
  });
});
