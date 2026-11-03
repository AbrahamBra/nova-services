import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODES_ERREUR, MESSAGES_ERREUR } from "@/lib/erreurs";

// Story 1.3 — concordance des codes d'erreur prévus (AD-20) : chaque code levé
// par une migration (`raise exception using errcode = 'P0001', message = 'X'`)
// figure dans lib/erreurs.ts, et chaque code de lib/erreurs.ts (sauf
// ERREUR_INATTENDUE, propre à l'application) est levé par une migration.

const DOSSIER = join(process.cwd(), "supabase", "migrations");

function codesDesMigrations(): string[] {
  const codes = new Set<string>();
  for (const fichier of readdirSync(DOSSIER).filter((nom) => nom.endsWith(".sql"))) {
    const sql = readFileSync(join(DOSSIER, fichier), "utf8");
    for (const [, code] of sql.matchAll(/message\s*=\s*'([A-Z][A-Z0-9_]*)'/gi)) {
      codes.add(code);
    }
  }
  return [...codes].sort();
}

describe("codes d'erreur — SQL et lib/erreurs.ts", () => {
  it("les migrations lèvent les codes du dépôt", () => {
    expect(codesDesMigrations()).toEqual(
      expect.arrayContaining(["CATEGORIE_INVALIDE", "CONSENTEMENT_REQUIS", "DONNEES_INVALIDES"]),
    );
  });

  it("chaque code levé en SQL a son message dans lib/erreurs.ts", () => {
    for (const code of codesDesMigrations()) {
      expect(CODES_ERREUR, `code ${code} absent de lib/erreurs.ts`).toContain(code);
    }
  });

  it("chaque code de lib/erreurs.ts est levé par une migration", () => {
    const sql = codesDesMigrations();
    for (const code of CODES_ERREUR.filter((c) => c !== "ERREUR_INATTENDUE")) {
      expect(sql, `code ${code} jamais levé en SQL`).toContain(code);
    }
  });

  it("chaque message est une phrase, sans point d'exclamation", () => {
    for (const message of Object.values(MESSAGES_ERREUR)) {
      expect(message).toMatch(/\.$/);
      expect(message).not.toContain("!");
    }
  });
});
