import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { verifierEnvironnement } from "../garde-environnement";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 1.8 — anti-spam du formulaire public (navigateur) : 6ᵉ envoi refusé
// avec le bandeau et la saisie conservée, champ piège invisible et hors du
// parcours clavier, champ piège rempli → rien d'enregistré, accessibilité.
// Chaque test a sa propre IP (en-tête x-nova-ip-test, accepté seulement par
// le serveur lancé par Playwright). Demandes `TEST-…` effacées à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const EMAIL_TEST = "sophie.garnier@example.com";
const ADRESSE_CONFIRMATION = /\/confirmation\/[0-9a-f]{64}$/;
// Dépôt complet (base, email, page de confirmation) : plus de 5 s quand toute
// la suite tourne en parallèle sur le serveur de développement.
const ATTENTE_DEPOT = { timeout: 20_000 };
const MESSAGE_TROP = "Trop d'envois depuis votre connexion. Réessayez dans quelques minutes.";
const MESSAGE_NEUTRE = "Votre demande n'a pas pu être envoyée. Réessayez plus tard.";

const noms: string[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  const autorisees = (process.env.EMAILS_AUTORISES ?? "")
    .split(",")
    .map((adresse) => adresse.trim().toLowerCase());
  if (autorisees.includes("*") || autorisees.includes(EMAIL_TEST)) {
    throw new Error(`EMAILS_AUTORISES ne doit autoriser ni « * » ni ${EMAIL_TEST}.`);
  }
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

test.afterAll(async () => {
  if (noms.length === 0) return;
  await avecBase((base) =>
    base.query("delete from public.demandes where nom like any($1::text[])", [
      noms.map((nom) => `${nom}%`),
    ]),
  );
});

async function avecBase<T>(travail: (base: Client) => Promise<T>): Promise<T> {
  const base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  try {
    return await travail(base);
  } finally {
    await base.end();
  }
}

async function nombreDemandes(nom: string): Promise<number> {
  return avecBase(async (base) => {
    const { rows } = await base.query<{ n: number }>(
      "select count(*)::int as n from public.demandes where nom = $1",
      [nom],
    );
    return rows[0].n;
  });
}

function nouveauNom(projet: string): string {
  const nom = `TEST-1.8-${projet}-${crypto.randomUUID().slice(0, 8)}`;
  noms.push(nom);
  return nom;
}

const champ = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });
const caseConsentement = (page: Page) =>
  page.getByRole("checkbox", {
    name: "J'accepte que mes données soient utilisées pour traiter ma demande.",
  });
const champPiege = (page: Page) => page.locator('input[name="site_web"]');

async function remplir(page: Page, nom: string, objet = "Impression impossible") {
  await champ(page, "Nom et prénom").fill(nom);
  await champ(page, "Email").fill(EMAIL_TEST);
  await champ(page, "Catégorie").selectOption({ label: "Problème technique" });
  await champ(page, "Objet").fill(objet);
  await champ(page, "Description").fill("Depuis lundi, aucun poste n'imprime.");
  await caseConsentement(page).click();
}

const envoyer = (page: Page) => page.getByRole("button", { name: "Envoyer ma demande" }).click();

