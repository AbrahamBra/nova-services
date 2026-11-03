import { describe, expect, it } from "vitest";
import { ESPACE_INSECABLE as NB, formaterDuree, formaterNombre } from "@/lib/format";

describe("lib/format — durée de conservation", () => {
  it("24 mois → « 2 ans »", () => {
    expect(formaterDuree(24)).toBe("2 ans");
  });

  it("12 mois → « 1 an »", () => {
    expect(formaterDuree(12)).toBe("1 an");
  });

  it("18 mois → « 18 mois »", () => {
    expect(formaterDuree(18)).toBe("18 mois");
  });

  it("6 et 60 mois (bornes) → « 6 mois », « 5 ans »", () => {
    expect(formaterDuree(6)).toBe("6 mois");
    expect(formaterDuree(60)).toBe("5 ans");
  });

  it("refuse une durée nulle, négative ou non entière", () => {
    expect(() => formaterDuree(0)).toThrow(RangeError);
    expect(() => formaterDuree(-12)).toThrow(RangeError);
    expect(() => formaterDuree(1.5)).toThrow(RangeError);
  });
});

describe("lib/format — nombres du compteur", () => {
  it("sépare les milliers par une espace insécable : « 5 000 »", () => {
    expect(formaterNombre(0)).toBe("0");
    expect(formaterNombre(12)).toBe("12");
    expect(formaterNombre(5000)).toBe(`5${NB}000`);
    expect(formaterNombre(1234567)).toBe(`1${NB}234${NB}567`);
  });
});
