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

// Story 4.1 — inviter un membre (navigateur), ordinateur et téléphone.
// Critère 1 : l'administrateur invite « Léo Martin » Collaborateur ; la liste
// l'affiche « Invité » et la fenêtre montre son lien avec « Copier ».
// Critère 2 : ce lien, dans un autre navigateur ; « Continuer », mot de passe
// de 7 caractères refusé (compte toujours invité), puis 8+ : /equipe, et la
// liste l'affiche « Actif ». Lien réutilisé : « Ce lien n'est plus valable… ».
// Critère 3 : email déjà utilisé (casse différente), message sous Email.
// Un collaborateur est refusé. Contrôle axe à chaque écran.
// Comptes `TEST-4.1-…` jetables ; les invités créés par l'écran sont
// retrouvés par leur email puis supprimés (avec les lignes de journal de
// l'administrateur, qui le citent comme auteur).

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const MESSAGE_LIEN = "Ce lien n'est plus valable. Contactez votre administrateur.";

const comptes: CompteTest[] = [];
const emailsInvites: string[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  try {
    await avecBase(async (base) => {
      // Invités créés par l'écran : ajoutés à la liste de nettoyage.
      if (emailsInvites.length > 0) {
        const { rows } = await base.query<{ id: string; nom: string; email: string }>(
          "select id, nom, email from public.membres where email = any($1::text[])",
          [emailsInvites],
        );
        for (const r of rows) {
          comptes.push({ ...r, motDePasse: "", role: "collaborateur", etat: "invite" });
        }
      }
    });
    await effacerJournalDesComptesTest(comptes.map((c) => c.id));
  } catch (erreur) {
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`);
  }
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "4.1", ...options });
  comptes.push(c);
  return c;
}

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Bandeau « Ce lien n'est plus valable… » (hors annonceur de navigation de Next.js). */
function alerteLien(page: Page) {
  return page.getByRole("alert").filter({ hasText: MESSAGE_LIEN });
}

/** Ligne (ordinateur) ou carte (téléphone) visible d'un compte. */
function ligneCompte(page: Page, email: string) {
  return page.locator(`[data-compte="${email}"]:visible`);
}

function nouvelInvite() {
  const code = randomUUID().slice(0, 8);
  const invite = { nom: `TEST-4.1-${code} Léo Martin`, email: `test-4-1-${code}@example.com` };
  emailsInvites.push(invite.email);
  return invite;
}

async function inviterDepuisLaPage(page: Page, nom: string, email: string) {
  await page.getByRole("button", { name: "Inviter un membre" }).click();
  const fenetre = page.getByRole("dialog", { name: "Inviter un membre" });
  await expect(fenetre).toBeVisible();
  await fenetre.getByLabel("Nom et prénom").fill(nom);
  await fenetre.getByLabel("Email").fill(email);
  return fenetre;
}

/** Ouvre le lien dans un autre navigateur (nouveau contexte, sans session). */
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
  const url = new URL(lien);
  await page.goto(url.pathname + url.search);
  return page;
}

test.describe("inviter un membre", () => {
  test("critères 1 et 2 : invitation, lien copié, mot de passe choisi, compte actif ; lien réutilisé refusé", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = nouvelInvite();

    // L'administration mène à « Comptes ».
    await seConnecter(page, admin, "/equipe/admin");
    await expect(page).toHaveURL(/\/equipe\/admin\/comptes$/, APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();
    await expect(page).toHaveTitle("Comptes — Nova Services");
    await sansViolationAxe(page);

    // Critère 1 : invitation de Léo, rôle Collaborateur par défaut.
    const fenetre = await inviterDepuisLaPage(page, leo.nom, leo.email);
    await expect(fenetre.getByLabel("Rôle")).toHaveValue("collaborateur");
    await sansViolationAxe(page);
    await fenetre.getByRole("button", { name: "Inviter", exact: true }).click();

    const fenetreLien = page.getByRole("dialog", { name: "Lien d'invitation" });
    await expect(fenetreLien).toBeVisible(NAVIGATION);
    const champLien = fenetreLien.getByRole("textbox", { name: "Lien d'invitation" });
    await expect(champLien).toHaveAttribute("readonly", "");
    const lien = await champLien.inputValue();
    expect(lien).toMatch(/\/auth\/confirmer\?token_hash=[A-Za-z0-9_-]+&type=invite$/);
    await expect(fenetreLien.getByText("Ce lien est valable 24 h.")).toBeVisible();
    await fenetreLien.getByRole("button", { name: "Copier" }).click();
    await expect(fenetreLien.getByRole("button", { name: "Copié" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(lien);
    await sansViolationAxe(page);

    await page.keyboard.press("Escape");
    await expect(fenetreLien).toBeHidden();
    await expect(page.getByRole("button", { name: "Inviter un membre" })).toBeFocused();
    await expect(ligneCompte(page, leo.email)).toContainText("Invité");
    await expect(ligneCompte(page, leo.email)).toContainText("Collaborateur");
    await expect(ligneCompte(page, leo.email)).toContainText(leo.nom);

    // Critère 2 : le lien, dans un autre navigateur.
    const pageLeo = await autreNavigateur(browser, lien);
    try {
      await expect(
        pageLeo.getByRole("heading", { level: 1, name: "Bienvenue chez Nova Services" }),
      ).toBeVisible();
      await sansViolationAxe(pageLeo);
      await pageLeo.getByRole("button", { name: "Continuer" }).click();
      await expect(pageLeo).toHaveURL(/\/nouveau-mot-de-passe$/, NAVIGATION);
      const prenom = leo.nom.split(" ")[0];
      await expect(
        pageLeo.getByRole("heading", { level: 1, name: `Bienvenue chez Nova Services, ${prenom}` }),
      ).toBeVisible();
      await expect(pageLeo.getByText("8 caractères minimum")).toBeVisible();
      await sansViolationAxe(pageLeo);

      // 7 caractères : refusé sous le champ, compte toujours invité.
      await pageLeo.getByLabel("Mot de passe", { exact: true }).fill("1234567");
      await pageLeo.getByLabel("Confirmation du mot de passe").fill("1234567");
      await pageLeo.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
      await expect(
        pageLeo.getByText("Le mot de passe doit contenir au moins 8 caractères."),
      ).toBeVisible();
      await expect(pageLeo.getByLabel("Mot de passe", { exact: true })).toBeFocused();
      const etatAvant = await avecBase((b) =>
        b.query("select etat from public.membres where email = $1", [leo.email]),
      );
      expect(etatAvant.rows[0].etat).toBe("invite");

      // 8 caractères ou plus : l'espace équipe.
      const motDePasse = `mdp-${randomUUID()}`;
      await pageLeo.getByLabel("Mot de passe", { exact: true }).fill(motDePasse);
      await pageLeo.getByLabel("Confirmation du mot de passe").fill(motDePasse);
      await pageLeo.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
      await expect(pageLeo).toHaveURL(/\/equipe$/, NAVIGATION);
      await expect(pageLeo.getByRole("heading", { level: 1, name: `Bonjour ${prenom}` })).toBeVisible();
    } finally {
      await pageLeo.context().close();
    }

    // La liste l'affiche « Actif ».
    await page.reload();
    await expect(ligneCompte(page, leo.email)).toContainText("Actif", NAVIGATION);

    // Lien réutilisé : refusé.
    const pageReutilise = await autreNavigateur(browser, lien);
    try {
      await pageReutilise.getByRole("button", { name: "Continuer" }).click();
      await expect(alerteLien(pageReutilise)).toBeVisible(NAVIGATION);
      await expect(pageReutilise).toHaveURL(/\/auth\/confirmer\?/);
      await expect(pageReutilise.getByRole("button", { name: "Continuer" })).toHaveCount(0);
      await sansViolationAxe(pageReutilise);
    } finally {
      await pageReutilise.context().close();
    }

    // Journal : une ligne « compte_cree » au nom de l'administrateur.
    const journal = await avecBase((b) =>
      b.query(
        `select j.details from public.journal j
           join public.membres m on m.id = (j.details->>'membre_id')::uuid
          where j.type = 'compte' and j.auteur_id = $1 and m.email = $2`,
        [admin.id, leo.email],
      ),
    );
    expect(journal.rows).toHaveLength(1);
    expect(journal.rows[0].details).toMatchObject({
      evenement: "compte_cree",
      nom: leo.nom,
      role: "collaborateur",
    });
  });

  test("critère 3 : un email déjà utilisé (casse différente) est signalé sous le champ, la saisie reste", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const karim = await compte({ role: "collaborateur", prenom: "Karim" });

    await seConnecter(page, admin, "/equipe/admin/comptes");
    await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible(APRES_CONNEXION);

    const nom = `TEST-4.1-${randomUUID().slice(0, 8)} Doublon`;
    const fenetre = await inviterDepuisLaPage(page, nom, karim.email.toUpperCase());
    await fenetre.getByRole("button", { name: "Inviter", exact: true }).click();
    await expect(
      fenetre.getByText("Cette adresse email est déjà utilisée par un autre membre."),
    ).toBeVisible(NAVIGATION);
    await expect(fenetre.getByLabel("Email")).toBeFocused();
    await expect(fenetre.getByLabel("Nom et prénom")).toHaveValue(nom);
    await expect(fenetre.getByLabel("Email")).toHaveValue(karim.email.toUpperCase());
    await sansViolationAxe(page);

    const { rows } = await avecBase((b) =>
      b.query("select count(*)::int as n from public.membres where email = $1", [karim.email]),
    );
    expect(rows[0].n).toBe(1);
  });

  test("champs vides : erreurs sous les champs, focus sur le premier", async ({ page }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    await seConnecter(page, admin, "/equipe/admin/comptes");
    await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible(APRES_CONNEXION);
    await page.getByRole("button", { name: "Inviter un membre" }).click();
    const fenetre = page.getByRole("dialog", { name: "Inviter un membre" });
    await fenetre.getByRole("button", { name: "Inviter", exact: true }).click();
    await expect(fenetre.getByText("Indiquez le nom et prénom du membre.")).toBeVisible();
    await expect(fenetre.getByText("Indiquez l'adresse email du membre.")).toBeVisible();
    await expect(fenetre.getByLabel("Nom et prénom")).toBeFocused();
  });

  test("un collaborateur n'a ni la page Comptes ni le menu Administration", async ({ page }) => {
    const collaborateur = await compte({ role: "collaborateur" });
    await seConnecter(page, collaborateur, "/equipe/admin/comptes");
    await expect(page).toHaveURL(/\/equipe\/admin\/comptes$/, APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Vous n'avez pas accès à cette page.",
    );
    await expect(page).toHaveTitle("Accès refusé — Nova Services");
    await expect(page.getByRole("button", { name: "Inviter un membre" })).toHaveCount(0);
    await sansViolationAxe(page);
  });

  test("/nouveau-mot-de-passe sans lien : « Ce lien n'est plus valable… » ; lien mal formé aussi", async ({
    page,
  }) => {
    await page.goto("/nouveau-mot-de-passe");
    await expect(alerteLien(page)).toBeVisible();
    await sansViolationAxe(page);

    await page.goto("/auth/confirmer?token_hash=x&type=invite");
    await expect(alerteLien(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuer" })).toHaveCount(0);
  });
});