test("6ᵉ envoi en 10 minutes → bandeau, saisie conservée, rien d'enregistré", async ({
  page,
}, testInfo) => {
  test.slow(); // 6 dépôts complets
  const prefixe = nouveauNom(testInfo.project.name);

  for (let i = 1; i <= 5; i += 1) {
    await page.goto("/");
    await remplir(page, `${prefixe} Envoi ${i}`);
    await envoyer(page);
    await expect(page).toHaveURL(ADRESSE_CONFIRMATION, ATTENTE_DEPOT);
    await expect(
      page.getByRole("heading", { level: 1, name: "Votre demande a bien été enregistrée." }),
    ).toBeVisible();
  }

  await page.goto("/");
  const sixieme = `${prefixe} Envoi 6`;
  await remplir(page, sixieme, "Sixième envoi");
  await envoyer(page);

  const bandeau = page.getByRole("alert").filter({ hasText: MESSAGE_TROP });
  await expect(bandeau).toBeVisible();
  await expect(bandeau).toBeFocused();
  await expect(page).toHaveURL("/");
  // Saisie conservée.
  await expect(champ(page, "Nom et prénom")).toHaveValue(sixieme);
  await expect(champ(page, "Email")).toHaveValue(EMAIL_TEST);
  await expect(champ(page, "Objet")).toHaveValue("Sixième envoi");
  await expect(champ(page, "Description")).toHaveValue("Depuis lundi, aucun poste n'imprime.");
  await expect(caseConsentement(page)).toBeChecked();
  expect(await nombreDemandes(sixieme)).toBe(0);
  expect(await nombreDemandes(`${prefixe} Envoi 5`)).toBe(1);

  const resultat = await new AxeBuilder({ page }).analyze();
  expect(resultat.violations).toEqual([]);

  // Une autre connexion (autre IP) peut toujours déposer.
  await utiliserIpDeTest(page.context());
  await envoyer(page);
  await expect(page).toHaveURL(ADRESSE_CONFIRMATION, ATTENTE_DEPOT);
  expect(await nombreDemandes(sixieme)).toBe(1);
});

test("champ piège : invisible, ignoré des lecteurs d'écran, hors du parcours clavier", async ({
  page,
}) => {
  await page.goto("/");
  const piege = champPiege(page);
  await expect(piege).toHaveCount(1);
  await expect(piege).toHaveValue("");
  await expect(piege).toHaveAttribute("tabindex", "-1");
  await expect(piege).toHaveAttribute("autocomplete", "off");
  await expect(piege).not.toBeInViewport();
  // Rien d'affiché à l'écran : la zone est hors de la page, à gauche.
  const boite = await piege.boundingBox();
  expect(boite === null || boite.x + boite.width <= 0).toBe(true);
  await expect(page.getByText("Site web")).not.toBeInViewport();

  // Masqué aux lecteurs d'écran (arbre d'accessibilité).
  await expect(page.locator('[aria-hidden="true"]:has(input[name="site_web"])')).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Site web" })).toHaveCount(0);

  // Tout le parcours au clavier sans jamais passer par le piège.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  // Le parcours va jusqu'au bouton « Envoyer », donc au-delà de
  // l'emplacement du piège (juste après la clé d'envoi, en tête du formulaire).
  let boutonAtteint = false;
  for (let i = 0; i < 40 && !boutonAtteint; i += 1) {
    await page.keyboard.press("Tab");
    const actif = await page.evaluate(() => {
      const element = document.activeElement as HTMLInputElement | null;
      return { nom: element?.name ?? null, texte: element?.textContent?.trim() ?? "" };
    });
    expect(actif.nom).not.toBe("site_web");
    boutonAtteint = actif.texte === "Envoyer ma demande";
  }
  expect(boutonAtteint).toBe(true);

  const resultat = await new AxeBuilder({ page }).analyze();
  expect(resultat.violations).toEqual([]);
});

test("champ piège rempli → message neutre, rien d'enregistré", async ({ page }, testInfo) => {
  const nom = `${nouveauNom(testInfo.project.name)} Robot`;
  await page.goto("/");
  await remplir(page, nom);
  // Un robot remplit tous les champs, y compris celui qu'il ne voit pas.
  await champPiege(page).evaluate((element: HTMLInputElement) => {
    element.value = "https://spam.example";
  });
  await envoyer(page);

  const bandeau = page.getByRole("alert").filter({ hasText: MESSAGE_NEUTRE });
  await expect(bandeau).toBeVisible();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(MESSAGE_TROP)).toHaveCount(0);
  expect(await nombreDemandes(nom)).toBe(0);
});
