import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 1.9 — blocage de la connexion et message d'expiration (navigateur).
// Nécessite la migration 20261103000012 appliquée sur nova-dev. Comptes
// `TEST-…` jetables, IP de test propre à chaque test. Le blocage laisse une
// ligne « connexion bloquée » au journal (visible avec `npm run journal`).

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const comptes: CompteTest[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

test.afterAll(async () => {
  await supprimerComptesTest(comptes);
});

const MESSAGE_REFUS = "Email ou mot de passe incorrect.";
const MESSAGE_BLOCAGE = "Trop de tentatives. Réessayez dans 15 minutes.";
const MESSAGE_EXPIRATION = "Votre session a expiré. Reconnectez-vous.";

const champ = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });
const alerte = (page: Page) => page.locator("form").getByRole("alert");

async function seConnecter(page: Page, email: string, motDePasse: string) {
  await champ(page, "Email").fill(email);
  await champ(page, "Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

test.describe("sécuriser la connexion", () => {
  test("5 mauvais mots de passe → « Trop de tentatives… », puis le bon mot de passe est refusé", async ({
    page,
  }) => {
    const compte = await creerCompteTest({ etiquette: "1.9" });
    comptes.push(compte);

    await page.goto("/connexion");
    for (let i = 1; i <= 4; i += 1) {
      await seConnecter(page, compte.email, `mauvais-${i}`);
      await expect(alerte(page)).toHaveText(MESSAGE_REFUS);
      // Bouton réactivé : la réponse est arrivée avant l'essai suivant.
      await expect(page.getByRole("button", { name: "Se connecter" })).toBeEnabled();
    }

    await seConnecter(page, compte.email, "mauvais-5");
    await expect(alerte(page)).toHaveText(MESSAGE_BLOCAGE);
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeEnabled();
    await sansViolationAxe(page);

    await seConnecter(page, compte.email, compte.motDePasse);
    await expect(alerte(page)).toHaveText(MESSAGE_BLOCAGE);
    await expect(page).toHaveURL(/\/connexion$/);
    await page.goto("/equipe");
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipe$/);
  });

  test("après une session expirée : bandeau d'information au-dessus du formulaire", async ({
    page,
  }) => {
    await page.goto("/connexion?expiree=1&retour=%2Fequipe%2Fdemandes");
    const bandeau = page.getByRole("status").filter({ hasText: MESSAGE_EXPIRATION });
    await expect(bandeau).toBeVisible();
    // Au-dessus du formulaire : avant le champ Email.
    const boiteBandeau = await bandeau.boundingBox();
    const boiteEmail = await champ(page, "Email").boundingBox();
    expect(boiteBandeau && boiteEmail && boiteBandeau.y < boiteEmail.y).toBe(true);
    await sansViolationAxe(page);

    // Sans le paramètre : pas de bandeau.
    await page.goto("/connexion");
    await expect(page.getByText(MESSAGE_EXPIRATION)).toHaveCount(0);
  });
});
