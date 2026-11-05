import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";

// Story 2.4 — priorité et catégorie (navigateur). Nécessite la migration
// 20261103000017 appliquée sur nova-dev.
// Critères 1 à 3 d'epics.md : priorité Haute (badge rouge, historique, liste),
// catégorie corrigée (historique avec les deux noms, liste), catégorie
// désactivée affichée « (désactivée) » ; erreur réseau (valeur précédente
// remise) ; contrôle axe. Ordinateur et téléphone.
// Base partagée : comptes, demandes et catégorie `TEST-2.4-…`, effacés à la
// fin. Les catégories partagées ne sont jamais modifiées.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.4-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };

type Categorie = { id: string; nom: string };
let karim: CompteTest;
let information: Categorie;
let technique: Categorie;
let desactivee: Categorie;

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.4" });
  await avecBase(async (base) => {
    const { rows } = await base.query<Categorie>(
      "select id, nom from public.categories where actif order by ordre, nom limit 2",
    );
    if (rows.length < 2) {
      throw new Error("Au moins deux catégories actives sont nécessaires à ces tests.");
    }
    [information, technique] = rows;
    const { rows: creee } = await base.query<Categorie>(
      "insert into public.categories (nom, actif, ordre) values ($1, false, 999) returning id, nom",
      [`${PREFIXE} Ancienne`],
    );
    desactivee = creee[0];
  });
});

test.afterAll(async () => {
  let demandesNettoyees = false;
  try {
    await avecBase(async (base) => {
      await supprimerDemandesTest(base, PREFIXE);
      await base.query("delete from public.categories where nom like $1", [`${PREFIXE}%`]);
    });
    demandesNettoyees = true;
  } catch (erreur) {
    console.error(`Nettoyage des données de test impossible : ${String(erreur)}`);
  } finally {
    if (demandesNettoyees && karim) await supprimerComptesTest([karim]);
  }
});

// Story 1.9 : chaque contexte se connecte depuis sa propre IP de test.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

/** Demande datée dans le futur : en tête de la liste. */
function demande(options: Parameters<typeof creerDemandeTest>[2] = {}): Promise<DemandeTest> {
  const minutes = Math.floor(Math.random() * 1000);
  return avecBase((base) =>
    creerDemandeTest(base, PREFIXE, { decalage: `4 days ${minutes} minutes`, ...options }),
  );
}

async function ouvrir(page: Page, d: DemandeTest) {
  const retour = `/equipe/demandes/${d.reference}`;
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(karim.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(karim.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(new RegExp(`${retour}$`), APRES_CONNEXION);
  await expect(page.getByRole("heading", { level: 1, name: d.objet })).toBeVisible(NAVIGATION);
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Ralentit les actions serveur (liste désactivée pendant l'envoi) et les compte. */
async function ralentirActions(page: Page, delai: number): Promise<{ nombre: number }> {
  const appels = { nombre: 0 };
  await page.route("**/equipe/demandes/**", async (route) => {
    const requete = route.request();
    if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
      appels.nombre++;
      await new Promise((r) => setTimeout(r, delai));
    }
    await route.continue();
  });
  return appels;
}

/** Coupe le réseau des actions serveur (les pages continuent de charger). */
async function couperActions(page: Page) {
  await page.route("**/equipe/demandes/**", async (route) => {
    const requete = route.request();
    if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
      await route.abort("internetdisconnected");
    } else {
      await route.continue();
    }
  });
}

async function poserRepere(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __sansRechargement?: boolean }).__sansRechargement = true;
  });
}

async function sansRechargement(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { __sansRechargement?: boolean }).__sansRechargement),
  ).toBe(true);
}

const MESSAGE_RESEAU =
  "Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant.";

function panneau(page: Page) {
  return page.getByRole("complementary", { name: "Informations" });
}

function listePriorite(page: Page) {
  return panneau(page).getByLabel("Priorité", { exact: true });
}

function listeCategorie(page: Page) {
  return panneau(page).getByLabel("Catégorie", { exact: true });
}

function lignesHistorique(page: Page) {
  return page.getByTestId("historique").locator("li");
}

