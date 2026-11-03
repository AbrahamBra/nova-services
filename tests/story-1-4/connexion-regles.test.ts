import { describe, expect, it } from "vitest";
import { adresseDeRetour, verifierConnexion } from "@/lib/schemas/connexion";
import { lireReponseProfil, prenomDe } from "@/lib/session";

// Story 1.4 — règles pures de la connexion : adresse de retour (AD-28),
// schéma Zod, lecture de la réponse de mon_profil().

describe("adresseDeRetour", () => {
  it("garde une adresse de l'espace équipe", () => {
    expect(adresseDeRetour("/equipe")).toBe("/equipe");
    expect(adresseDeRetour("/equipe/admin")).toBe("/equipe/admin");
    expect(adresseDeRetour("/equipe/demandes?page=2&statut=nouvelle")).toBe(
      "/equipe/demandes?page=2&statut=nouvelle",
    );
    expect(adresseDeRetour("/equipe/demandes/../admin")).toBe("/equipe/admin");
    expect(adresseDeRetour("/equipe/admin#haut")).toBe("/equipe/admin");
  });

  it("remplace toute autre adresse par /equipe", () => {
    for (const valeur of [
      "https://exemple.com",
      "//exemple.com/equipe",
      "/\\exemple.com",
      "/equipe\\..\\..\\exemple.com",
      "/equipeexterieur",
      "/",
      "/connexion",
      "equipe",
      " /equipe",
      "/equipe/a b",
      "/equipe/../connexion",
      "/equipe/./../../exemple.com",
      "/equipe/%2e%2e/connexion",
      "/equipe/..",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(adresseDeRetour(valeur), String(valeur)).toBe("/equipe");
    }
  });
});

describe("schéma de connexion", () => {
  it("normalise l'email et garde le mot de passe tel quel", () => {
    expect(verifierConnexion({ email: "  Karim.Benali@Example.COM ", mot_de_passe: " secret " })).toEqual({
      ok: true,
      donnees: { email: "karim.benali@example.com", mot_de_passe: " secret " },
    });
  });

  it("signale les champs vides et l'email mal formé", () => {
    expect(verifierConnexion({ email: "", mot_de_passe: "" })).toEqual({
      ok: false,
      erreurs: {
        email: "Indiquez votre adresse email.",
        mot_de_passe: "Indiquez votre mot de passe.",
      },
    });
    expect(verifierConnexion({ email: "abc", mot_de_passe: "x" })).toEqual({
      ok: false,
      erreurs: { email: "Cette adresse email ne semble pas valide." },
    });
  });
});

describe("profil du membre connecté", () => {
  it("le prénom est le premier mot du nom", () => {
    expect(prenomDe("Karim Benali")).toBe("Karim");
    expect(prenomDe("  Claire   Roux ")).toBe("Claire");
    expect(prenomDe("Nadia")).toBe("Nadia");
  });

  it("lit un membre actif, refuse toute autre forme", () => {
    expect(lireReponseProfil({ nom: "Claire Roux", role: "administrateur", etat: "actif" })).toEqual({
      nom: "Claire Roux",
      role: "administrateur",
      prenom: "Claire",
      estAdmin: true,
    });
    expect(lireReponseProfil(null)).toBeNull();
    expect(lireReponseProfil({ nom: "Léo", role: "chef", etat: "actif" })).toBeUndefined();
    expect(lireReponseProfil({ nom: "Léo", role: "collaborateur", etat: "desactive" })).toBeUndefined();
    expect(lireReponseProfil("texte")).toBeUndefined();
  });
});
