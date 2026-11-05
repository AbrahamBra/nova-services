import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";

// Story 2.7 — libérer ou attribuer une demande (navigateur). Nécessite les
// migrations 20261103000022 et 20261103000023 appliquées sur nova-dev.
// Critères 1 à 4 d'epics.md : libérer comme responsable ; attribuer puis
// réattribuer comme administratrice (fenêtre, membres actifs seulement) ;
// libérer comme administratrice non responsable ; un collaborateur ne voit
// ni « Attribuer à… », ni « Libérer » sur une demande d'un autre.
// Base partagée : chaque processus crée ses propres comptes et demandes
// `TEST-2.7-…`, effacés à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.7-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };

let karim: CompteTest; // collaborateur
let nadia: CompteTest; // second collaborateur
let claire: CompteTest; // administratrice
let desactive: CompteTest;
let invite: CompteTest;
// Comptes créés par un test (fenêtre périmée), effacés à la fin.
const autres: CompteTest[] = [];

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.7" });
  nadia = await creerCompteTest({ role: "collaborateur", prenom: "Nadia", etiquette: "2.7" });
  claire = await creerCompteTest({ role: "administrateur", prenom: "Claire", etiquette: "2.7" });
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.7" });
  invite = await creerCompteTest({ etat: "invite", prenom: "Ines", etiquette: "2.7" });
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
    const comptes = [karim, nadia, claire, desactive, invite, ...autres].filter(Boolean);
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

