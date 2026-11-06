import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";

// Story 2.8 — tableau de bord et compteur du menu (navigateur).
// Critères 1 à 3 d'epics.md : 5 chiffres, « Mes demandes en cours » et
// « Saisir une demande » ; chaque carte ouvre la liste filtrée dont le total
// est son chiffre ; le compteur du menu baisse de 1 après une prise en
// charge. Le critère 4 (base vide) est vérifié sans base (etats.test.tsx) :
// la base est partagée. Contrôle axe ; ordinateur et téléphone (compteur à
// côté du bouton « Menu »).
// Base partagée : jamais de nombre exact absolu ; carte et liste sont lues
// l'une après l'autre et comparées, relues si une autre exécution a modifié
// la base entre-temps.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.8-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
/** Relectures tant qu'une autre exécution change la base entre deux lectures. */
const RELECTURES = { timeout: 90_000, intervals: [500, 1_000, 2_000] };

const LIBELLES = [
  "À prendre en charge",
  "Priorité Haute non traitées",
  "Nouvelle",
  "En cours",
  "Traitée",
];

let karim: CompteTest;
// Prend en charge au critère 3 : ses demandes n'entrent pas dans « Mes
// demandes en cours » de Karim.
let nadia: CompteTest;
let mesDemandes: DemandeTest[] = [];

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.8" });
  nadia = await creerCompteTest({ role: "collaborateur", prenom: "Nadia", etiquette: "2.8" });
  await avecBase(async (base) => {
    mesDemandes = [];
    for (let i = 0; i < 2; i++) {
      mesDemandes.push(
        await creerDemandeTest(base, PREFIXE, {
          statut: "en_cours",
          priorite: "haute",
          responsableId: karim.id,
          objet: `Demande en cours de Karim ${i}`,
          decalage: `-${i + 1} days`,
        }),
      );
    }
  });
});

test.afterAll(async () => {
  let nettoyees = false;
  try {
    await avecBase((base) => supprimerDemandesTest(base, PREFIXE));
    nettoyees = true;
  } catch (erreur) {
    console.error(`Nettoyage des demandes de test impossible : ${String(erreur)}`);
  } finally {
    if (nettoyees) await supprimerComptesTest([karim, nadia].filter(Boolean));
  }
});

// Story 1.9 : chaque contexte se connecte depuis sa propre IP de test.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

const estTelephone = () => test.info().project.name === "telephone";

