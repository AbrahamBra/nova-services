import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 3.1 — « Version vX.Y.Z » (version de package.json) en bas des pages internes (AD-11, NFR-4).
// Comptes `TEST-…` jetables, supprimés à la fin. Jamais contre la production.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const comptes: CompteTest[] = [];
const paquet = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const VERSION = `Version v${paquet.version}`;

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

test.afterAll(async () => {
  await supprimerComptesTest(comptes);
});

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("la version est affichée en bas des pages internes", async ({ page }) => {
  const admin = await creerCompteTest({ etiquette: "3.1", role: "administrateur" });
  comptes.push(admin);

  await seConnecter(page, admin, "/equipe");
  await expect(page).toHaveURL(/\/equipe$/, { timeout: 15_000 });
  expect(paquet.version).toMatch(/^\d+\.\d+\.\d+$/);
  await expect(page.getByRole("contentinfo")).toHaveText(VERSION);

  await page.goto("/equipe/admin");
  await expect(page.getByRole("contentinfo")).toHaveText(VERSION);

  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
});
