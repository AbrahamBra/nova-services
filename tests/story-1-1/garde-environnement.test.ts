import { describe, expect, it } from "vitest";
import { verifierEnvironnement } from "../garde-environnement";

describe("garde-fou de l'environnement des tests", () => {
  it("laisse passer le projet de développement", () => {
    expect(() => verifierEnvironnement("developpement")).not.toThrow();
  });

  it("arrête les tests si la variable est absente", () => {
    expect(() => verifierEnvironnement(undefined)).toThrow(/\(absent\)/);
  });

  it("arrête les tests sur la production", () => {
    expect(() => verifierEnvironnement("production")).toThrow(
      /« production » au lieu de « developpement »/,
    );
  });
});
