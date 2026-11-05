import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { optionsSentry } from "@/lib/sentry/options";
import { FICHIER_PRODUCTION } from "../../scripts/charger-environnement.mjs";
import configuration, { problemeContexteNetlify } from "../../next.config";

// Story 3.1 — version injectée au build (AD-11) et réglages Netlify.

const racine = fileURLToPath(new URL("../../", import.meta.url));
const lire = (chemin: string) => readFileSync(racine + chemin, "utf8").replace(/\r\n/g, "\n");
const paquet = JSON.parse(lire("package.json")) as { version: string };

describe("version de l'application", () => {
  it("package.json porte une version au format X.Y.Z", () => {
    expect(paquet.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("next.config.ts injecte NEXT_PUBLIC_APP_VERSION = « v » + la version de package.json", () => {
    expect(configuration.env?.NEXT_PUBLIC_APP_VERSION).toBe(`v${paquet.version}`);
  });

  it("le pied de page de l'espace équipe affiche la version injectée", () => {
    const miseEnPage = lire("app/equipe/layout.tsx");
    expect(miseEnPage).toMatch(/<footer[\s\S]*`Version \$\{process\.env\.NEXT_PUBLIC_APP_VERSION\}`[\s\S]*<\/footer>/);
    expect(miseEnPage).toContain('"Version inconnue"');
  });
});

describe("version et Sentry", () => {
  it("la version devient la « release » Sentry, sans suivi de session à chaque visite", () => {
    const options = optionsSentry({
      dsn: "https://cle@exemple.invalid/1",
      environnement: "developpement",
      version: `v${paquet.version}`,
    });
    expect(options.release).toBe(`v${paquet.version}`);
    type Integration = Parameters<typeof options.integrations>[0][number];
    const parDefaut = ["BrowserSession", "Breadcrumbs", "Dedupe"].map(
      (name) => ({ name }) as Integration,
    );
    expect(options.integrations(parDefaut).map((i) => i.name)).toEqual(["Breadcrumbs", "Dedupe"]);
  });
});

describe("garde-fou de construction sur Netlify", () => {
  it("hors Netlify : rien n'est vérifié", () => {
    expect(problemeContexteNetlify({})).toBeNull();
    expect(problemeContexteNetlify({ SUPABASE_ENVIRONNEMENT: "production" })).toBeNull();
  });

  it("production avec la base de production, prévisualisation et branche avec le développement : acceptés", () => {
    const netlify = { NETLIFY: "true" };
    expect(problemeContexteNetlify({ ...netlify, CONTEXT: "production", SUPABASE_ENVIRONNEMENT: "production" })).toBeNull();
    for (const contexte of ["deploy-preview", "branch-deploy", "dev"]) {
      expect(
        problemeContexteNetlify({ ...netlify, CONTEXT: contexte, SUPABASE_ENVIRONNEMENT: "developpement" }),
      ).toBeNull();
    }
  });

  it.each([
    ["production", "developpement"],
    ["production", undefined],
    ["deploy-preview", "production"],
    ["branch-deploy", "production"],
    ["deploy-preview", undefined],
  ])("contexte %s avec SUPABASE_ENVIRONNEMENT=%s : construction arrêtée", (contexte, environnement) => {
    const probleme = problemeContexteNetlify({
      NETLIFY: "true",
      CONTEXT: contexte,
      SUPABASE_ENVIRONNEMENT: environnement,
    });
    expect(probleme).toContain("SUPABASE_ENVIRONNEMENT doit valoir");
  });

  it("IP_DE_TEST_AUTORISEE sur Netlify : construction arrêtée", () => {
    const probleme = problemeContexteNetlify({
      NETLIFY: "true",
      CONTEXT: "deploy-preview",
      SUPABASE_ENVIRONNEMENT: "developpement",
      IP_DE_TEST_AUTORISEE: "1",
    });
    expect(probleme).toContain("IP_DE_TEST_AUTORISEE");
  });
});

describe("netlify.toml", () => {
  const toml = lire("netlify.toml");
  const reglages = toml
    .split("\n")
    .filter((ligne) => !ligne.trim().startsWith("#"))
    .join("\n");

  it("construit avec les vérifications rapides puis le build", () => {
    expect(reglages).toMatch(/^\s*command = "npm run verifier && npm run build"$/m);
  });

  it("utilise Node 22", () => {
    expect(reglages).toMatch(/^\[build\.environment\]\n\s*NODE_VERSION = "22"$/m);
  });

  it("ne contient aucune variable interdite ni aucun secret", () => {
    for (const interdit of [
      "IP_DE_TEST_AUTORISEE",
      "SUPABASE",
      "HMAC_SECRET",
      "RESEND",
      "SENTRY",
      "TEST_",
      "NEXT_PUBLIC_APP_VERSION",
    ]) {
      expect(reglages, interdit).not.toContain(interdit);
    }
    expect(toml).not.toMatch(/postgres(ql)?:\/\//);
    expect(toml).not.toMatch(/sb_(secret|publishable)_/);
  });
});

describe("fichier des clés de production des scripts", () => {
  it("n'est pas un nom que Next.js charge tout seul", () => {
    const nomsDeNext = [".env", ".env.local"];
    for (const mode of ["development", "production", "test"]) {
      nomsDeNext.push(`.env.${mode}`, `.env.${mode}.local`);
    }
    expect(nomsDeNext).not.toContain(FICHIER_PRODUCTION);
  });

  it("n'est chargé par @next/env dans aucun mode (développement, production, test)", () => {
    // Dans un processus à part : loadEnvConfig modifie process.env.
    const dossier = mkdtempSync(join(tmpdir(), "nova-3-1-next-"));
    try {
      writeFileSync(join(dossier, FICHIER_PRODUCTION), "NOVA_CHARGE_PAR_NEXT=oui\n");
      const nextEnv = createRequire(import.meta.url).resolve("@next/env");
      for (const [dev, nodeEnv] of [
        [true, undefined],
        [false, undefined],
        [false, "production"],
        [true, "test"],
      ] as const) {
        const code = `const { loadEnvConfig } = require(${JSON.stringify(nextEnv)});
          loadEnvConfig(${JSON.stringify(dossier)}, ${dev}, { info() {}, error() {} });
          console.log(process.env.NOVA_CHARGE_PAR_NEXT ?? "non");`;
        const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: nodeEnv };
        if (nodeEnv === undefined) delete env.NODE_ENV;
        const r = spawnSync(process.execPath, ["-e", code], {
          env: env as NodeJS.ProcessEnv,
          encoding: "utf8",
        });
        expect(r.stdout.trim(), `dev=${dev}, NODE_ENV=${nodeEnv}`).toBe("non");
      }
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it("est exclu de Git", () => {
    const r = spawnSync("git", ["check-ignore", "-q", FICHIER_PRODUCTION], { cwd: racine });
    expect(r.status).toBe(0);
  });
});

describe("dossier .netlify (fichiers générés pendant la construction)", () => {
  // Sur Netlify, la construction crée .netlify/ (extensions, déclarations
  // Deno) avant `npm run verifier` : le lint et le typage ne doivent pas
  // l'examiner, sinon la construction échoue (incident du 05/11/2026).
  it("est ignoré par ESLint, TypeScript et Git", () => {
    expect(lire("eslint.config.mjs")).toContain('".netlify/**"');
    const tsconfig = JSON.parse(lire("tsconfig.json")) as { exclude?: string[] };
    expect(tsconfig.exclude).toContain(".netlify");
    const git = spawnSync("git", ["check-ignore", "-q", ".netlify/essai.ts"], { cwd: racine });
    expect(git.status).toBe(0);
  });
});
