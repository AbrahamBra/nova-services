import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";

// Story 2.1 — prendre en charge une demande (navigateur). Nécessite la
// migration 20261103000014 appliquée sur nova-dev.
// Critères 1 à 3 d'epics.md : toast, responsable et badge, ligne
// d'historique sans recharger la page ; deux navigateurs (administratrice et
// collaborateur) sur la même demande → « Déjà prise en charge par [nom]. ».
// Base partagée : chaque processus crée ses propres comptes et demandes
// `TEST-2.1-…`, effacés à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.1-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };

let karim: CompteTest; // collaborateur
let claire: CompteTest; // administratrice

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.1" });
  claire = await creerCompteTest({ role: "administrateur", prenom: "Claire", etiquette: "2.1" });
});

test.afterAll(async () => {
  // Demandes d'abord (l'historique cite les comptes) ; si leur nettoyage
  // échoue, les comptes sont gardés plutôt que laissés à moitié supprimés.
  let demandesNettoyees = false;
  try {
    await avecBase((base) => supprimerDemandesTest(base, PREFIXE));
    demandesNettoyees = true;
  } catch (erreur) {
    console.error(`Nettoyage des demandes de test impossible : ${String(erreur)}`);
  } finally {
    const comptes = [karim, claire].filter(Boolean);
    if (demandesNettoyees) await supprimerComptesTest(comptes);
  }
});

// Story 1.9 : chaque contexte se connecte depuis sa propre IP de test.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

function demande(options: Parameters<typeof creerDemandeTest>[2] = {}): Promise<DemandeTest> {
  return avecBase((base) => creerDemandeTest(base, PREFIXE, options));
}

