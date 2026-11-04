import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { verifierEnvironnement } from "../garde-environnement";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 1.3 — envoi du formulaire et page de confirmation (navigateur).
// Nécessite la migration 20261103000003 appliquée sur nova-dev.
// Les demandes créées portent un nom `TEST-…` propre à chaque test et sont
// effacées à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

// Story 1.8 : chaque test dépose avec sa propre IP (limite de 5 envois en
// 10 minutes par IP).
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

const noms: string[] = [];

test.beforeAll(() => {
  // Ces tests écrivent dans la base : jamais ailleurs qu'en développement.
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  // Aucun envoi réel (story 1.7) : l'adresse de test ne doit pas être autorisée.
  const autorisees = (process.env.EMAILS_AUTORISES ?? "")
    .split(",")
    .map((adresse) => adresse.trim().toLowerCase());
  if (autorisees.includes("*") || autorisees.includes("sophie.garnier@example.com")) {
    throw new Error("EMAILS_AUTORISES ne doit autoriser ni « * » ni l'adresse de test.");
  }
});

test.afterAll(async () => {
  if (noms.length === 0) return;
  const base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  try {
    await base.query("delete from public.demandes where nom = any($1::text[])", [noms]);
  } finally {
    await base.end();
  }
});

type Saisie = {
  nom: string;
  email: string;
  telephone: string;
  societe: string;
  objet: string;
  description: string;
};

function nouvelleSaisie(projet: string): Saisie {
  const nom = `TEST-1.3-${projet}-${crypto.randomUUID().slice(0, 8)} Sophie Garnier`;
  noms.push(nom);
  return {
    nom,
    email: "sophie.garnier@example.com",
    telephone: "06 12 34 56 78",
    societe: "Atelier Garnier Architectes",
    objet: "Impression impossible depuis la mise à jour",
    description: "Depuis lundi, aucun poste n'imprime. <script>window.piege = 1</script>",
  };
}

const champ = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });
const caseConsentement = (page: Page) =>
  page.getByRole("checkbox", {
    name: "J'accepte que mes données soient utilisées pour traiter ma demande.",
  });

async function remplir(page: Page, s: Saisie, { cocher = true } = {}) {
  await champ(page, "Nom et prénom").fill(s.nom);
  await champ(page, "Email").fill(s.email);
  await champ(page, "Téléphone (facultatif)").fill(s.telephone);
  await champ(page, "Société (facultatif)").fill(s.societe);
  await champ(page, "Catégorie").selectOption({ label: "Problème technique" });
  await champ(page, "Objet").fill(s.objet);
  await champ(page, "Description").fill(s.description);
  if (cocher) await caseConsentement(page).click();
}

// Année de la référence : année civile à l'heure de Paris (AD-24).
const ANNEE_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  year: "numeric",
}).format(new Date());
const FORMAT_REFERENCE = new RegExp(`^NOVA-${ANNEE_PARIS}-\\d{4,}$`);

const ADRESSE_CONFIRMATION = /\/confirmation\/[0-9a-f]{64}$/;

