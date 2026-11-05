import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FICHIER_PRODUCTION,
  lireEnvironnement,
  optionMalEcrite,
} from "../../scripts/charger-environnement.mjs";
import { correspondances } from "../../scripts/secrets-github.mjs";

// Story 3.1 — garde-fous des scripts qui peuvent viser la production.
// Uniquement des fichiers temporaires FICTIFS (adresses en .invalid) : aucun
// script ne se connecte à une base, ni à GitHub. Les scripts sont lancés dans
// un dossier temporaire, avec un environnement débarrassé des variables
// Supabase du poste (celles de .env.local chargées par Vitest).

const racine = fileURLToPath(new URL("../../", import.meta.url));
const chargeur = pathToFileURL(join(racine, "scripts/charger-environnement.mjs")).href;

const dossiers: string[] = [];
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossierTemporaire(fichiers: Record<string, string> = {}): string {
  const dossier = mkdtempSync(join(tmpdir(), "nova-3-1-"));
  dossiers.push(dossier);
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(dossier, nom), contenu);
  return dossier;
}

const ENV_DEV = [
  "SUPABASE_ENVIRONNEMENT=developpement",
  "NEXT_PUBLIC_SUPABASE_URL=https://dev.exemple.invalid",
  "SUPABASE_DB_URL=postgresql://dev@dev.exemple.invalid:5432/postgres",
].join("\n");

const envProd = (environnement: string) =>
  [
    `SUPABASE_ENVIRONNEMENT=${environnement}`,
    "NEXT_PUBLIC_SUPABASE_URL=https://prod.exemple.invalid",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=faux",
    "SUPABASE_SECRET_KEY=faux",
    "SUPABASE_DB_URL=postgresql://prod@prod.exemple.invalid:5432/postgres",
  ].join("\n");

/** Environnement du processus enfant, sans aucune variable Supabase réelle. */
function envPropre(supplement: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    // NODE_ENV=test (posé par Vitest) empêcherait @next/env de lire .env.local.
    if (/SUPABASE|TEST_|HMAC|SENTRY|RESEND|^NODE_ENV$|^VITEST|^npm_config_production$/i.test(cle)) {
      continue;
    }
    env[cle] = valeur;
  }
  return { ...env, ...supplement } as NodeJS.ProcessEnv;
}

