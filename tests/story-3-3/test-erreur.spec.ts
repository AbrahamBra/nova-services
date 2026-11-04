import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";

// Story 3.3 — page de test du suivi des erreurs (navigateur).
// Chaque test crée ses propres comptes `TEST-…` jetables, supprimés à la fin.
// Avec ou sans DSN Sentry, l'écran est le même ; l'arrivée de l'erreur dans
// Sentry se vérifie à la main (sans DSN, rien n'est envoyé).

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const comptes: CompteTest[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  await supprimerComptesTest(comptes);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "3.3", ...options });
  comptes.push(c);
  return c;
}

const APRES_CONNEXION = { timeout: 15_000 };

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

test.describe("page de test du suivi des erreurs", () => {
  test("un collaborateur est refusé", async ({ page }) => {
    const collaborateur = await compte({ role: "collaborateur" });
    await seConnecter(page, collaborateur, "/equipe/admin/test-erreur");
    await expect(page).toHaveURL(/\/equipe\/admin\/test-erreur$/, APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Vous n'avez pas accès à cette page.",
    );
    await expect(page).toHaveTitle("Accès refusé — Nova Services");
    await expect(page.getByRole("button", { name: "Provoquer une erreur de test" })).toHaveCount(0);
  });

  test("un administrateur y accède depuis l'administration et voit l'écran de confirmation", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur" });
    await seConnecter(page, admin, "/equipe/admin");
    await expect(page).toHaveURL(/\/equipe\/admin$/, APRES_CONNEXION);

    await page.getByRole("link", { name: "Page de test du suivi des erreurs" }).click();
    await expect(page).toHaveURL(/\/equipe\/admin\/test-erreur$/);
    await expect(page.getByRole("heading", { level: 1, name: "Test du suivi des erreurs" })).toBeVisible();
    await expect(page).toHaveTitle("Test du suivi des erreurs — Nova Services");
    await sansViolationAxe(page);

    await page.getByRole("button", { name: "Provoquer une erreur de test" }).click();
    const confirmation = page.getByText("L'erreur de test a été envoyée au suivi des erreurs.");
    await expect(confirmation).toBeVisible();
    await sansViolationAxe(page);

    // « Réessayer » ramène le bouton.
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(page.getByRole("button", { name: "Provoquer une erreur de test" })).toBeVisible();
    await expect(confirmation).toHaveCount(0);
  });
});
