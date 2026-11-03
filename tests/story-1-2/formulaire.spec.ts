import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Story 1.2 — formulaire public « Déposer une demande » (EXPERIENCE.md §9.1).
// Nécessite la migration 20261103000002 appliquée sur nova-dev.

// Espace insécable (U+00A0) du compteur « 5 000 ».
const NB = String.fromCharCode(0xa0);

const CATEGORIES_DE_DEPART = [
  "Demande d'information",
  "Problème technique",
  "Demande de rendez-vous",
  "Question administrative",
  "Autre",
];

test.describe("formulaire de dépôt", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("affiche l'en-tête, le titre et tous les champs", async ({ page }) => {
    await expect(page.getByText("Nova Services", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Déposer une demande" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Notre équipe vous répond au plus vite. Les champs sans mention sont obligatoires.",
      ),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    // Police Inter, chargée par next/font (nom de famille préfixé « Inter »).
    const police = await page
      .getByRole("heading", { level: 1 })
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(police).toMatch(/Inter/);

    await expect(page.getByRole("group", { name: "Vos coordonnées" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Votre demande" })).toBeVisible();

    await expect(page.getByLabel("Nom et prénom", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Téléphone (facultatif)", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Société (facultatif)", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Catégorie", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Objet", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Description", { exact: true })).toBeVisible();
    await expect(page.getByText(`0 / 5${NB}000`, { exact: true })).toBeVisible();
  });

  test("propose les 5 catégories de départ, dans l'ordre", async ({ page }) => {
    const options = page.getByLabel("Catégorie", { exact: true }).locator("option:not([disabled])");
    await expect(options).toHaveText(CATEGORIES_DE_DEPART);
  });

  test("affiche la mention d'information puis la case de consentement", async ({ page }) => {
    const mention = page.getByText("Vos informations servent uniquement à traiter votre demande.");
    await expect(mention).toHaveText(
      "Vos informations servent uniquement à traiter votre demande. Elles sont conservées 2 ans après son traitement, puis supprimées. Pour les faire effacer, écrivez à contact@nova-services.example.",
    );

    const caseConsentement = page.getByRole("checkbox", {
      name: "J'accepte que mes données soient utilisées pour traiter ma demande.",
    });
    await expect(caseConsentement).toBeVisible();
    await expect(caseConsentement).not.toBeChecked();

    // La case vient après la mention.
    const yMention = (await mention.boundingBox())!.y;
    const yCase = (await caseConsentement.boundingBox())!.y;
    expect(yCase).toBeGreaterThan(yMention);

    await caseConsentement.click();
    await expect(caseConsentement).toBeChecked();
  });

  test("le compteur suit la saisie de la description", async ({ page }) => {
    await page.getByLabel("Description", { exact: true }).fill("Bonjour Nova");
    await expect(page.getByText(`12 / 5${NB}000`, { exact: true })).toBeVisible();
  });

  test("le bouton « Envoyer ma demande » est visible, bleu marine, coins 6 px, sans effet", async ({
    page,
  }, testInfo) => {
    const bouton = page.getByRole("button", { name: "Envoyer ma demande" });
    await expect(bouton).toBeVisible();
    await expect(bouton).toHaveCSS("background-color", "rgb(30, 58, 138)");
    await expect(bouton).toHaveCSS("border-radius", "6px");

    // Survol : --primary-hover (ordinateur seulement, pas de survol au doigt).
    if (testInfo.project.name === "ordinateur") {
      const couleurSurvol = await page.evaluate(() => {
        const temoin = document.createElement("div");
        temoin.style.backgroundColor = "var(--primary-hover)";
        document.body.appendChild(temoin);
        const couleur = getComputedStyle(temoin).backgroundColor;
        temoin.remove();
        return couleur;
      });
      await bouton.hover();
      await expect(bouton).toHaveCSS("background-color", couleurSurvol);
    }

    // Champs aux coins arrondis de 6 px.
    await expect(page.getByLabel("Nom et prénom", { exact: true })).toHaveCSS(
      "border-radius",
      "6px",
    );
    await expect(page.getByLabel("Catégorie", { exact: true })).toHaveCSS("border-radius", "6px");

    // Story 1.3 : l'envoi n'existe pas encore. Ni requête ni rechargement.
    await page.getByLabel("Objet", { exact: true }).fill("Saisie conservée");
    const requetes: string[] = [];
    page.on("request", (requete) => {
      if (requete.method() !== "GET") requetes.push(requete.url());
    });
    await bouton.click();
    await page.waitForTimeout(300);
    expect(requetes).toEqual([]);
    await expect(page).toHaveURL("/");
    await expect(page.getByLabel("Objet", { exact: true })).toHaveValue("Saisie conservée");
  });

  test("tient sur une colonne, sans défilement horizontal ; bouton pleine largeur sur téléphone", async ({
    page,
  }, testInfo) => {
    const largeurs = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      fenetre: document.documentElement.clientWidth,
    }));
    expect(largeurs.document).toBeLessThanOrEqual(largeurs.fenetre);

    // Une seule colonne : les champs sont empilés, à la même abscisse.
    const xNom = (await page.getByLabel("Nom et prénom", { exact: true }).boundingBox())!.x;
    const xEmail = (await page.getByLabel("Email", { exact: true }).boundingBox())!.x;
    expect(xEmail).toBe(xNom);

    if (testInfo.project.name === "telephone") {
      const bouton = (await page
        .getByRole("button", { name: "Envoyer ma demande" })
        .boundingBox())!;
      const champ = (await page.getByLabel("Nom et prénom", { exact: true }).boundingBox())!;
      // Même largeur que les champs : marges de 16 px de chaque côté.
      expect(Math.round(bouton.width)).toBe(Math.round(champ.width));
      expect(Math.round(bouton.width)).toBe(largeurs.fenetre - 32);
      expect(bouton.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("passe le contrôle d'accessibilité axe", async ({ page }) => {
    const resultats = await new AxeBuilder({ page }).analyze();
    expect(resultats.violations).toEqual([]);
  });
});
