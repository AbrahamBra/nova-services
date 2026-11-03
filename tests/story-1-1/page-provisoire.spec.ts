import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("page provisoire", () => {
  test("affiche « Nova Services » en bleu marine, police Inter", async ({ page }) => {
    await page.goto("/");

    const titre = page.getByRole("heading", { level: 1, name: "Nova Services" });
    await expect(titre).toBeVisible();
    await expect(page.getByText("Application en construction")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    // Bleu marine Nova #1E3A8A.
    await expect(titre).toHaveCSS("color", "rgb(30, 58, 138)");
    // Inter, chargée par next/font (nom de famille préfixé « Inter »).
    const police = await titre.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(police).toMatch(/Inter/);
  });

  test("passe le contrôle d'accessibilité axe", async ({ page }) => {
    await page.goto("/");
    const resultats = await new AxeBuilder({ page }).analyze();
    expect(resultats.violations).toEqual([]);
  });
});