/** Ouvre une autre demande, déjà connecté. */
async function aller(page: Page, d: DemandeTest) {
  await page.goto(`/equipe/demandes/${d.reference}`);
  await expect(page.getByRole("heading", { level: 1, name: d.objet })).toBeVisible(NAVIGATION);
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Compte les appels d'actions serveur. */
async function suivreActions(page: Page): Promise<{ nombre: number }> {
  const appels = { nombre: 0 };
  await page.route("**/equipe/demandes/**", async (route) => {
    const requete = route.request();
    if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
      appels.nombre++;
    }
    await route.continue();
  });
  return appels;
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

function panneau(page: Page) {
  return page.getByRole("complementary", { name: "Informations" });
}

function lignesHistorique(page: Page) {
  return page.getByTestId("historique").locator("li");
}

function boutonLiberer(page: Page) {
  return panneau(page).getByRole("button", { name: "Libérer" });
}

function boutonAttribuer(page: Page) {
  return panneau(page).getByRole("button", { name: "Attribuer à…" });
}

function toastReussite(page: Page) {
  return page.getByRole("status").getByTestId("toast");
}

/** Noms proposés dans la fenêtre (sans l'option « Choisissez un membre »). */
async function membresProposes(page: Page): Promise<string[]> {
  const textes = await page
    .getByRole("alertdialog", { name: "Attribuer la demande" })
    .getByTestId("choix-membre")
    .locator("option:not([disabled])")
    .allTextContents();
  return textes.map((t) => t.trim());
}

test.describe("libérer ou attribuer une demande", () => {
  test("critère 1 : le responsable libère, la demande revient en Nouvelle sans responsable", async ({
    page,
  }) => {
    const d = await demande({ statut: "en_cours", responsableId: karim.id });
    await ouvrir(page, karim, d);
    await expect(page.getByTestId("responsable")).toHaveText(karim.nom);
    // Collaborateur : pas d'attribution, même sur sa propre demande.
    await expect(boutonAttribuer(page)).toHaveCount(0);
    await sansViolationAxe(page);
    await poserRepere(page);

    await boutonLiberer(page).click();
    await expect(toastReussite(page)).toHaveText(
      "Demande libérée. Elle revient en Nouvelle.",
      NAVIGATION,
    );
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Nouvelle");
    await expect(page.locator('header [data-statut="nouvelle"]')).toHaveText("Nouvelle");
    await expect(boutonLiberer(page)).toHaveCount(0);
    await expect(panneau(page).getByRole("button", { name: "Prendre en charge" })).toBeVisible();
    await expect(lignesHistorique(page)).toHaveCount(2);
    await expect(lignesHistorique(page).nth(1)).toContainText(`${karim.nom} a libéré la demande`);
    // Le bouton a disparu : focus sur la partie « Responsable », pas sur <body>.
    await expect(page.getByTestId("actions-responsable")).toBeFocused();
    await sansRechargement(page);
  });

  test("critère 2 : l'administratrice attribue une Nouvelle, puis la réattribue", async ({ page }) => {
    const d = await demande();
    await ouvrir(page, claire, d);
    await poserRepere(page);
    const appels = await suivreActions(page);

    // Nouvelle : « Attribuer à… », pas « Libérer ».
    await expect(boutonLiberer(page)).toHaveCount(0);
    const declencheur = boutonAttribuer(page);
    await declencheur.click();
    const fenetre = page.getByRole("alertdialog", { name: "Attribuer la demande" });
    await expect(fenetre).toBeVisible();
    await expect(fenetre.getByRole("button", { name: "Annuler" })).toBeFocused();

    // Membres actifs seulement, par nom ; jamais un compte désactivé ou invité.
    const proposes = await membresProposes(page);
    expect(proposes).toEqual(expect.arrayContaining([karim.nom, nadia.nom, claire.nom]));
    expect(proposes).not.toContain(desactive.nom);
    expect(proposes).not.toContain(invite.nom);

    await sansViolationAxe(page);

    // Sans choix : message sous la liste, rien d'envoyé.
    await fenetre.getByRole("button", { name: "Attribuer" }).click();
    await expect(fenetre.getByTestId("erreur-membre")).toHaveText("Choisissez un membre.");
    await expect(fenetre.getByLabel("Membre")).toBeFocused();
    expect(appels.nombre).toBe(0);

    // Focus gardé dans la fenêtre ; Échap ferme et rend le focus.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await fenetre.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(fenetre).toHaveCount(0);
    await expect(declencheur).toBeFocused();
    expect(appels.nombre).toBe(0);

    // Attribution au collaborateur de test.
    await declencheur.click();
    await fenetre.getByLabel("Membre").selectOption({ label: karim.nom });
    await fenetre.getByRole("button", { name: "Attribuer" }).click();
    await expect(toastReussite(page)).toHaveText(`Demande attribuée à ${karim.nom}.`, NAVIGATION);
    await expect(fenetre).toHaveCount(0);
    await expect(page.getByTestId("responsable")).toHaveText(karim.nom);
    await expect(panneau(page).locator("[data-statut]")).toHaveText("En cours");
    await expect(lignesHistorique(page)).toHaveCount(2);
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `${claire.nom} a attribué la demande à ${karim.nom}`,
    );
    // En cours d'un autre : l'administratrice voit aussi « Libérer » (critère 3).
    await expect(boutonLiberer(page)).toBeVisible();

    // Réattribution : le responsable actuel n'est plus proposé.
    await boutonAttribuer(page).click();
    await expect(fenetre).toBeVisible();
    const ensuite = await membresProposes(page);
    expect(ensuite).not.toContain(karim.nom);
    expect(ensuite).toContain(nadia.nom);
    await fenetre.getByLabel("Membre").selectOption({ label: nadia.nom });
    await fenetre.getByRole("button", { name: "Attribuer" }).click();
    await expect(page.getByTestId("responsable")).toHaveText(nadia.nom, NAVIGATION);
    await expect(fenetre).toHaveCount(0);
    await expect(lignesHistorique(page)).toHaveCount(3);
    await expect(lignesHistorique(page).nth(2)).toContainText(
      `${claire.nom} a attribué la demande à ${nadia.nom}`,
    );
    expect(appels.nombre).toBe(2);
    await sansRechargement(page);
  });

  test("critère 3 : l'administratrice libère une demande En cours dont elle n'est pas responsable", async ({
    page,
  }) => {
    const d = await demande({ statut: "en_cours", responsableId: nadia.id });
    await ouvrir(page, claire, d);
    await expect(page.getByTestId("responsable")).toHaveText(nadia.nom);
    await expect(boutonAttribuer(page)).toBeVisible();
    await boutonLiberer(page).click();
    await expect(toastReussite(page)).toHaveText(
      "Demande libérée. Elle revient en Nouvelle.",
      NAVIGATION,
    );
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Nouvelle");
    await expect(lignesHistorique(page).nth(1)).toContainText(`${claire.nom} a libéré la demande`);
    // Toujours administratrice, demande non Traitée : l'attribution reste possible.
    await expect(boutonAttribuer(page)).toBeVisible();
  });

  test("critère 4 : un collaborateur ne voit ni « Attribuer à… », ni « Libérer » sur la demande d'un autre", async ({
    page,
  }) => {
    const autre = await demande({ statut: "en_cours", responsableId: nadia.id });
    const nouvelle = await demande();
    const traitee = await demande({ statut: "traitee", responsableId: karim.id });
    await ouvrir(page, karim, autre);
    await expect(page.getByTestId("responsable")).toHaveText(nadia.nom);
    await expect(boutonLiberer(page)).toHaveCount(0);
    await expect(boutonAttribuer(page)).toHaveCount(0);
    await sansViolationAxe(page);

    await aller(page, nouvelle);
    await expect(boutonAttribuer(page)).toHaveCount(0);
    await expect(boutonLiberer(page)).toHaveCount(0);
    await expect(panneau(page).getByRole("button", { name: "Prendre en charge" })).toBeVisible();

    // Traitée, même la sienne : pas de « Libérer » (on la rouvre d'abord).
    await aller(page, traitee);
    await expect(boutonLiberer(page)).toHaveCount(0);
    await expect(boutonAttribuer(page)).toHaveCount(0);
  });

  test("administratrice sur une demande Traitée : ni « Attribuer à… », ni « Libérer »", async ({ page }) => {
    const traitee = await demande({ statut: "traitee", responsableId: karim.id });
    await ouvrir(page, claire, traitee);
    await expect(panneau(page).getByRole("button", { name: "Rouvrir" })).toBeVisible();
    await expect(boutonAttribuer(page)).toHaveCount(0);
    await expect(boutonLiberer(page)).toHaveCount(0);
  });

  test("onglet périmé : libérer une demande déjà Traitée donne un toast rouge et le vrai état", async ({
    page,
  }) => {
    const d = await demande({ statut: "en_cours", responsableId: karim.id });
    await ouvrir(page, karim, d);
    await avecBase((base) =>
      base.query("update public.demandes set statut = 'traitee' where id = $1", [d.id]),
    );
    await boutonLiberer(page).click();
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(
      "Ce changement de statut n'est pas autorisé.",
      NAVIGATION,
    );
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Traitée");
    await expect(boutonLiberer(page)).toHaveCount(0);
    await expect(page.getByTestId("actions-responsable")).toBeFocused();
  });

  test("fenêtre périmée : membre désactivé entre-temps → message sous la liste, fenêtre ouverte", async ({
    page,
  }) => {
    const hugo = await creerCompteTest({ role: "collaborateur", prenom: "Hugo", etiquette: "2.7" });
    autres.push(hugo);
    const d = await demande();
    await ouvrir(page, claire, d);
    await boutonAttribuer(page).click();
    const fenetre = page.getByRole("alertdialog", { name: "Attribuer la demande" });
    await fenetre.getByLabel("Membre").selectOption({ label: hugo.nom });
    await avecBase((base) =>
      base.query("update public.membres set etat = 'desactive' where id = $1", [hugo.id]),
    );
    await fenetre.getByRole("button", { name: "Attribuer" }).click();
    await expect(fenetre.getByTestId("erreur-membre")).toHaveText("Ce membre n'est pas actif.", NAVIGATION);
    await expect(fenetre).toBeVisible();
    // Focus sur la liste une fois l'envoi terminé ; le membre n'est plus proposé.
    await expect(fenetre.getByLabel("Membre")).toBeFocused();
    await expect.poll(() => membresProposes(page), NAVIGATION).not.toContain(hugo.nom);
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
  });

  test("fenêtre périmée : demande devenue Traitée → toast rouge, fenêtre fermée, focus sur Responsable", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, claire, d);
    await boutonAttribuer(page).click();
    const fenetre = page.getByRole("alertdialog", { name: "Attribuer la demande" });
    await fenetre.getByLabel("Membre").selectOption({ label: nadia.nom });
    await avecBase((base) =>
      base.query("update public.demandes set statut = 'traitee' where id = $1", [d.id]),
    );
    await fenetre.getByRole("button", { name: "Attribuer" }).click();
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(
      "Ce changement de statut n'est pas autorisé.",
      NAVIGATION,
    );
    await expect(fenetre).toHaveCount(0);
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Traitée");
    await expect(boutonAttribuer(page)).toHaveCount(0);
    await expect(page.getByTestId("actions-responsable")).toBeFocused();
  });
});