async function seConnecter(page: Page, compte: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(compte.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(compte.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(new RegExp(`${retour}$`), APRES_CONNEXION);
}

async function ouvrir(page: Page, compte: CompteTest, d: DemandeTest) {
  await seConnecter(page, compte, `/equipe/demandes/${d.reference}`);
  await expect(page.getByRole("heading", { level: 1, name: d.objet })).toBeVisible(NAVIGATION);
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Ralentit les actions serveur de la page, pour voir l'état « Prise en charge… ». */
async function ralentirActions(page: Page, delai = 1_000) {
  await page.route("**/equipe/demandes/**", async (route) => {
    const requete = route.request();
    if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
      await new Promise((r) => setTimeout(r, delai));
    }
    await route.continue();
  });
}

test.describe("prendre en charge une demande", () => {
  test("critères 1 et 2 : toast, responsable, badge En cours, ligne d'historique, sans recharger", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, karim, d);

    const infos = page.getByRole("complementary", { name: "Informations" });
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
    await expect(page.getByTestId("historique").locator("li")).toHaveCount(1);

    // Repère posé dans la page : il disparaîtrait si la page était rechargée.
    await page.evaluate(() => {
      (window as unknown as { __sansRechargement?: boolean }).__sansRechargement = true;
    });

    await ralentirActions(page);
    const bouton = infos.getByRole("button", { name: "Prendre en charge" });
    await bouton.click();
    const enCours = infos.getByRole("button", { name: "Prise en charge…" });
    await expect(enCours).toBeVisible();
    await expect(enCours).toBeDisabled();

    // Critère 1 : toast annoncé (zone status), nom du responsable, badges.
    const toast = page.getByRole("status").getByTestId("toast");
    await expect(toast).toHaveText("Vous êtes responsable de cette demande.", NAVIGATION);
    await expect(page.getByTestId("responsable")).toHaveText(karim.nom);
    await expect(page.locator('header [data-statut="en_cours"]')).toHaveText("En cours");
    await expect(infos.locator('[data-statut="en_cours"]')).toHaveText("En cours");
    await expect(infos.getByRole("button", { name: /Prendre en charge|Prise en charge…/ })).toHaveCount(0);

    // Critère 2 : la ligne d'historique s'est ajoutée.
    const lignes = page.getByTestId("historique").locator("li");
    await expect(lignes).toHaveCount(2);
    await expect(lignes.nth(1)).toContainText(`Prise en charge par ${karim.nom} : Nouvelle → En cours`);
    expect(
      await page.evaluate(() => (window as unknown as { __sansRechargement?: boolean }).__sansRechargement),
    ).toBe(true);

    // Position : en bas à droite sur ordinateur, en haut sur téléphone.
    const boite = await toast.boundingBox();
    const fenetre = page.viewportSize()!;
    expect(boite).toBeTruthy();
    if (test.info().project.name === "telephone") {
      expect(boite!.y).toBeLessThan(fenetre.height / 3);
    } else {
      expect(boite!.y + boite!.height).toBeGreaterThan((fenetre.height * 2) / 3);
      expect(boite!.x).toBeGreaterThan(fenetre.width / 2);
    }

    await sansViolationAxe(page);

    // Une réussite disparaît d'elle-même après 5 secondes.
    await expect(toast).toHaveCount(0, { timeout: 8_000 });
  });

  test("réseau coupé pendant l'action : toast d'erreur, rien ne change, bouton de nouveau actif", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, karim, d);
    await page.route("**/equipe/demandes/**", async (route) => {
      const requete = route.request();
      if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
        await route.abort("internetdisconnected");
      } else {
        await route.continue();
      }
    });

    const infos = page.getByRole("complementary", { name: "Informations" });
    await infos.getByRole("button", { name: "Prendre en charge" }).click();
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(
      "Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant.",
      NAVIGATION,
    );
    await expect(infos.getByRole("button", { name: "Prendre en charge" })).toBeEnabled();
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
    await expect(page.getByTestId("historique").locator("li")).toHaveCount(1);
  });

  test("bouton absent pour une demande En cours ou Traitée", async ({ page }) => {
    const enCours = await demande({ statut: "en_cours", responsableId: claire.id });
    const traitee = await demande({ statut: "traitee" });
    await ouvrir(page, karim, enCours);
    const infos = page.getByRole("complementary", { name: "Informations" });
    await expect(page.getByTestId("responsable")).toHaveText(claire.nom);
    await expect(infos.getByRole("button", { name: "Prendre en charge" })).toHaveCount(0);

    await page.goto(`/equipe/demandes/${traitee.reference}`);
    await expect(page.getByRole("heading", { level: 1, name: traitee.objet })).toBeVisible(NAVIGATION);
    await expect(
      page.getByRole("complementary", { name: "Informations" }).getByRole("button", {
        name: "Prendre en charge",
      }),
    ).toHaveCount(0);
  });

  test("critère 3 : deux navigateurs, le second lit « Déjà prise en charge par [nom]. »", async ({
    browser,
  }, testInfo) => {
    const d = await demande();
    // Mêmes réglages que le projet (ordinateur ou téléphone).
    const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId } =
      testInfo.project.use;
    const options = { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId };
    const contexteAdmin = await browser.newContext(options);
    const contexteCollaborateur = await browser.newContext(options);
    try {
      await utiliserIpDeTest(contexteAdmin);
      await utiliserIpDeTest(contexteCollaborateur);
      const pageAdmin = await contexteAdmin.newPage();
      const pageCollaborateur = await contexteCollaborateur.newPage();
      await ouvrir(pageAdmin, claire, d);
      await ouvrir(pageCollaborateur, karim, d);

      // L'administratrice prend la demande.
      await pageAdmin
        .getByRole("complementary", { name: "Informations" })
        .getByRole("button", { name: "Prendre en charge" })
        .click();
      await expect(pageAdmin.getByRole("status").getByTestId("toast")).toHaveText(
        "Vous êtes responsable de cette demande.",
        NAVIGATION,
      );

      // Le collaborateur, sur sa page restée Nouvelle, clique à son tour.
      const infos = pageCollaborateur.getByRole("complementary", { name: "Informations" });
      await infos.getByRole("button", { name: "Prendre en charge" }).click();
      const erreur = pageCollaborateur.getByRole("alert").getByTestId("toast");
      await expect(erreur).toHaveText(`Déjà prise en charge par ${claire.nom}.`, NAVIGATION);

      // Détail rafraîchi : le vrai responsable, plus de bouton.
      await expect(pageCollaborateur.getByTestId("responsable")).toHaveText(claire.nom);
      await expect(infos.getByRole("button", { name: "Prendre en charge" })).toHaveCount(0);
      const lignes = pageCollaborateur.getByTestId("historique").locator("li");
      await expect(lignes).toHaveCount(2);
      await expect(lignes.nth(1)).toContainText(`Prise en charge par ${claire.nom} : Nouvelle → En cours`);

      await sansViolationAxe(pageCollaborateur);

      // Une erreur reste jusqu'à ce qu'on la ferme.
      await pageCollaborateur.waitForTimeout(6_000);
      await expect(erreur).toBeVisible();
      await erreur.getByRole("button", { name: "Fermer le message" }).click();
      await expect(erreur).toHaveCount(0);
    } finally {
      await contexteAdmin.close();
      await contexteCollaborateur.close();
    }
  });
});