function lancer(
  script: string,
  args: string[],
  cwd: string,
  options: { ts?: boolean; env?: Record<string, string> } = {},
) {
  const prefixe = options.ts
    ? ["--conditions=react-server", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"]
    : [];
  const r = spawnSync(process.execPath, [...prefixe, join(racine, script), ...args], {
    cwd,
    env: envPropre(options.env),
    encoding: "utf8",
    input: "",
    timeout: 30_000,
  });
  return { statut: r.status, sortie: `${r.stdout}${r.stderr}` };
}

/** Charge l'environnement dans un processus à part et renvoie ce qu'il voit. */
function voir(cwd: string, args: string[], env: Record<string, string> = {}) {
  const code = `
    import { chargerEnvironnement } from ${JSON.stringify(chargeur)};
    const e = chargerEnvironnement("essai", {
      productionPermise: true,
      argv: ["node", "essai", ...${JSON.stringify(args)}],
    });
    const v = process.env;
    console.log(JSON.stringify({ e, env: v.SUPABASE_ENVIRONNEMENT, url: v.NEXT_PUBLIC_SUPABASE_URL,
      db: v.SUPABASE_DB_URL, jeton: v.SUPABASE_ACCESS_TOKEN, hmac: v.HMAC_SECRET }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd,
    env: envPropre(env),
    encoding: "utf8",
    timeout: 30_000,
  });
  return { statut: r.status, sortie: `${r.stdout}${r.stderr}`, json: () => JSON.parse(r.stdout) };
}

describe("lireEnvironnement (fermé par défaut)", () => {
  it("--production sans .env.scripts-production.local : refus avec un message clair", () => {
    const dossier = dossierTemporaire({ ".env.local": ENV_DEV });
    const r = lireEnvironnement({ racine: dossier, production: true, nomScript: "essai" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(`${FICHIER_PRODUCTION} est introuvable`);
  });

  it.each(["developpement", "", "prod", "Production"])(
    "--production avec SUPABASE_ENVIRONNEMENT=%j : refus",
    (valeur) => {
      const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: envProd(valeur) });
      const r = lireEnvironnement({ racine: dossier, production: true, nomScript: "essai" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("au lieu de « production »");
    },
  );

  it("--production avec des variables vides ou absentes : refus, avec leurs noms seulement", () => {
    const contenu = envProd("production")
      .replace(/^SUPABASE_SECRET_KEY=.*$/m, "SUPABASE_SECRET_KEY=")
      .replace(/^SUPABASE_DB_URL=.*$/m, "");
    const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: contenu });
    const r = lireEnvironnement({ racine: dossier, production: true, nomScript: "essai" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("SUPABASE_SECRET_KEY, SUPABASE_DB_URL");
      expect(r.message).not.toContain("exemple.invalid");
      expect(r.message).not.toContain("faux");
    }
  });

  it("--production avec un fichier qui commence par une marque d'ordre des octets (BOM) : accepté", () => {
    const bom = String.fromCharCode(0xfeff);
    const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: bom + envProd("production") });
    const r = lireEnvironnement({ racine: dossier, production: true, nomScript: "essai" });
    expect(r).toMatchObject({ ok: true, environnement: "production" });
  });

  it("--production avec un fichier correct : accepté", () => {
    const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: envProd("production") });
    const r = lireEnvironnement({ racine: dossier, production: true, nomScript: "essai" });
    expect(r).toMatchObject({ ok: true, environnement: "production" });
  });
});

describe("chargerEnvironnement", () => {
  it("--production lit UNIQUEMENT .env.scripts-production.local, jamais .env.local ni le terminal", () => {
    const dossier = dossierTemporaire({ ".env.local": ENV_DEV, [FICHIER_PRODUCTION]: envProd("production") });
    // Variables posées dans le terminal (dont celles de la CLI Supabase) :
    // aucune ne doit survivre.
    const r = voir(dossier, ["--production"], {
      SUPABASE_DB_URL: "postgresql://terminal.invalid/x",
      SUPABASE_ACCESS_TOKEN: "terminal",
      HMAC_SECRET: "terminal",
    });
    expect(r.statut, r.sortie).toBe(0);
    expect(r.json()).toEqual({
      e: "production",
      env: "production",
      url: "https://prod.exemple.invalid",
      db: "postgresql://prod@prod.exemple.invalid:5432/postgres",
    });
  });

  it("sans --production, les valeurs du terminal ne remplacent pas celles de .env.local", () => {
    const dossier = dossierTemporaire({ ".env.local": ENV_DEV });
    const r = voir(dossier, [], {
      SUPABASE_ENVIRONNEMENT: "developpement",
      SUPABASE_DB_URL: "postgresql://prod@prod.exemple.invalid:5432/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.exemple.invalid",
      SUPABASE_ACCESS_TOKEN: "terminal",
    });
    expect(r.statut, r.sortie).toBe(0);
    expect(r.json()).toEqual({
      e: "developpement",
      env: "developpement",
      url: "https://dev.exemple.invalid",
      db: "postgresql://dev@dev.exemple.invalid:5432/postgres",
    });
  });

  it("sans --production, « developpement » posé dans le terminal ne couvre pas un .env.local de production", () => {
    const dossier = dossierTemporaire({ ".env.local": envProd("production") });
    const r = voir(dossier, [], { SUPABASE_ENVIRONNEMENT: "developpement" });
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain("vaut « production » au lieu de « developpement »");
  });

  it("sans --production : .env.local comme avant, même si .env.scripts-production.local existe", () => {
    const dossier = dossierTemporaire({
      ".env.local": ENV_DEV,
      [FICHIER_PRODUCTION]: envProd("production"),
    });
    const r = voir(dossier, []);
    expect(r.statut, r.sortie).toBe(0);
    expect(r.json()).toMatchObject({
      e: "developpement",
      env: "developpement",
      url: "https://dev.exemple.invalid",
    });
  });

  it("sans --production, un .env.local qui ne vise pas le développement est refusé", () => {
    const dossier = dossierTemporaire({ ".env.local": envProd("production") });
    const r = voir(dossier, []);
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain("vaut « production » au lieu de « developpement »");
  });
});

describe("option --production mal écrite", () => {
  it.each(["--production=true", "--prod", "--Production", "-production", "--PRODUCTION"])(
    "%s est refusée, avec la bonne écriture",
    (option) => {
      const message = optionMalEcrite("db:push", [option], {});
      expect(message).toContain(`« ${option} » non reconnue`);
      expect(message).toContain("npm run db:push -- --production");
    },
  );

  it("npm run db:push --production (sans --) est refusé", () => {
    const message = optionMalEcrite("db:push", [], { npm_config_production: "true" });
    expect(message).toContain("lue par npm");
    expect(message).toContain("npm run db:push -- --production");
  });

  it("--production bien écrite et les autres options passent", () => {
    expect(optionMalEcrite("db:push", ["--production", "--yes"], {})).toBeNull();
    expect(optionMalEcrite("db:push", [], { npm_config_production: "" })).toBeNull();
  });

  it("db:push lancé comme par npm run db:push --production s'arrête avant toute connexion", () => {
    const dossier = dossierTemporaire({ ".env.local": ENV_DEV });
    const r = lancer("scripts/db-push.mjs", [], dossier, { env: { npm_config_production: "true" } });
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain("npm run db:push -- --production");
    expect(r.sortie).not.toContain("Application des migrations");
  });
});

describe("secrets envoyés à GitHub", () => {
  it("développement : les quatre secrets DEV_*", () => {
    expect(correspondances("developpement")).toEqual({
      DEV_SUPABASE_URL: "NEXT_PUBLIC_SUPABASE_URL",
      DEV_SUPABASE_PUBLISHABLE_KEY: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      DEV_SUPABASE_SECRET_KEY: "SUPABASE_SECRET_KEY",
      DEV_SUPABASE_DB_URL: "SUPABASE_DB_URL",
    });
  });

  it("production : SEULEMENT PROD_SUPABASE_DB_URL, jamais un secret DEV_*", () => {
    const prod = correspondances("production");
    expect(prod).toEqual({ PROD_SUPABASE_DB_URL: "SUPABASE_DB_URL" });
    expect(Object.keys(prod).some((nom) => nom.startsWith("DEV_"))).toBe(false);
  });
});

describe("scripts lancés avec --production", () => {
  it("db:push sans .env.scripts-production.local : arrêt avant toute connexion", () => {
    const dossier = dossierTemporaire({ ".env.local": ENV_DEV });
    const r = lancer("scripts/db-push.mjs", ["--production"], dossier);
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain(`${FICHIER_PRODUCTION} est introuvable`);
    expect(r.sortie).not.toContain("Application des migrations");
  });

  it("db:push avec un .env.scripts-production.local en « developpement » : refus", () => {
    const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: envProd("developpement") });
    const r = lancer("scripts/db-push.mjs", ["--production"], dossier);
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain("au lieu de « production »");
    expect(r.sortie).not.toContain("Application des migrations");
  });

  it("secrets:github sans .env.scripts-production.local : refus, rien n'est envoyé", () => {
    const dossier = dossierTemporaire({ ".env.local": ENV_DEV });
    const r = lancer("scripts/secrets-github.mjs", ["--production"], dossier);
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain(`${FICHIER_PRODUCTION} est introuvable`);
    expect(r.sortie).not.toContain("Secret");
  });

  it("secrets:github en production refuse une adresse qui n'est pas le pooler en mode session", () => {
    const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: envProd("production") });
    const r = lancer("scripts/secrets-github.mjs", ["--production"], dossier);
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain("pooler en mode session");
    expect(r.sortie).not.toContain("enregistré sur GitHub");
  });

  it("admin:creer sans .env.scripts-production.local : refus", () => {
    const dossier = dossierTemporaire({ ".env.local": ENV_DEV });
    const r = lancer("scripts/premier-admin.ts", ["--production"], dossier, { ts: true });
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain(`${FICHIER_PRODUCTION} est introuvable`);
  });

  it("admin:creer avec un .env.scripts-production.local correct passe le garde-fou (puis exige un terminal)", () => {
    const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: envProd("production") });
    const r = lancer("scripts/premier-admin.ts", ["--production"], dossier, { ts: true });
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain("Lancez ce script dans un terminal");
  });

  it.each([
    ["comptes:test", "scripts/comptes-de-test.ts", []],
    ["donnees:remplir", "scripts/donnees.ts", ["remplir"]],
    ["donnees:vider", "scripts/donnees.ts", ["vider"]],
    ["journal", "scripts/journal.ts", []],
  ])("%s refuse toujours la production, même avec un fichier correct", (_nom, script, args) => {
    const dossier = dossierTemporaire({ [FICHIER_PRODUCTION]: envProd("production") });
    const r = lancer(script, [...args, "--production"], dossier, { ts: true });
    expect(r.statut).toBe(1);
    expect(r.sortie).toContain("ne tourne jamais sur la production");
  });
});
