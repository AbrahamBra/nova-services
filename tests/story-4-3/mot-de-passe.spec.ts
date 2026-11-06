import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 4.3 — mot de passe oublié (navigateur), ordinateur et téléphone.
// Critère 1 : « Mot de passe oublié » depuis la connexion ; le même message
// pour un email inconnu et pour un membre actif.
// Critère 2 (partie automatique) : un lien de réinitialisation permet de
// choisir un nouveau mot de passe puis de se connecter avec. L'email reçu par
// Abraham se vérifie à la main (EMAILS_AUTORISES vide pour les tests).
// Critère 3 : l'administratrice génère un lien pour un membre actif ; il
// s'affiche avec « Copier » ; journal `lien_mot_de_passe_genere`.
// Critère 4 : lien déjà utilisé, « Ce lien n'est plus valable. » et
// « Demander un nouveau lien ». Session ouverte par mot de passe : pas de
// changement de mot de passe. Contrôle axe à chaque écran.
// Comptes `TEST-4.3-…` jetables, supprimés avec leurs lignes de journal.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const MESSAGE_COMMUN =
  "Si un compte actif correspond à cette adresse, un email avec un lien valable 24 h vient de lui être envoyé. Sans email, demandez un lien à votre administrateur.";
const LIEN_PLUS_VALABLE = "Ce lien n'est plus valable.";

const comptes: CompteTest[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "4.3", ...options });
  comptes.push(c);
  return c;
}

async function seConnecter(page: Page, email: string, motDePasse: string, retour = "/equipe") {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Ligne (ordinateur) ou carte (téléphone) visible d'un compte. */
function ligneCompte(page: Page, email: string) {
  return page.locator(`[data-compte="${email}"]:visible`);
}

/** Bandeau « Ce lien n'est plus valable. » (hors annonceur de navigation de Next.js). */
function alerteLien(page: Page) {
  return page.getByRole("alert").filter({ hasText: LIEN_PLUS_VALABLE });
}

/** Ouvre une adresse dans un autre navigateur (nouveau contexte, sans session). */
async function autreNavigateur(browser: Browser, lien: string): Promise<Page> {
  const u = test.info().project.use;
  const contexte = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    locale: u.locale,
    timezoneId: u.timezoneId,
  });
  await utiliserIpDeTest(contexte);
  const page = await contexte.newPage();
  const url = new URL(lien, u.baseURL);
  await page.goto(url.pathname + url.search);
  return page;
}

