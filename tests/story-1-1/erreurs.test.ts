import { describe, expect, it } from "vitest";
import { estCodeErreur, messageErreur, MESSAGES_ERREUR } from "@/lib/erreurs";

// Fonctions réelles de lib/erreurs.ts, sans simulation.
describe("lib/erreurs — reconnaissance des codes", () => {
  it("accepte ERREUR_INATTENDUE", () => {
    expect(estCodeErreur("ERREUR_INATTENDUE")).toBe(true);
    expect(messageErreur("ERREUR_INATTENDUE")).toBe(MESSAGES_ERREUR.ERREUR_INATTENDUE);
  });

  it("refuse un code inconnu", () => {
    expect(estCodeErreur("CODE_INCONNU")).toBe(false);
  });

  it("refuse les noms hérités des objets JavaScript", () => {
    expect(estCodeErreur("toString")).toBe(false);
    expect(estCodeErreur("__proto__")).toBe(false);
    expect(estCodeErreur("constructor")).toBe(false);
  });

  it("refuse une valeur qui n'est pas du texte", () => {
    expect(estCodeErreur(42)).toBe(false);
    expect(estCodeErreur(null)).toBe(false);
    expect(estCodeErreur(undefined)).toBe(false);
  });
});