async function seConnecter(page: Page, compte: CompteTest = karim) {
  await page.goto("/connexion");
  await page.getByLabel("Email", { exact: true }).fill(compte.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(compte.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/equipe$/, APRES_CONNEXION);
  await expect(page.getByRole("heading", { level: 1, name: /^Bonjour / })).toBeVisible(NAVIGATION);
}

/** Lit un nombre affiché (« 1 234 » avec espace insécable). */
function nombre(texte: string | null): number {
  const chiffres = (texte ?? "").replace(/\D/g, "");
  return chiffres === "" ? 0 : Number(chiffres);
}

function carte(page: Page, libelle: string) {
  return page.getByRole("link", { name: new RegExp(`^${libelle} : [\\d\\s]+$`) });
}

/** Total de la liste ouverte (0 si « Aucune demande ne correspond… »). */
async function totalListe(page: Page): Promise<number> {
  const sansResultat = page.getByText("Aucune demande ne correspond à ces filtres.");
  const total = page.getByTestId("total");
  await expect(total.or(sansResultat).first()).toBeVisible(NAVIGATION);
  if (await sansResultat.isVisible()) return 0;
  return nombre(await total.textContent());
}

/** Compteur du menu visible (barre du haut sur téléphone, menu latéral sinon), 0 s'il est masqué. */
async function compteurMenu(page: Page): Promise<number> {
  const compteur = page.locator("[data-compteur-menu]:visible");
  if ((await compteur.count()) === 0) return 0;
  const texte = await compteur.locator(".sr-only").textContent();
  expect(texte).toMatch(/^[\d\s]+ à prendre en charge$/);
  return nombre(texte);
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

test.describe("tableau de bord", () => {
  test("critère 1 : 5 chiffres, « Mes demandes en cours », « Saisir une demande » ; axe", async ({
    page,
  }) => {
    await seConnecter(page);

    const cartes = page.getByRole("list", { name: "Chiffres des demandes" }).getByRole("link");
    await expect(cartes).toHaveCount(5, NAVIGATION);
    for (const [i, libelle] of LIBELLES.entries()) {
      await expect(cartes.nth(i)).toHaveAccessibleName(new RegExp(`^${libelle} : [\\d\\s]+$`));
      await expect(cartes.nth(i)).toBeVisible();
    }

    await expect(page.getByRole("heading", { level: 2, name: "Mes demandes en cours" })).toBeVisible();
    const selecteur = estTelephone() ? "li[data-reference]" : "tbody tr[data-reference]";
    const lignes = page.getByRole(estTelephone() ? "list" : "table", { name: "Mes demandes en cours" });
    await expect(lignes.locator(selecteur)).toHaveCount(mesDemandes.length);
    for (const d of mesDemandes) {
      await expect(lignes.locator(`[data-reference="${d.reference}"]`)).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Tout voir" })).toHaveAttribute(
      "href",
      "/equipe/demandes?statut=en_cours&responsable=moi",
    );

    const saisir = page.getByRole("main").getByRole("link", { name: "Saisir une demande" });
    await expect(saisir).toBeVisible();
    await expect(saisir).toHaveAttribute("href", "/equipe/demandes/nouvelle");

    // « Tout voir » ouvre la liste de mes demandes en cours.
    await page.getByRole("link", { name: "Tout voir" }).click();
    await expect(page).toHaveURL(/\/equipe\/demandes\?statut=en_cours&responsable=moi$/, NAVIGATION);
    expect(await totalListe(page)).toBe(mesDemandes.length);

    await page.goto("/equipe");
    await expect(cartes.first()).toBeVisible(NAVIGATION);
    await sansViolationAxe(page);
  });

  test("critère 2 : chaque carte ouvre la liste filtrée qui contient exactement ce nombre", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await seConnecter(page);

    for (const libelle of LIBELLES) {
      await expect(async () => {
        await page.goto("/equipe");
        const lien = carte(page, libelle);
        await expect(lien).toBeVisible(NAVIGATION);
        const attendu = nombre(await lien.locator("[data-nombre]").textContent());
        const adresse = await lien.getAttribute("href");
        await lien.click();
        await expect(page).toHaveURL((url) => url.pathname + url.search === adresse, NAVIGATION);
        expect(await totalListe(page), libelle).toBe(attendu);
      }).toPass(RELECTURES);
    }
  });

  test("critère 3 : après une prise en charge, le compteur du menu baisse de 1", async ({ page }) => {
    test.setTimeout(240_000);
    await seConnecter(page, nadia);

    // Une demande à prendre en charge d'abord : sans elle, le compteur peut
    // être masqué (0) sur une base partagée.
    await avecBase((base) =>
      creerDemandeTest(base, PREFIXE, { statut: "nouvelle", objet: `Compteur ${randomUUID().slice(0, 6)}` }),
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: /^Bonjour / })).toBeVisible(NAVIGATION);

    // Compteur : à côté du bouton « Menu » sur téléphone, de « Demandes » sinon.
    const compteur = page.locator("[data-compteur-menu]:visible");
    if (estTelephone()) {
      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
      await expect(page.locator("header [data-compteur-menu]")).toBeVisible();
    } else {
      const menu = page.getByRole("navigation", { name: "Menu de l'espace équipe" });
      // Le nom du lien reste exactement « Demandes ».
      await expect(menu.getByRole("link", { name: "Demandes", exact: true })).toBeVisible();
      await expect(menu.locator("[data-compteur-menu]")).toBeVisible();
    }
    await expect(compteur).toHaveCount(1);

    await expect(async () => {
      // Une demande à prendre en charge : le compteur est au moins à 1.
      const d = await avecBase((base) =>
        creerDemandeTest(base, PREFIXE, { statut: "nouvelle", objet: `À prendre ${randomUUID().slice(0, 6)}` }),
      );
      await page.goto("/equipe");
      await expect(page.getByRole("heading", { level: 1, name: /^Bonjour / })).toBeVisible(NAVIGATION);
      const avant = await compteurMenu(page);
      expect(avant).toBeGreaterThanOrEqual(1);
      // Même chiffre que la carte.
      expect(nombre(await carte(page, "À prendre en charge").locator("[data-nombre]").textContent())).toBe(
        avant,
      );

      await page.goto(`/equipe/demandes/${d.reference}`);
      await expect(page.getByRole("heading", { level: 1, name: d.objet })).toBeVisible(NAVIGATION);
      await page
        .getByRole("complementary", { name: "Informations" })
        .getByRole("button", { name: "Prendre en charge" })
        .click();
      await expect(page.getByText("Vous êtes responsable de cette demande.")).toBeVisible(NAVIGATION);

      await page.goto("/equipe");
      await expect(page.getByRole("heading", { level: 1, name: /^Bonjour / })).toBeVisible(NAVIGATION);
      expect(await compteurMenu(page)).toBe(avant - 1);
    }).toPass(RELECTURES);
  });
});
