import { describe, expect, it } from "vitest";
import { messageErreur } from "@/lib/erreurs";
import { ESPACE_INSECABLE as NB } from "@/lib/format";
import {
  lireSaisieDepot,
  longueur,
  MESSAGES_DEPOT,
  premierChampEnErreur,
  verifierDepot,
  type SaisieDepot,
} from "@/lib/schemas/depot";

// Story 1.3 — schéma Zod du formulaire de dépôt, partagé écran/action (AD-8).

const CATEGORIE = "6f1c2b0e-3d4a-4b5c-8d9e-0a1b2c3d4e5f";

function saisie(modifs: Partial<SaisieDepot> = {}): SaisieDepot {
  return {
    cle_envoi: crypto.randomUUID(),
    nom: "Sophie Garnier",
    email: "sophie@example.com",
    telephone: "",
    societe: "",
    categorie_id: CATEGORIE,
    objet: "Impression impossible",
    description: "Depuis lundi, plus rien ne sort.",
    consentement: true,
    ...modifs,
  };
}

describe("schéma de dépôt — saisie correcte", () => {
  it("accepte une saisie complète ; facultatifs vides → null", () => {
    const resultat = verifierDepot(saisie());
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.telephone).toBeNull();
    expect(resultat.donnees.societe).toBeNull();
    expect(resultat.donnees.consentement).toBe(true);
  });

  it("nettoie l'email : espaces retirés, minuscules (AD-31)", () => {
    const resultat = verifierDepot(saisie({ email: "  Jean.Dupont@Example.COM " }));
    expect(resultat.ok && resultat.donnees.email).toBe("jean.dupont@example.com");
  });

  it("retire les espaces autour des textes", () => {
    const resultat = verifierDepot(saisie({ nom: "  Sophie  ", societe: " Atelier " }));
    expect(resultat.ok && resultat.donnees.nom).toBe("Sophie");
    expect(resultat.ok && resultat.donnees.societe).toBe("Atelier");
  });

  it("garde un texte contenant <script> tel quel", () => {
    const texte = "<script>alert('x')</script>";
    const resultat = verifierDepot(saisie({ description: texte }));
    expect(resultat.ok && resultat.donnees.description).toBe(texte);
  });
});

describe("schéma de dépôt — erreurs sous les champs", () => {
  it("description vide, email « abc », case non cochée → 3 messages", () => {
    const resultat = verifierDepot(
      saisie({ description: "  ", email: "abc", consentement: false }),
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreurs).toEqual({
      email: MESSAGES_DEPOT.emailInvalide,
      description: MESSAGES_DEPOT.descriptionVide,
      consentement: MESSAGES_DEPOT.consentement,
    });
    expect(premierChampEnErreur(resultat.erreurs)).toBe("email");
  });

  it("textes d'EXPERIENCE.md §3", () => {
    expect(MESSAGES_DEPOT.emailVide).toBe("Indiquez votre adresse email.");
    expect(MESSAGES_DEPOT.emailInvalide).toBe("Cette adresse email ne semble pas valide.");
    expect(MESSAGES_DEPOT.consentement).toBe("Cochez cette case pour envoyer votre demande.");
  });

  it("email vide → « Indiquez votre adresse email. » seulement", () => {
    const resultat = verifierDepot(saisie({ email: "   " }));
    expect(!resultat.ok && resultat.erreurs.email).toBe(MESSAGES_DEPOT.emailVide);
  });

  it("champs obligatoires vides : nom, catégorie, objet", () => {
    const resultat = verifierDepot(saisie({ nom: "", categorie_id: "", objet: "" }));
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreurs).toEqual({
      nom: MESSAGES_DEPOT.nomVide,
      categorie_id: MESSAGES_DEPOT.categorie,
      objet: MESSAGES_DEPOT.objetVide,
    });
    expect(premierChampEnErreur(resultat.erreurs)).toBe("nom");
  });

  it("longueurs maximales : 150 (nom, société, objet), 30 (téléphone), 5 000 (description)", () => {
    expect(verifierDepot(saisie({ objet: "a".repeat(150) })).ok).toBe(true);
    expect(verifierDepot(saisie({ description: "d".repeat(5000) })).ok).toBe(true);
    const trop = verifierDepot(
      saisie({
        nom: "n".repeat(151),
        societe: "s".repeat(151),
        objet: "o".repeat(151),
        telephone: "0".repeat(31),
        description: "d".repeat(5001),
      }),
    );
    expect(trop.ok).toBe(false);
    if (trop.ok) return;
    expect(trop.erreurs).toEqual({
      nom: MESSAGES_DEPOT.nomLong,
      societe: MESSAGES_DEPOT.societeLong,
      objet: MESSAGES_DEPOT.objetLong,
      telephone: MESSAGES_DEPOT.telephoneLong,
      description: MESSAGES_DEPOT.descriptionLong,
    });
    expect(MESSAGES_DEPOT.descriptionLong).toBe(
      `La description ne doit pas dépasser 5${NB}000 caractères.`,
    );
  });

  it("compte les caractères comme la base : un emoji = 1", () => {
    expect(longueur("😀")).toBe(1);
    expect("😀".length).toBe(2);
    // 150 emojis = 150 caractères (300 unités UTF-16) : accepté.
    expect(verifierDepot(saisie({ objet: "😀".repeat(150) })).ok).toBe(true);
    expect(verifierDepot(saisie({ objet: "😀".repeat(151) })).ok).toBe(false);
  });

  it("refuse le caractère nul (U+0000), refusé par PostgreSQL", () => {
    const nul = String.fromCharCode(0);
    const resultat = verifierDepot(
      saisie({ nom: `Sophie${nul}`, description: `a${nul}b`, societe: nul + "x" }),
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreurs).toEqual({
      nom: MESSAGES_DEPOT.caractereInterdit,
      societe: MESSAGES_DEPOT.caractereInterdit,
      description: MESSAGES_DEPOT.caractereInterdit,
    });
  });

  it("catégorie et consentement : même texte que les refus de la base", () => {
    expect(MESSAGES_DEPOT.categorie).toBe(messageErreur("CATEGORIE_INVALIDE"));
    expect(MESSAGES_DEPOT.consentement).toBe(messageErreur("CONSENTEMENT_REQUIS"));
  });

  it("refuse une catégorie qui n'est pas un identifiant", () => {
    const resultat = verifierDepot(saisie({ categorie_id: "1 or 1=1" }));
    expect(!resultat.ok && resultat.erreurs.categorie_id).toBe(MESSAGES_DEPOT.categorie);
  });

  it("refuse une clé d'envoi qui n'est pas un uuid, sans erreur de champ", () => {
    const resultat = verifierDepot(saisie({ cle_envoi: "abc" }));
    expect(resultat).toEqual({ ok: false, erreurs: {}, cleInvalide: true });
  });
});

describe("lecture du formulaire (FormData)", () => {
  it("case cochée → true ; absente → false ; champ manquant → texte vide", () => {
    const coche = new FormData();
    coche.set("nom", "Sophie");
    coche.set("consentement", "oui");
    expect(lireSaisieDepot(coche)).toMatchObject({ nom: "Sophie", email: "", consentement: true });

    expect(lireSaisieDepot(new FormData()).consentement).toBe(false);
  });
});
