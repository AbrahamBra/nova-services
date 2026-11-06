import { describe, expect, it } from "vitest";
import { lireReponseComptes } from "@/lib/comptes";
import {
  MESSAGES_INVITATION,
  ROLE_PAR_DEFAUT,
  verifierInvitation,
} from "@/lib/schemas/invitation";
import {
  MESSAGES_MOT_DE_PASSE,
  REGLE_MOT_DE_PASSE,
  schemaLien,
  verifierMotDePasse,
} from "@/lib/schemas/mot-de-passe";
import { adresseDuSite, lienInvitation } from "@/lib/server/liens";

// Story 4.1 — schémas partagés écran/action, adresse du site et lien
// d'invitation, lecture de la liste des comptes (sans base).

describe("schéma de l'invitation", () => {
  it("nom sans espaces autour, email en minuscules sans espaces, rôle fermé", () => {
    expect(
      verifierInvitation({ nom: "  Léo Martin ", email: " LEO@Example.COM ", role: "administrateur" }),
    ).toEqual({
      ok: true,
      donnees: { nom: "Léo Martin", email: "leo@example.com", role: "administrateur" },
    });
    expect(ROLE_PAR_DEFAUT).toBe("collaborateur");
  });

  it("nom de 1 à 150 caractères", () => {
    expect(verifierInvitation({ nom: "", email: "a@b.fr", role: "collaborateur" })).toEqual({
      ok: false,
      erreurs: { nom: MESSAGES_INVITATION.nomVide },
    });
    expect(verifierInvitation({ nom: "é".repeat(150), email: "a@b.fr", role: "collaborateur" }).ok).toBe(true);
    expect(verifierInvitation({ nom: "é".repeat(151), email: "a@b.fr", role: "collaborateur" })).toEqual({
      ok: false,
      erreurs: { nom: MESSAGES_INVITATION.nomLong },
    });
  });

  it("email vide ou invalide, rôle inconnu", () => {
    expect(verifierInvitation({ nom: "Léo", email: "", role: "chef" })).toEqual({
      ok: false,
      erreurs: { email: MESSAGES_INVITATION.emailVide, role: MESSAGES_INVITATION.role },
    });
    expect(verifierInvitation({ nom: "Léo", email: "leo@", role: "collaborateur" })).toEqual({
      ok: false,
      erreurs: { email: MESSAGES_INVITATION.emailInvalide },
    });
  });
});

describe("schéma du mot de passe", () => {
  it("8 caractères minimum, règle affichée", () => {
    expect(REGLE_MOT_DE_PASSE).toBe("8 caractères minimum");
    expect(verifierMotDePasse({ mot_de_passe: "1234567", confirmation: "1234567" })).toEqual({
      ok: false,
      erreurs: { mot_de_passe: MESSAGES_MOT_DE_PASSE.court },
    });
    expect(verifierMotDePasse({ mot_de_passe: "12345678", confirmation: "12345678" }).ok).toBe(true);
  });

  it("le mot de passe n'est jamais retouché (espaces gardés)", () => {
    expect(verifierMotDePasse({ mot_de_passe: " 1234567 ", confirmation: " 1234567 " })).toEqual({
      ok: true,
      donnees: { mot_de_passe: " 1234567 ", confirmation: " 1234567 " },
    });
  });

  it("champs vides et confirmation différente", () => {
    expect(verifierMotDePasse({ mot_de_passe: "", confirmation: "" })).toEqual({
      ok: false,
      erreurs: {
        mot_de_passe: MESSAGES_MOT_DE_PASSE.vide,
        confirmation: MESSAGES_MOT_DE_PASSE.confirmationVide,
      },
    });
    expect(verifierMotDePasse({ mot_de_passe: "12345678", confirmation: "87654321" })).toEqual({
      ok: false,
      erreurs: { confirmation: MESSAGES_MOT_DE_PASSE.differents },
    });
  });

  it("plus de 72 octets refusés (limite de Supabase Auth)", () => {
    const long = "é".repeat(37); // 74 octets
    expect(verifierMotDePasse({ mot_de_passe: long, confirmation: long })).toEqual({
      ok: false,
      erreurs: { mot_de_passe: MESSAGES_MOT_DE_PASSE.long },
    });
  });
});

describe("adresse du site et lien d'invitation", () => {
  it("origine seule, sans barre finale", () => {
    expect(adresseDuSite("https://nova.example/")).toBe("https://nova.example");
    expect(adresseDuSite(" http://localhost:3210 ")).toBe("http://localhost:3210");
  });

  it.each(["", "nova.example", "javascript:alert(1)", "https://nova.example/x", "https://nova.example/?a=1"])(
    "%j : refusée",
    (valeur) => {
      expect(adresseDuSite(valeur)).toBeNull();
    },
  );

  it("lien vers /auth/confirmer avec le jeton haché et le type", () => {
    const lien = lienInvitation("https://nova.example", "abc123def456abc123");
    expect(lien).toBe("https://nova.example/auth/confirmer?token_hash=abc123def456abc123&type=invite");
    const url = new URL(lien);
    expect(schemaLien.safeParse(Object.fromEntries(url.searchParams)).success).toBe(true);
  });
});

describe("lecture de lister_comptes", () => {
  it("triée par nom à la française, accents et majuscules ignorés", () => {
    const comptes = lireReponseComptes([
      { id: "3", nom: "zoé Bernard", email: "z@x.fr", role: "collaborateur", etat: "actif" },
      { id: "1", nom: "Élodie Petit", email: "e@x.fr", role: "administrateur", etat: "actif" },
      { id: "2", nom: "Léo Martin", email: "l@x.fr", role: "collaborateur", etat: "invite" },
    ]);
    expect(comptes?.map((c) => c.nom)).toEqual(["Élodie Petit", "Léo Martin", "zoé Bernard"]);
  });

  it.each([[null], [{}], [[{ id: "1", nom: "A", email: "a@x.fr", role: "chef", etat: "actif" }]]])(
    "réponse inattendue %j : null",
    (valeur) => {
      expect(lireReponseComptes(valeur)).toBeNull();
    },
  );
});
