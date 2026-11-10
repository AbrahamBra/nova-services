import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { formaterDuree } from "../../lib/format";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 5.3 — page Paramètres (navigateur), ordinateur et téléphone, SANS
// changer les valeurs partagées : formulaire prérempli, entrée du menu,
// aperçu mis à jour pendant la saisie (critère 2 : « 3 ans »), email mal
// écrit refusé sous le champ (critère 3, rien d'enregistré), « rien de
// changé » (toast, aucune ligne de journal), collaborateur refusé, axe.
// Nécessite la migration 20261103000032 appliquée sur nova-dev.
// L'enregistrement de vraies valeurs (critères 1 et 2 sur le formulaire
// public et la confirmation) est dans parametres.reel.spec.ts, joué après
// tous les autres par le projet « valeurs-reelles ».

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const CHEMIN = "/equipe/admin/parametres";

const comptes: CompteTest[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.3", ...options });
  comptes.push(c);
  return c;
}

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(new RegExp(`${retour.replaceAll("/", "\\/")}$`), APRES_CONNEXION);
}

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu de l'espace équipe" });
const boutonMenu = (page: Page) => page.getByRole("button", { name: "Menu" });
const toast = (page: Page, texte: string) => page.getByTestId("toast").filter({ hasText: texte });
const champ = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });
const apercu = (page: Page) => page.getByTestId("apercu-mention");

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

type Valeurs = { nom_affiche: string; email_contact: string; duree_conservation_mois: number };

async function valeursEnBase(): Promise<Valeurs & { mis_a_jour_le: string }> {
  const { rows } = await avecBase((base) =>
    base.query<Valeurs & { mis_a_jour_le: string }>(
      "select nom_affiche, email_contact, duree_conservation_mois, mis_a_jour_le::text from public.parametres",
    ),
  );
  return rows[0];
}

async function lignesJournal(c: CompteTest): Promise<number> {
  const { rows } = await avecBase((base) =>
    base.query("select 1 from public.journal where auteur_id = $1 and type = 'parametre'", [c.id]),
  );
  return rows.length;
}

test.describe("story 5.3 — paramètres (sans changer les valeurs)", () => {
  test("menu, formulaire prérempli, aperçu pendant la saisie (3 ans), email mal écrit refusé", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const depart = await valeursEnBase();

    // Entrée « Paramètres » entre « Catégories » et « Journal ».
    await seConnecter(page, admin, "/equipe/admin/categories");
    await expect(page.getByRole("heading", { level: 1, name: "Catégories" })).toBeVisible(NAVIGATION);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    const libelles = await menu(page).getByRole("link").allTextContents();
    expect(libelles.indexOf("Paramètres")).toBe(libelles.indexOf("Catégories") + 1);
    expect(libelles.indexOf("Journal")).toBe(libelles.indexOf("Paramètres") + 1);
    await menu(page).getByRole("link", { name: "Paramètres" }).click();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`), NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible(NAVIGATION);
    await expect(page).toHaveTitle("Paramètres — Nova Services");

    // Prérempli avec les valeurs actuelles.
    await expect(champ(page, "Nom affiché")).toHaveValue(depart.nom_affiche);
    await expect(champ(page, "Email de contact")).toHaveValue(depart.email_contact);
    await expect(champ(page, "Durée de conservation")).toHaveValue(String(depart.duree_conservation_mois));
    await expect(champ(page, "Durée de conservation").locator("option")).toHaveText([
      "6 mois",
      "1 an",
      "18 mois",
      "2 ans",
      "3 ans",
      "4 ans",
      "5 ans",
    ]);
    await expect(apercu(page)).toHaveText(
      `Vos informations servent uniquement à traiter votre demande. Elles sont conservées ${formaterDuree(
        depart.duree_conservation_mois,
      )} après son traitement, puis supprimées. Pour les faire effacer, écrivez à ${depart.email_contact}.`,
    );
    await sansViolationAxe(page);

    // Critère 2 (aperçu) : 3 ans, mis à jour pendant la saisie.
    await champ(page, "Durée de conservation").selectOption({ label: "3 ans" });
    await expect(apercu(page)).toContainText("Elles sont conservées 3 ans après son traitement");
    await champ(page, "Email de contact").fill("Accueil@Nova.example");
    await expect(apercu(page)).toContainText("écrivez à accueil@nova.example.");

    // Critère 3 : email mal écrit → sous le champ, focus, saisie conservée,
    // rien d'enregistré.
    await champ(page, "Email de contact").fill("accueil@nova");
    await champ(page, "Nom affiché").focus();
    await page.getByRole("button", { name: "Enregistrer les paramètres" }).click();
    await expect(page.getByText("Cette adresse email ne semble pas valide.", { exact: true })).toBeVisible();
    await expect(champ(page, "Email de contact")).toHaveAttribute("aria-invalid", "true");
    await expect(champ(page, "Email de contact")).toBeFocused();
    await expect(champ(page, "Email de contact")).toHaveValue("accueil@nova");
    await expect(champ(page, "Durée de conservation")).toHaveValue("36");
    await sansViolationAxe(page);
    expect(await valeursEnBase()).toEqual(depart);
    expect(await lignesJournal(admin)).toBe(0);

    // Corrigé : l'erreur disparaît dès la saisie.
    await champ(page, "Email de contact").fill("accueil@nova.example");
    await expect(page.getByText("Cette adresse email ne semble pas valide.", { exact: true })).toHaveCount(0);

    // Rechargée : rien n'a été enregistré.
    await page.reload();
    await expect(champ(page, "Email de contact")).toHaveValue(depart.email_contact, NAVIGATION);
  });

  test("rien de changé : toast « Paramètres enregistrés. », aucune ligne de journal", async ({ page }) => {
    const admin = await compte({ role: "administrateur", prenom: "Hugo" });
    const depart = await valeursEnBase();
    await seConnecter(page, admin, CHEMIN);
    await expect(champ(page, "Email de contact")).toHaveValue(depart.email_contact, NAVIGATION);
    await page.getByRole("button", { name: "Enregistrer les paramètres" }).click();
    await expect(toast(page, "Paramètres enregistrés.")).toBeVisible(NAVIGATION);
    expect(await valeursEnBase()).toEqual(depart);
    expect(await lignesJournal(admin)).toBe(0);
  });

  test("un collaborateur qui tape l'adresse est refusé", async ({ page }) => {
    const collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
    await seConnecter(page, collaborateur, CHEMIN);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vous n'avez pas accès à cette page.");
    await expect(page).toHaveTitle("Accès refusé — Nova Services");
    await expect(page.getByRole("button", { name: "Enregistrer les paramètres" })).toHaveCount(0);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    await expect(menu(page).getByRole("link", { name: "Paramètres" })).toHaveCount(0);
    await sansViolationAxe(page);
  });
});