test.describe("envoi d'une demande", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("envoi correct → « Envoi en cours… », puis confirmation sans donnée personnelle", async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
    const s = nouvelleSaisie(testInfo.project.name);
    await remplir(page, s);

    // Ralentit l'envoi pour voir l'état « en cours ».
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    const bouton = page.getByRole("button", { name: "Envoyer ma demande" });
    await bouton.click();
    const enCours = page.getByRole("button", { name: "Envoi en cours…" });
    await expect(enCours).toBeVisible();
    await expect(enCours).toBeDisabled();

    await expect(page).toHaveURL(ADRESSE_CONFIRMATION);
    await expect(
      page.getByRole("heading", { level: 1, name: "Votre demande a bien été enregistrée." }),
    ).toBeVisible();
    await expect(page.getByText("Votre référence", { exact: true })).toBeVisible();
    const reference = page.getByText(FORMAT_REFERENCE);
    await expect(reference).toBeVisible();
    await expect(
      page.getByText("Conservez-la pour tout échange avec notre équipe."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "contact@nova-services.example" })).toBeVisible();

    // Aucune donnée du demandeur. Adresse hors de EMAILS_AUTORISES : aucun email
    // envoyé (mode démonstration, story 1.7), donc pas de phrase sur l'email.
    const texte = await page.locator("body").innerText();
    expect(texte).not.toContain(s.nom);
    expect(texte).not.toContain(s.email);
    expect(texte).not.toContain(s.telephone);
    expect(texte).not.toContain(s.societe);
    expect(texte).not.toContain("Depuis lundi");
    expect(texte).not.toContain("Un email de confirmation vous a été envoyé.");
    expect(await page.evaluate(() => (window as unknown as { piege?: number }).piege)).toBeUndefined();

    // Copier → « Copié » pendant 2 secondes.
    const copier = page.getByRole("button", { name: "Copier" });
    await copier.click();
    await expect(page.getByRole("button", { name: "Copié" })).toBeVisible();
    if (browserName === "chromium") {
      const copie = await page.evaluate(() => navigator.clipboard.readText());
      expect(copie).toBe(await reference.innerText());
    }
    await expect(page.getByRole("button", { name: "Copier" })).toBeVisible({ timeout: 4000 });

    // La référence est en base, avec la saisie normalisée.
    const base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await base.connect();
    try {
      const { rows } = await base.query(
        "select reference, email, description, canal, statut from public.demandes where nom = $1",
        [s.nom],
      );
      expect(rows).toEqual([
        {
          reference: await reference.innerText(),
          email: s.email,
          description: s.description,
          canal: "formulaire",
          statut: "nouvelle",
        },
      ]);
    } finally {
      await base.end();
    }

    // « Déposer une autre demande » → formulaire vide.
    const adresseConfirmation = page.url();
    const referenceAffichee = await reference.innerText();
    await page.getByRole("link", { name: "Déposer une autre demande" }).click();
    await expect(page).toHaveURL("/");
    await expect(champ(page, "Nom et prénom")).toHaveValue("");
    await expect(champ(page, "Objet")).toHaveValue("");
    await expect(champ(page, "Description")).toHaveValue("");
    await expect(caseConsentement(page)).not.toBeChecked();

    // Second dépôt depuis ce formulaire : nouvelle clé, donc nouvelle demande.
    const premiereAdresse = adresseConfirmation;
    const premiereReference = referenceAffichee;
    const s2 = nouvelleSaisie(testInfo.project.name);
    await remplir(page, s2);
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(page).toHaveURL(ADRESSE_CONFIRMATION);
    expect(page.url()).not.toBe(premiereAdresse);
    const secondeReference = await page.getByText(FORMAT_REFERENCE).innerText();
    expect(secondeReference).not.toBe(premiereReference);
  });

  test("description vide, email mal écrit, case non cochée → 3 messages, saisie conservée", async ({
    page,
  }, testInfo) => {
    const s = nouvelleSaisie(testInfo.project.name);
    await remplir(page, { ...s, email: "abc", description: "" }, { cocher: false });

    await page.getByRole("button", { name: "Envoyer ma demande" }).click();

    await expect(page.getByText("Cette adresse email ne semble pas valide.")).toBeVisible();
    await expect(page.getByText("Décrivez votre demande.")).toBeVisible();
    await expect(page.getByText("Cochez cette case pour envoyer votre demande.")).toBeVisible();
    await expect(page).toHaveURL("/");

    // Focus sur le premier champ en erreur ; champs en erreur signalés.
    await expect(champ(page, "Email")).toBeFocused();
    await expect(champ(page, "Email")).toHaveAttribute("aria-invalid", "true");
    await expect(champ(page, "Email")).toHaveAccessibleDescription(
      "Cette adresse email ne semble pas valide.",
    );
    await expect(caseConsentement(page)).toHaveAttribute("aria-invalid", "true");

    // Saisie conservée.
    await expect(champ(page, "Nom et prénom")).toHaveValue(s.nom);
    await expect(champ(page, "Email")).toHaveValue("abc");
    await expect(champ(page, "Société (facultatif)")).toHaveValue(s.societe);
    await expect(champ(page, "Objet")).toHaveValue(s.objet);

    // Le message disparaît dès que l'on corrige.
    await champ(page, "Email").fill(s.email);
    await expect(page.getByText("Cette adresse email ne semble pas valide.")).toHaveCount(0);

    const resultats = await new AxeBuilder({ page }).analyze();
    expect(resultats.violations).toEqual([]);
  });

  test("objet de 151 caractères → message sous Objet", async ({ page }, testInfo) => {
    const s = nouvelleSaisie(testInfo.project.name);
    await remplir(page, { ...s, objet: "o".repeat(151) });
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(page.getByText("L'objet ne doit pas dépasser 150 caractères.")).toBeVisible();
    await expect(champ(page, "Objet")).toBeFocused();
  });

  test("le compteur passe en rouge et le dit au-delà de 5 000 caractères", async ({ page }) => {
    const description = champ(page, "Description");
    await description.fill("d".repeat(5001));
    const compteur = page.getByText(/^5\s001 \/ 5\s000/);
    await expect(compteur).toBeVisible();
    await expect(compteur).toContainText("1 caractère en trop");
    await expect(compteur).toHaveCSS("color", "rgb(185, 28, 28)");
    await expect(page.getByText(/^La description dépasse 5\s000 caractères\.$/)).toBeAttached();
  });

  test("serveur injoignable → bandeau « Réessayer », saisie conservée, puis envoi", async ({
    page,
  }, testInfo) => {
    const s = nouvelleSaisie(testInfo.project.name);
    await remplir(page, s);

    const couper = async (route: import("@playwright/test").Route) => {
      if (route.request().method() === "POST") await route.abort("connectionfailed");
      else await route.continue();
    };
    await page.route("**/*", couper);
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();

    const bandeau = page.getByRole("alert").filter({ hasText: "Le serveur ne répond pas." });
    await expect(bandeau).toBeVisible();
    await expect(champ(page, "Nom et prénom")).toHaveValue(s.nom);
    await expect(champ(page, "Description")).toHaveValue(s.description);
    await expect(caseConsentement(page)).toBeChecked();

    await page.unroute("**/*", couper);
    await bandeau.getByRole("button", { name: "Réessayer" }).click();
    await expect(page).toHaveURL(ADRESSE_CONFIRMATION);
  });

  test("parcours au clavier seul, avec un focus toujours visible", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "ordinateur", "Parcours clavier : sur ordinateur.");
    const s = nouvelleSaisie(testInfo.project.name);

    // Vérifie que l'élément qui a le focus est entouré d'un anneau visible.
    const focusVisible = () =>
      page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return false;
        const style = getComputedStyle(element);
        return (
          element.matches(":focus-visible") &&
          ((style.outlineStyle !== "none" && style.outlineWidth !== "0px") ||
            style.boxShadow !== "none")
        );
      });

    async function tab() {
      await page.keyboard.press("Tab");
      expect(await focusVisible()).toBe(true);
    }

    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await tab();
    await expect(champ(page, "Nom et prénom")).toBeFocused();
    await page.keyboard.type(s.nom);
    await tab();
    await page.keyboard.type(s.email);
    await tab(); // téléphone
    await tab(); // société
    await tab();
    await expect(champ(page, "Catégorie")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(champ(page, "Catégorie")).not.toHaveValue("");
    await tab();
    await page.keyboard.type(s.objet);
    await tab();
    await page.keyboard.type(s.description);
    await tab(); // lien email de la mention
    await tab();
    await expect(caseConsentement(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(caseConsentement(page)).toBeChecked();
    await tab();
    await expect(page.getByRole("button", { name: "Envoyer ma demande" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(ADRESSE_CONFIRMATION);
    await expect(
      page.getByRole("heading", { level: 1, name: "Votre demande a bien été enregistrée." }),
    ).toBeVisible();
    await tab();
    await expect(page.getByRole("button", { name: "Copier" })).toBeFocused();
  });
});

test.describe("catégorie désactivée après l'affichage", () => {
  // Catégorie propre au test (jamais l'une des 5 catégories réelles), effacée
  // à la fin. Les autres tests ignorent les catégories « TEST- ».
  let categorieId: string | null = null;

  test.afterEach(async () => {
    if (!categorieId) return;
    const base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await base.connect();
    try {
      await base.query("delete from public.categories where id = $1", [categorieId]);
    } finally {
      await base.end();
      categorieId = null;
    }
  });

  test("message sous Catégorie, champ signalé et focus, saisie conservée", async ({
    page,
  }, testInfo) => {
    const s = nouvelleSaisie(testInfo.project.name);
    const nomCategorie = `TEST-Catégorie ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
    const base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await base.connect();
    try {
      const { rows } = await base.query<{ id: string }>(
        "insert into public.categories (nom, ordre) values ($1, 99) returning id",
        [nomCategorie],
      );
      categorieId = rows[0].id;

      await page.goto("/");
      await remplir(page, s);
      await champ(page, "Catégorie").selectOption({ label: nomCategorie });

      await base.query("update public.categories set actif = false where id = $1", [categorieId]);
    } finally {
      await base.end();
    }
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();

    await expect(page.getByText("Choisissez une catégorie dans la liste.")).toBeVisible();
    await expect(page).toHaveURL("/");
    const categorie = champ(page, "Catégorie");
    await expect(categorie).toHaveAttribute("aria-invalid", "true");
    await expect(categorie).toBeFocused();
    // Liste rechargée sans la catégorie désactivée, rien de choisi à sa place.
    await expect(categorie.locator("option", { hasText: nomCategorie })).toHaveCount(0);
    await expect(categorie).toHaveValue("");

    await expect(champ(page, "Nom et prénom")).toHaveValue(s.nom);
    await expect(champ(page, "Objet")).toHaveValue(s.objet);
    await expect(champ(page, "Description")).toHaveValue(s.description);
    await expect(caseConsentement(page)).toBeChecked();
  });
});

test.describe("page de confirmation", () => {
  test("jeton inconnu → « Cette page n'est plus disponible. »", async ({ page }) => {
    for (const jeton of ["0".repeat(64), "pas-un-jeton"]) {
      await page.goto(`/confirmation/${jeton}`);
      await expect(
        page.getByRole("heading", { name: "Cette page n'est plus disponible." }),
      ).toBeVisible();
      await expect(page.getByText(/NOVA-/)).toHaveCount(0);
    }
    const resultats = await new AxeBuilder({ page }).analyze();
    expect(resultats.violations).toEqual([]);
  });

  test("passe le contrôle d'accessibilité axe", async ({ page }, testInfo) => {
    await page.goto("/");
    await remplir(page, nouvelleSaisie(testInfo.project.name));
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(page).toHaveURL(ADRESSE_CONFIRMATION);
    await expect(page.getByRole("button", { name: "Copier" })).toBeVisible();

    const resultats = await new AxeBuilder({ page }).analyze();
    expect(resultats.violations).toEqual([]);
  });
});
