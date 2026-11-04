import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Story 1.5 — les commandes donnees:remplir et donnees:vider refusent de
// tourner hors du projet de développement (AD-27). Aucun accès à la base :
// le refus a lieu avant toute connexion.

const SCRIPT = resolve(process.cwd(), "scripts", "donnees.ts");
const DOSSIER_VIDE = mkdtempSync(join(tmpdir(), "nova-garde-"));

function lancer(action: string, environnement: string | undefined, ...options: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Adresse de base volontairement fausse : aucune connexion possible.
    SUPABASE_DB_URL: "postgres://refus@127.0.0.1:1/x",
  };
  if (environnement === undefined) delete env.SUPABASE_ENVIRONNEMENT;
  else env.SUPABASE_ENVIRONNEMENT = environnement;
  return spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      SCRIPT,
      action,
      ...options,
    ],
    {
      // Dossier vide : aucun .env.local n'y est chargé, seul `env` compte.
      cwd: DOSSIER_VIDE,
      encoding: "utf8",
      env,
      timeout: 30_000,
    },
  );
}

describe("donnees:remplir / donnees:vider — garde-fou d'environnement", () => {
  for (const action of ["remplir", "vider"]) {
    it(`${action} refuse la production`, () => {
      const resultat = lancer(action, "production");
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toContain("refusé");
      expect(resultat.stderr).toContain("production");
    });

    it(`${action} refuse un environnement absent`, () => {
      const resultat = lancer(action, undefined);
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toContain("refusé");
    });

    it(`${action} refuse « staging »`, () => {
      const resultat = lancer(action, "staging");
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toContain("refusé");
      expect(resultat.stderr).toContain("staging");
    });

    it(`${action} refuse l'option --production`, () => {
      const resultat = lancer(action, "developpement", "--production");
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toContain("--production");
    });
  }
});