test.describe("mot de passe oublié", () => {
  test("critère 1 : même message pour un email inconnu et pour un membre actif", async ({ page }) => {
    const leo = await compte({ prenom: "Leo" });

    await page.goto("/connexion");
    await page.getByRole("link", { name: "Mot de passe oublié" }).click();
    await expect(page).toHaveURL(/\/mot-de-passe-oublie$/, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: "Mot de passe oublié" })).toBeVisible();
    await expect(page).toHaveTitle("Mot de passe oublié — Nova Services");
    await sansViolationAxe(page);

    // Adresse mal formée : erreur sous le champ, pas de message.
    await page.getByLabel("Email").fill("pas une adresse");
    await page.getByRole("button", { name: "Recevoir un lien" }).click();
    await expect(page.getByText("Cette adresse email ne semble pas valide.")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByText(MESSAGE_COMMUN)).toHaveCount(0);

    const messages: string[] = [];
    for (const email of [`inconnu-${randomUUID().slice(0, 8)}@example.com`, leo.email]) {
      await page.goto("/mot-de-passe-oublie");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Recevoir un lien" }).click();
      const statut = page.getByRole("status").filter({ hasText: "Si un compte actif" });
      await expect(statut).toBeVisible(NAVIGATION);
      messages.push((await statut.innerText()).trim());
      await expect(page.getByLabel("Email")).toHaveValue(email);
      await sansViolationAxe(page);
    }
    expect(messages).toEqual([MESSAGE_COMMUN, MESSAGE_COMMUN]);
  });

  test("critères 2, 3 et 4 : lien généré par l'administratrice, nouveau mot de passe, connexion, lien réutilisé refusé", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await compte({ prenom: "Leo" });

    // Critère 3 : « Générer un lien de mot de passe » sur la ligne de Léo.
    await seConnecter(page, admin.email, admin.motDePasse, "/equipe/admin/comptes");
    await expect(page).toHaveURL(/\/equipe\/admin\/comptes$/, APRES_CONNEXION);
    // Jamais sur sa propre ligne.
    await expect(
      ligneCompte(page, admin.email).getByRole("button", { name: /Générer un lien de mot de passe/ }),
    ).toHaveCount(0);
    const bouton = ligneCompte(page, leo.email).getByRole("button", {
      name: /Générer un lien de mot de passe/,
    });
    await bouton.click();

    const fenetre = page.getByRole("dialog", { name: "Lien de mot de passe" });
    await expect(fenetre).toBeVisible(NAVIGATION);
    const champ = fenetre.getByRole("textbox", { name: "Lien de mot de passe" });
    await expect(champ).toHaveAttribute("readonly", "");
    const lien = await champ.inputValue();
    expect(lien).toMatch(/\/auth\/confirmer\?token_hash=[A-Za-z0-9_-]+&type=recovery$/);
    await expect(fenetre.getByText("Ce lien est valable 24 h.")).toBeVisible();
    await fenetre.getByRole("button", { name: "Copier" }).click();
    await expect(fenetre.getByRole("button", { name: "Copié" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(lien);
    await sansViolationAxe(page);
    await page.keyboard.press("Escape");
    await expect(fenetre).toBeHidden();
    await expect(bouton).toBeFocused();

    // Journal : une ligne au nom de l'administratrice.
    const journal = await avecBase((b) =>
      b.query(
        `select details from public.journal
          where type = 'compte' and auteur_id = $1 and details->>'membre_id' = $2`,
        [admin.id, leo.id],
      ),
    );
    expect(journal.rows.map((l) => l.details)).toEqual([
      { evenement: "lien_mot_de_passe_genere", membre_id: leo.id, nom: leo.nom },
    ]);

    // Critère 2 : le lien, dans le navigateur de Léo.
    const nouveau = `mdp-${randomUUID()}`;
    const pageLeo = await autreNavigateur(browser, lien);
    try {
      await expect(pageLeo.getByRole("heading", { level: 1, name: "Nouveau mot de passe" })).toBeVisible();
      await sansViolationAxe(pageLeo);
      await pageLeo.getByRole("button", { name: "Continuer" }).click();
      await expect(pageLeo).toHaveURL(/\/nouveau-mot-de-passe$/, NAVIGATION);
      await expect(
        pageLeo.getByRole("heading", { level: 1, name: "Choisissez un nouveau mot de passe" }),
      ).toBeVisible();
      await expect(pageLeo.getByText("8 caractères minimum")).toBeVisible();
      await sansViolationAxe(pageLeo);

      await pageLeo.getByLabel("Mot de passe", { exact: true }).fill("1234567");
      await pageLeo.getByLabel("Confirmation du mot de passe").fill("1234567");
      await pageLeo.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
      await expect(pageLeo.getByText("Le mot de passe doit contenir au moins 8 caractères.")).toBeVisible();

      await pageLeo.getByLabel("Mot de passe", { exact: true }).fill(nouveau);
      await pageLeo.getByLabel("Confirmation du mot de passe").fill(nouveau);
      await pageLeo.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
      await expect(pageLeo).toHaveURL(/\/equipe$/, NAVIGATION);
    } finally {
      await pageLeo.context().close();
    }

    // Connexion avec le nouveau mot de passe ; l'ancien est refusé.
    const pageConnexion = await autreNavigateur(browser, "/connexion");
    try {
      await seConnecter(pageConnexion, leo.email, leo.motDePasse);
      await expect(pageConnexion.getByText("Email ou mot de passe incorrect.")).toBeVisible(NAVIGATION);
      await seConnecter(pageConnexion, leo.email, nouveau);
      await expect(pageConnexion).toHaveURL(/\/equipe$/, APRES_CONNEXION);

      // Session ouverte par mot de passe : pas de changement de mot de passe.
      await pageConnexion.goto("/nouveau-mot-de-passe");
      await expect(alerteLien(pageConnexion)).toBeVisible(NAVIGATION);
      await expect(pageConnexion.getByLabel("Mot de passe", { exact: true })).toHaveCount(0);
      await expect(pageConnexion.getByRole("link", { name: "Demander un nouveau lien" })).toBeVisible();
      await sansViolationAxe(pageConnexion);
    } finally {
      await pageConnexion.context().close();
    }

    // Critère 4 : lien déjà utilisé.
    const pageReutilise = await autreNavigateur(browser, lien);
    try {
      await pageReutilise.getByRole("button", { name: "Continuer" }).click();
      await expect(alerteLien(pageReutilise)).toBeVisible(NAVIGATION);
      await expect(alerteLien(pageReutilise)).not.toContainText("Contactez votre administrateur");
      await expect(pageReutilise.getByRole("button", { name: "Continuer" })).toHaveCount(0);
      await sansViolationAxe(pageReutilise);
      await pageReutilise.getByRole("link", { name: "Demander un nouveau lien" }).click();
      await expect(pageReutilise).toHaveURL(/\/mot-de-passe-oublie$/, NAVIGATION);
    } finally {
      await pageReutilise.context().close();
    }
  });

  test("lien de réinitialisation mal formé : « Ce lien n'est plus valable. » et « Demander un nouveau lien »", async ({
    page,
  }) => {
    await page.goto("/auth/confirmer?token_hash=court&type=recovery");
    await expect(page.getByRole("heading", { level: 1, name: "Nouveau mot de passe" })).toBeVisible();
    await expect(alerteLien(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuer" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Demander un nouveau lien" })).toBeVisible();
    await sansViolationAxe(page);
  });
});