/** Revient à la liste et renvoie la ligne (ou carte) visible de la demande. */
async function ligneDansListe(page: Page, d: DemandeTest) {
  await page.getByRole("link", { name: "← Retour aux demandes" }).click();
  await expect(page).toHaveURL(/\/equipe\/demandes$/, NAVIGATION);
  const ligne = page.locator(`[data-reference="${d.reference}"]:visible`);
  await expect(ligne).toBeVisible(NAVIGATION);
  return ligne;
}

test.describe("priorité et catégorie", () => {
  test("critère 1 : priorité Haute — badge rouge, historique, liste, sans recharger", async ({ page }) => {
    const d = await demande();
    await ouvrir(page, d);
    await expect(listePriorite(page)).toHaveValue("normale");
    await expect(panneau(page).locator("[data-priorite]")).toHaveText("Normale");
    await poserRepere(page);

    await ralentirActions(page, 800);
    await listePriorite(page).selectOption("haute");
    await expect(listePriorite(page)).toBeDisabled();

    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      "Priorité modifiée : Haute.",
      NAVIGATION,
    );
    await expect(panneau(page).locator("[data-priorite]")).toHaveAttribute("data-priorite", "haute");
    await expect(panneau(page).locator("[data-priorite]")).toHaveText("Haute");
    await expect(page.locator("header [data-priorite]")).toHaveText("Haute");
    await expect(listePriorite(page)).toBeEnabled();
    await expect(listePriorite(page)).toHaveValue("haute");
    await expect(listePriorite(page)).toBeFocused();
    await expect(lignesHistorique(page)).toHaveCount(2);
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `${karim.nom} a changé la priorité : Normale → Haute`,
    );
    await sansRechargement(page);
    await sansViolationAxe(page);

    const ligne = await ligneDansListe(page, d);
    await expect(ligne.locator("[data-priorite]")).toHaveAttribute("data-priorite", "haute");
    await expect(ligne.locator("[data-priorite]")).toHaveText("Haute");
  });

  test("critère 2 : catégorie corrigée — historique avec les deux noms, liste", async ({ page }) => {
    const d = await demande();
    await ouvrir(page, d);
    await expect(listeCategorie(page)).toHaveValue(information.id);
    await poserRepere(page);

    await listeCategorie(page).selectOption(technique.id);
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      `Catégorie modifiée : ${technique.nom}.`,
      NAVIGATION,
    );
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `${karim.nom} a changé la catégorie : ${information.nom} → ${technique.nom}`,
      NAVIGATION,
    );
    await expect(listeCategorie(page)).toHaveValue(technique.id);
    await sansRechargement(page);

    // La catégorie n'est affichée dans la liste que sur ordinateur et tablette.
    const ligne = await ligneDansListe(page, d);
    if (test.info().project.name === "ordinateur") {
      await expect(ligne).toContainText(technique.nom);
      await expect(ligne).not.toContainText(information.nom);
    }
  });

  test("critère 3 : catégorie actuelle désactivée — « (désactivée) », choisie, non reproposée", async ({
    page,
  }) => {
    const d = await demande();
    await avecBase((base) =>
      base.query("update public.demandes set categorie_id = $2 where id = $1", [d.id, desactivee.id]),
    );
    await ouvrir(page, d);
    const liste = listeCategorie(page);
    await expect(liste).toHaveValue(desactivee.id);
    const options = liste.locator("option");
    await expect(options.first()).toHaveText(`${desactivee.nom} (désactivée)`);
    await expect(options.first()).toBeDisabled();
    // Les catégories actives suivent (dont celles des formulaires).
    await expect(liste.locator(`option[value="${technique.id}"]`)).toBeEnabled();
    await sansViolationAxe(page);

    await liste.selectOption(technique.id);
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      `Catégorie modifiée : ${technique.nom}.`,
      NAVIGATION,
    );
    await expect(liste).toHaveValue(technique.id);
    // Une fois quittée, la catégorie désactivée n'est plus proposée.
    await expect(liste.locator(`option[value="${desactivee.id}"]`)).toHaveCount(0);
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `${karim.nom} a changé la catégorie : ${desactivee.nom} → ${technique.nom}`,
    );
  });

  test("demande Traitée : priorité modifiable", async ({ page }) => {
    const d = await demande({ statut: "traitee", responsableId: karim.id });
    await ouvrir(page, d);
    await listePriorite(page).selectOption("basse");
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      "Priorité modifiée : Basse.",
      NAVIGATION,
    );
    await expect(panneau(page).locator("[data-priorite]")).toHaveText("Basse");
  });

  test("catégorie d'une demande Traitée : modifiable", async ({ page }) => {
    const d = await demande({ statut: "traitee", responsableId: karim.id });
    await ouvrir(page, d);
    await listeCategorie(page).selectOption(technique.id);
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      `Catégorie modifiée : ${technique.nom}.`,
      NAVIGATION,
    );
    await expect(listeCategorie(page)).toHaveValue(technique.id);
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Traitée");
  });

  test("refus attendu : catégorie désactivée entre-temps — toast rouge, valeur précédente, aucune ligne", async ({
    page,
  }) => {
    const nom = `${PREFIXE} Jetable ${randomUUID().slice(0, 4)}`;
    // Catégorie jetable active le temps d'ouvrir la page (comme la story 1.3).
    const { rows } = await avecBase((base) =>
      base.query<{ id: string }>(
        "insert into public.categories (nom, ordre) values ($1, 999) returning id",
        [nom],
      ),
    );
    const jetable = rows[0].id;
    const d = await demande();
    try {
      await ouvrir(page, d);
      await expect(listeCategorie(page).locator(`option[value="${jetable}"]`)).toHaveCount(1);
    } finally {
      await avecBase((base) =>
        base.query("update public.categories set actif = false where id = $1", [jetable]),
      );
    }

    await listeCategorie(page).selectOption(jetable);
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(
      "Choisissez une catégorie dans la liste.",
      NAVIGATION,
    );
    await expect(listeCategorie(page)).toHaveValue(information.id);
    // Détail rafraîchi : la catégorie désactivée n'est plus proposée.
    await expect(listeCategorie(page).locator(`option[value="${jetable}"]`)).toHaveCount(0, NAVIGATION);
    await expect(lignesHistorique(page)).toHaveCount(1);
  });

  test("double changement avant la réponse : un seul envoi", async ({ page }) => {
    const d = await demande();
    await ouvrir(page, d);
    const appels = await ralentirActions(page, 800);
    // Deux choix d'affilée, avant le nouveau rendu (la liste n'est pas encore désactivée).
    await listePriorite(page).evaluate((liste: HTMLSelectElement) => {
      liste.value = "haute";
      liste.dispatchEvent(new Event("change", { bubbles: true }));
      liste.value = "basse";
      liste.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      "Priorité modifiée : Haute.",
      NAVIGATION,
    );
    await expect(listePriorite(page)).toHaveValue("haute");
    await expect(lignesHistorique(page)).toHaveCount(2);
    expect(appels.nombre).toBe(1);
  });

  test("erreur réseau : toast rouge, valeur précédente remise, rien ne change", async ({ page }) => {
    const d = await demande();
    await ouvrir(page, d);
    await couperActions(page);

    await listePriorite(page).selectOption("haute");
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(MESSAGE_RESEAU, NAVIGATION);
    await expect(listePriorite(page)).toHaveValue("normale");
    await expect(listePriorite(page)).toBeEnabled();
    await expect(panneau(page).locator("[data-priorite]")).toHaveText("Normale");

    // Fermer le premier toast d'erreur (persistant), pour lire le second.
    await page.getByRole("alert").getByTestId("toast").getByRole("button").click();
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveCount(0);
    await listeCategorie(page).selectOption(technique.id);
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(MESSAGE_RESEAU, NAVIGATION);
    await expect(listeCategorie(page)).toHaveValue(information.id, NAVIGATION);
    await expect(listeCategorie(page)).toBeEnabled();
    await expect(lignesHistorique(page)).toHaveCount(1);

    const { rows } = await avecBase((base) =>
      base.query<{ priorite: string; categorie_id: string }>(
        "select priorite, categorie_id from public.demandes where id = $1",
        [d.id],
      ),
    );
    expect(rows[0]).toEqual({ priorite: "normale", categorie_id: information.id });
  });
});
