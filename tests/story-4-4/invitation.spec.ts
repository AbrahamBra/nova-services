import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  clientServiceTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 4.4 — renvoyer ou annuler une invitation (navigateur), ordinateur et
// téléphone.
// Critère 1 : « Renvoyer l'invitation » sur Léo « Invité » affiche un nouveau
// lien de 24 h avec « Copier » ; journal `invitation_renvoyee`.
// Critère 2 : l'ancien lien (remplacé) : « Ce lien n'est plus valable.
// Contactez votre administrateur. » ; le nouveau mène au choix du mot de
// passe, Léo « Actif ».
// Critère 3 : « Annuler l'invitation », confirmation (« Retour »
// sélectionné) : Léo disparaît de la liste, son compte Auth est supprimé et
// l'adresse peut être réinvitée ; le focus va à « Inviter un membre ».
// Lien déjà ouvert sans mot de passe choisi : le renvoi donne un lien
// `recovery` qui mène au choix du mot de passe (version invitation) et
// active Léo. Contrôle axe à chaque écran.
// Invités créés comme par l'action `inviter` (compte Auth non confirmé +
// `creer_membre` invite), nom `TEST-4.4-…`, supprimés en fin de test.

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
      // Invités recréés par l'écran (réinvitation) : ajoutés au nettoyage.
      if (emailsInvites.length > 0) {
        const { rows } = await base.query<{ id: string; nom: string; email: string }>(
          "select id, nom, email from public.membres where email = any($1::text[])",
          [emailsInvites],
        );
        for (const r of rows) {
          if (!comptes.some((c) => c.id === r.id)) {
            comptes.push({ ...r, motDePasse: "", role: "collaborateur", etat: "invite" });
          }
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
  const c = await creerCompteTest({ etiquette: "4.4", ...options });
  comptes.push(c);
  return c;
}

/** Invité en attente, comme après « Inviter un membre » ; renvoie aussi son lien. */
async function inviteEnAttente(): Promise<CompteTest & { lien: string }> {
  const code = randomUUID().slice(0, 8);
  const nom = `TEST-4.4-${code} Léo Martin`;
  const email = `test-4-4-${code}@example.com`;
  emailsInvites.push(email);
  const service = clientServiceTest();
  const { data, error } = await service.auth.admin.generateLink({ type: "invite", email });
  if (error) throw new Error(`generateLink : ${error.code ?? error.status}`);
  const c: CompteTest = { id: data.user.id, nom, email, motDePasse: "", role: "collaborateur", etat: "invite" };
  comptes.push(c);
  const { error: erreurMembre } = await service.rpc("creer_membre", {
    p_id: c.id,
    p_nom: nom,
    p_email: email,
    p_role: "collaborateur",
    p_etat: "invite",
  });
  if (erreurMembre) throw new Error(`creer_membre : ${erreurMembre.message}`);
  const parametres = new URLSearchParams({ token_hash: data.properties.hashed_token, type: "invite" });
  return { ...c, lien: `/auth/confirmer?${parametres.toString()}` };
}

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function ouvrirComptes(page: Page, admin: CompteTest) {
  await seConnecter(page, admin, "/equipe/admin/comptes");
  await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible(APRES_CONNEXION);
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

function alerteLien(page: Page) {
  return page.getByRole("alert").filter({ hasText: MESSAGE_LIEN });
}

/** Ligne (ordinateur) ou carte (téléphone) visible d'un compte. */
function ligneCompte(page: Page, email: string) {
  return page.locator(`[data-compte="${email}"]:visible`);
}

function toast(page: Page, texte: string) {
  return page.getByTestId("toast").filter({ hasText: texte });
}

/** Ouvre un lien dans un autre navigateur (nouveau contexte, sans session). */
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
  const url = new URL(lien, "http://localhost");
  await page.goto(url.pathname + url.search);
  return page;
}

async function journal(adminId: string, membreId: string) {
  const { rows } = await avecBase((b) =>
    b.query<{ details: Record<string, unknown> }>(
      `select details from public.journal
        where type = 'compte' and auteur_id = $1 and details ->> 'membre_id' = $2
        order by id`,
      [adminId, membreId],
    ),
  );
  return rows.map((r) => r.details);
}

test.describe("renvoyer ou annuler une invitation", () => {
  test("critères 1 et 2 : nouveau lien de 24 h ; l'ancien refusé, le nouveau active Léo", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await inviteEnAttente();
    const actif = await compte({ prenom: "Karim" });

    await ouvrirComptes(page, admin);
    await sansViolationAxe(page);
    // Les boutons d'invitation ne sont proposés qu'à un compte Invité.
    await expect(ligneCompte(page, actif.email).getByRole("button", { name: "Renvoyer l'invitation" })).toHaveCount(0);
    await expect(ligneCompte(page, actif.email).getByRole("button", { name: "Annuler l'invitation" })).toHaveCount(0);

    // Critère 1 : nouveau lien.
    const bouton = ligneCompte(page, leo.email).getByRole("button", { name: "Renvoyer l'invitation" });
    await bouton.click();
    const fenetreLien = page.getByRole("dialog", { name: "Lien d'invitation" });
    await expect(fenetreLien).toBeVisible(NAVIGATION);
    const champLien = fenetreLien.getByRole("textbox", { name: "Lien d'invitation" });
    await expect(champLien).toHaveAttribute("readonly", "");
    const nouveauLien = await champLien.inputValue();
    expect(nouveauLien).toMatch(/\/auth\/confirmer\?token_hash=[A-Za-z0-9_-]+&type=invite$/);
    expect(new URL(nouveauLien).search).not.toBe(new URL(leo.lien, "http://localhost").search);
    await expect(fenetreLien.getByText("Ce lien est valable 24 h.")).toBeVisible();
    await fenetreLien.getByRole("button", { name: "Copier" }).click();
    await expect(fenetreLien.getByRole("button", { name: "Copié" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(nouveauLien);
    await sansViolationAxe(page);
    await page.keyboard.press("Escape");
    await expect(fenetreLien).toBeHidden();
    await expect(bouton).toBeFocused();
    await expect(ligneCompte(page, leo.email)).toContainText("Invité");

    expect(await journal(admin.id, leo.id)).toEqual([
      { evenement: "invitation_renvoyee", membre_id: leo.id, nom: leo.nom },
    ]);

    // Critère 2 : l'ancien lien est refusé.
    const pageAncien = await autreNavigateur(browser, leo.lien);
    try {
      await pageAncien.getByRole("button", { name: "Continuer" }).click();
      await expect(alerteLien(pageAncien)).toBeVisible(NAVIGATION);
      await expect(pageAncien.getByRole("button", { name: "Continuer" })).toHaveCount(0);
      await sansViolationAxe(pageAncien);
    } finally {
      await pageAncien.context().close();
    }

    // Le nouveau lien mène au choix du mot de passe.
    const pageLeo = await autreNavigateur(browser, nouveauLien);
    try {
      await pageLeo.getByRole("button", { name: "Continuer" }).click();
      await expect(pageLeo).toHaveURL(/\/nouveau-mot-de-passe$/, NAVIGATION);
      const motDePasse = `mdp-${randomUUID()}`;
      await pageLeo.getByLabel("Mot de passe", { exact: true }).fill(motDePasse);
      await pageLeo.getByLabel("Confirmation du mot de passe").fill(motDePasse);
      await pageLeo.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
      await expect(pageLeo).toHaveURL(/\/equipe$/, NAVIGATION);
    } finally {
      await pageLeo.context().close();
    }

    await page.reload();
    await expect(ligneCompte(page, leo.email)).toContainText("Actif", NAVIGATION);
    await expect(
      ligneCompte(page, leo.email).getByRole("button", { name: "Renvoyer l'invitation" }),
    ).toHaveCount(0);
  });

  test("critère 3 : invitation annulée après confirmation ; l'adresse peut être réinvitée", async ({ page }) => {
    test.setTimeout(120_000);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await inviteEnAttente();

    await ouvrirComptes(page, admin);
    const ouvrir = () =>
      ligneCompte(page, leo.email).getByRole("button", { name: "Annuler l'invitation" }).click();

    // « Retour » : sélectionné à l'ouverture, rien ne change.
    await ouvrir();
    const fenetre = page.getByRole("alertdialog", { name: "Annuler l'invitation" });
    await expect(fenetre).toBeVisible();
    await expect(fenetre).toContainText(
      `L'invitation de ${leo.nom} sera annulée et son compte disparaîtra de la liste.`,
    );
    await expect(fenetre.getByRole("button", { name: "Retour" })).toBeFocused();
    await sansViolationAxe(page);
    await fenetre.getByRole("button", { name: "Retour" }).click();
    await expect(fenetre).toBeHidden();
    await expect(ligneCompte(page, leo.email)).toContainText("Invité");

    // Confirmation : Léo disparaît de la liste.
    await ouvrir();
    await fenetre.getByRole("button", { name: "Annuler l'invitation", exact: true }).click();
    await expect(toast(page, "Invitation annulée.")).toBeVisible(NAVIGATION);
    await expect(fenetre).toBeHidden();
    await expect(page.locator(`[data-compte="${leo.email}"]`)).toHaveCount(0, NAVIGATION);
    // La ligne a disparu : le focus va au bouton « Inviter un membre ».
    await expect(page.getByRole("button", { name: "Inviter un membre" })).toBeFocused();

    // Base : ligne membres et compte Auth supprimés, journal écrit.
    const restes = await avecBase(async (b) => ({
      membres: (await b.query("select 1 from public.membres where id = $1", [leo.id])).rowCount,
      auth: (await b.query("select 1 from auth.users where id = $1", [leo.id])).rowCount,
    }));
    expect(restes).toEqual({ membres: 0, auth: 0 });
    expect(await journal(admin.id, leo.id)).toEqual([
      { evenement: "invitation_annulee", membre_id: leo.id, nom: leo.nom },
    ]);

    // L'adresse est de nouveau libre : réinvitation.
    await page.getByRole("button", { name: "Inviter un membre" }).click();
    const invitation = page.getByRole("dialog", { name: "Inviter un membre" });
    await invitation.getByLabel("Nom et prénom").fill(leo.nom);
    await invitation.getByLabel("Email").fill(leo.email);
    await invitation.getByRole("button", { name: "Inviter", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Lien d'invitation" })).toBeVisible(NAVIGATION);
    await page.keyboard.press("Escape");
    await expect(ligneCompte(page, leo.email)).toContainText("Invité");
    await sansViolationAxe(page);
  });
  test("lien déjà ouvert sans mot de passe choisi : le renvoi donne un lien qui active Léo", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await inviteEnAttente();

    // Léo ouvre son lien (« Continuer ») puis s'arrête : compte Auth confirmé,
    // toujours « Invité ».
    const pageOuverte = await autreNavigateur(browser, leo.lien);
    try {
      await pageOuverte.getByRole("button", { name: "Continuer" }).click();
      await expect(pageOuverte).toHaveURL(/\/nouveau-mot-de-passe$/, NAVIGATION);
    } finally {
      await pageOuverte.context().close();
    }

    await ouvrirComptes(page, admin);
    await ligneCompte(page, leo.email).getByRole("button", { name: "Renvoyer l'invitation" }).click();
    const fenetreLien = page.getByRole("dialog", { name: "Lien d'invitation" });
    await expect(fenetreLien).toBeVisible(NAVIGATION);
    const lien = await fenetreLien.getByRole("textbox", { name: "Lien d'invitation" }).inputValue();
    expect(lien).toMatch(/\/auth\/confirmer\?token_hash=[A-Za-z0-9_-]+&type=recovery$/);
    await page.keyboard.press("Escape");

    // Le lien mène à la version invitation du choix du mot de passe.
    const pageLeo = await autreNavigateur(browser, lien);
    try {
      await pageLeo.getByRole("button", { name: "Continuer" }).click();
      await expect(pageLeo).toHaveURL(/\/nouveau-mot-de-passe$/, NAVIGATION);
      const prenom = leo.nom.split(" ")[0];
      await expect(
        pageLeo.getByRole("heading", { level: 1, name: `Bienvenue chez Nova Services, ${prenom}` }),
      ).toBeVisible();
      await sansViolationAxe(pageLeo);
      const motDePasse = `mdp-${randomUUID()}`;
      await pageLeo.getByLabel("Mot de passe", { exact: true }).fill(motDePasse);
      await pageLeo.getByLabel("Confirmation du mot de passe").fill(motDePasse);
      await pageLeo.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
      await expect(pageLeo).toHaveURL(/\/equipe$/, NAVIGATION);
    } finally {
      await pageLeo.context().close();
    }

    await page.reload();
    await expect(ligneCompte(page, leo.email)).toContainText("Actif", NAVIGATION);
  });
});
