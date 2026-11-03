import { describe, expect, it } from "vitest";
import {
  anneeParis,
  formaterDate,
  formaterDateHeure,
  formaterHeure,
} from "@/lib/format";

describe("lib/format — dates à l'heure de Paris", () => {
  it("affiche une date d'hiver au format « 03/11/2026 à 09:12 »", () => {
    // 08:12 UTC = 09:12 à Paris (heure d'hiver, UTC+1).
    expect(formaterDateHeure("2026-11-03T08:12:00Z")).toBe("03/11/2026 à 09:12");
  });

  it("tient compte de l'heure d'été (UTC+2)", () => {
    expect(formaterDateHeure(new Date("2026-07-14T07:05:00Z"))).toBe(
      "14/07/2026 à 09:05",
    );
  });

  it("affiche minuit en 00:xx, jamais en 24:xx", () => {
    expect(formaterHeure("2026-11-02T23:30:00Z")).toBe("00:30");
  });

  it("change de jour selon Paris, pas selon UTC", () => {
    expect(formaterDate("2026-11-02T23:30:00Z")).toBe("03/11/2026");
  });

  it("donne l'année de Paris le soir du 31 décembre", () => {
    // 23:30 UTC le 31/12/2026 = 00:30 le 01/01/2027 à Paris.
    expect(anneeParis("2026-12-31T23:30:00Z")).toBe(2027);
  });

  it("refuse une date invalide", () => {
    expect(() => formaterDateHeure("pas une date")).toThrow(RangeError);
  });
});
