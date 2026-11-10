import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 5.2 — page Catégories (navigateur), ordinateur et téléphone.
// Nécessite la migration 20261103000031 appliquée sur nova-dev.
// Critère 1 : une catégorie ajoutée apparaît aussitôt dans le formulaire
// public (et au journal).
// Critère 2 : renommée, son nouveau nom s'affiche partout, y compris sur une
// ancienne demande.
// Critère 3 : désactivée, elle disparaît du formulaire public et du choix de
// catégorie du détail, mais reste sur les anciennes demandes. (Le refus de
// la dernière catégorie active est prouvé en base, transaction annulée, et
// par l'action simulée : les vraies catégories ne sont jamais désactivées.)
// Critère 4 : « formation » ou « Formatión » refusés quand « Formation »
// existe (« Ce nom est déjà pris. »), « réactivez-la » si elle est désactivée.
// Collaborateur refusé. Contrôle axe à chaque écran.
// Base partagée : catégories, demandes et comptes `TEST-5.2-…`, supprimés à
// la fin avec leurs lignes de journal.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-5.2-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const CHEMIN = "/equipe/admin/categories";

const comptes: CompteTest[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  try {
    await avecBase(async (base) => {
      await supprimerDemandesTest(base, PREFIXE);
      await base.query("delete from public.categories where nom like $1", [`${PREFIXE}%`]);
    });
  } catch (erreur) {
    console.error(`Nettoyage des catégories impossible : ${String(erreur)}`);
  }
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.2", ...options });
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
/** Ligne (tableau ou carte, celle qui est affichée) d'une catégorie, par son nom. */
const ligne = (page: Page, nom: string) =>
  page.locator("[data-categorie]:visible").filter({
    has: page.getByText(nom, { exact: true }),
  });
const fenetre = (page: Page) => page.getByRole("dialog");
const champNom = (page: Page) => fenetre(page).getByLabel("Nom", { exact: true });
const toast = (page: Page, texte: string) => page.getByTestId("toast").filter({ hasText: texte });

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Options du champ Catégorie du formulaire public. */
async function optionsPubliques(page: Page): Promise<string[]> {
  await page.goto("/");
  const liste = page.getByLabel("Catégorie", { exact: true });
  await expect(liste).toBeVisible(NAVIGATION);
  return liste.locator("option").allTextContents();
}

/** Options du champ Catégorie de « Saisir une demande » (saisie interne). */
async function optionsSaisie(page: Page): Promise<string[]> {
  await page.goto("/equipe/demandes/nouvelle");
  const liste = page.getByLabel("Catégorie", { exact: true });
  await expect(liste).toBeVisible(NAVIGATION);
  return liste.locator("option").allTextContents();
}

/** Saisit un nom dans la fenêtre ouverte et l'envoie. */
async function envoyerNom(page: Page, nom: string, bouton: "Ajouter" | "Enregistrer") {
  await champNom(page).fill(nom);
  await fenetre(page).getByRole("button", { name: bouton, exact: true }).click();
}

async function nomRefuse(page: Page, nom: string, message: string) {
  await envoyerNom(page, nom, "Ajouter");
  await expect(fenetre(page).getByText(message, { exact: true })).toBeVisible(NAVIGATION);
  await expect(champNom(page)).toHaveAttribute("aria-invalid", "true");
  await expect(champNom(page)).toBeFocused();
  // Saisie conservée.
  await expect(champNom(page)).toHaveValue(nom);
}

test.describe("story 5.2 — catégories", () => {
  test("critères 1 et 4 : ajout visible dans le formulaire public, doublons refusés, réactivation", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const nom = `${PREFIXE} Formation`;

    // Entrée « Catégories » entre « Comptes » et « Journal ».
    await seConnecter(page, admin, "/equipe/admin/comptes");
    await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible(NAVIGATION);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    const administration = menu(page).getByRole("link");
    const libelles = await administration.allTextContents();
    expect(libelles.indexOf("Catégories")).toBe(libelles.indexOf("Comptes") + 1);
    expect(libelles.indexOf("Journal")).toBe(libelles.indexOf("Catégories") + 1);
    await menu(page).getByRole("link", { name: "Catégories" }).click();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`), NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: "Catégories" })).toBeVisible(NAVIGATION);
    await expect(page).toHaveTitle("Catégories — Nova Services");
    await expect(page.locator("[data-categorie]:visible").first()).toBeVisible();
    await sansViolationAxe(page);

    // Ajouter « … Formation » (espaces retirés).
    await page.getByRole("button", { name: "Ajouter une catégorie" }).click();
    await expect(fenetre(page).getByRole("heading", { name: "Ajouter une catégorie" })).toBeVisible();
    await sansViolationAxe(page);
    await envoyerNom(page, `  ${nom}  `, "Ajouter");
    await expect(toast(page, "Catégorie ajoutée.")).toBeVisible(NAVIGATION);
    await expect(fenetre(page)).toHaveCount(0);
    await expect(ligne(page, nom)).toBeVisible(NAVIGATION);
    await expect(ligne(page, nom)).toContainText("Active");
    await expect(ligne(page, nom)).toContainText("0");

    // Critère 4 : doublons sans majuscules ni accents.
    await page.getByRole("button", { name: "Ajouter une catégorie" }).click();
    await nomRefuse(page, `${PREFIXE} formation`, "Ce nom est déjà pris.");
    await nomRefuse(page, `${PREFIXE} Formatión`, "Ce nom est déjà pris.");
    await sansViolationAxe(page);
    await fenetre(page).getByRole("button", { name: "Annuler" }).click();
    await expect(fenetre(page)).toHaveCount(0);

    // Critère 1 : aussitôt dans le formulaire public et dans la saisie interne.
    expect(await optionsPubliques(page)).toContain(nom);
    expect(await optionsSaisie(page)).toContain(nom);

    // Désactivée (aucune demande) : texte sans nombre ; puis « réactivez-la ».
    await page.goto(CHEMIN);
    await ligne(page, nom).getByRole("button", { name: `Désactiver ${nom}` }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText(
      `« ${nom} » ne sera plus proposée dans le formulaire ni dans le choix de catégorie.`,
    );
    await expect(confirmation).not.toContainText("demande");
    await expect(confirmation.getByRole("button", { name: "Annuler" })).toBeFocused();
    await sansViolationAxe(page);
    await confirmation.getByRole("button", { name: "Désactiver" }).click();
    await expect(toast(page, "Catégorie désactivée.")).toBeVisible(NAVIGATION);
    await expect(ligne(page, nom)).toContainText("Désactivée");
    expect(await optionsSaisie(page)).not.toContain(nom);
    await page.goto(CHEMIN);

    await page.getByRole("button", { name: "Ajouter une catégorie" }).click();
    await nomRefuse(
      page,
      `${PREFIXE} formation`,
      "Une catégorie désactivée porte déjà ce nom : réactivez-la.",
    );
    await fenetre(page).getByRole("button", { name: "Annuler" }).click();

    await ligne(page, nom).getByRole("button", { name: `Réactiver ${nom}` }).click();
    await expect(toast(page, "Catégorie réactivée.")).toBeVisible(NAVIGATION);
    await expect(ligne(page, nom)).toContainText("Active");
    await expect(ligne(page, nom).getByRole("button", { name: `Désactiver ${nom}` })).toBeVisible();

    // Refus : désactivée entre-temps (autre administrateur) → toast d'erreur,
    // la ligne montre le vrai état, le focus reste dans la ligne.
    await avecBase((base) =>
      base.query("update public.categories set actif = false where nom = $1", [nom]),
    );
    await ligne(page, nom).getByRole("button", { name: `Désactiver ${nom}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Désactiver" }).click();
    await expect(
      toast(page, "Cette action n'est pas possible pour l'état actuel de cette catégorie."),
    ).toBeVisible(NAVIGATION);
    await expect(ligne(page, nom)).toContainText("Désactivée", NAVIGATION);
    await expect(ligne(page, nom).getByRole("button", { name: `Réactiver ${nom}` })).toBeVisible();
    await expect(ligne(page, nom).getByRole("button", { name: `Renommer ${nom}` })).toBeFocused();

    // Journal : les trois événements, au nom de l'administratrice.
    await page.goto("/equipe/admin/journal?type=categorie");
    await expect(page.getByText(`Catégorie ajoutée : ${nom}`).filter({ visible: true }).first()).toBeVisible(
      NAVIGATION,
    );
    await expect(page.getByText(`Catégorie désactivée : ${nom}`).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(`Catégorie réactivée : ${nom}`).filter({ visible: true }).first()).toBeVisible();
  });

  test("critères 2 et 3 : renommée partout, désactivée mais gardée par les anciennes demandes", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const ancienNom = `${PREFIXE} Conseil`;
    const nouveauNom = `${PREFIXE} Conseils`;

    // Catégorie utilisée par 3 demandes, plus une autre demande ordinaire.
    const { categorieId, demandes, autre } = await avecBase(async (base) => {
      const { rows } = await base.query<{ id: string }>(
        "insert into public.categories (nom, ordre) values ($1, 999) returning id",
        [ancienNom],
      );
      const id = rows[0].id;
      const liste: DemandeTest[] = [];
      for (let i = 0; i < 3; i++) {
        liste.push(await creerDemandeTest(base, PREFIXE, { categorieId: id, decalage: `5 days ${i} minutes` }));
      }
      const ordinaire = await creerDemandeTest(base, PREFIXE, { decalage: "5 days 10 minutes" });
      return { categorieId: id, demandes: liste, autre: ordinaire };
    });

    await seConnecter(page, admin, CHEMIN);
    await expect(ligne(page, ancienNom)).toBeVisible(NAVIGATION);
    await expect(ligne(page, ancienNom)).toContainText("3");

    // Critère 2 : renommer (fenêtre préremplie).
    await ligne(page, ancienNom).getByRole("button", { name: `Renommer ${ancienNom}` }).click();
    await expect(champNom(page)).toHaveValue(ancienNom);
    await sansViolationAxe(page);
    await envoyerNom(page, nouveauNom, "Enregistrer");
    await expect(toast(page, "Catégorie renommée.")).toBeVisible(NAVIGATION);
    await expect(ligne(page, nouveauNom)).toBeVisible(NAVIGATION);
    await expect(ligne(page, ancienNom)).toHaveCount(0);

    // Ancienne demande : le nouveau nom dans le choix de catégorie du détail.
    await page.goto(`/equipe/demandes/${demandes[0].reference}`);
    const panneau = page.getByRole("complementary", { name: "Informations" });
    const choix = panneau.getByLabel("Catégorie", { exact: true });
    await expect(choix).toHaveValue(categorieId, NAVIGATION);
    await expect(choix.locator(`option[value="${categorieId}"]`)).toHaveText(nouveauNom);
    expect(await optionsPubliques(page)).toContain(nouveauNom);

    // Critère 3 : désactiver, fenêtre avec le nombre de demandes.
    await page.goto(CHEMIN);
    await ligne(page, nouveauNom).getByRole("button", { name: `Désactiver ${nouveauNom}` }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText(
      `« ${nouveauNom} » ne sera plus proposée dans le formulaire ni dans le choix de catégorie. Les 3 demandes qui l'utilisent la gardent.`,
    );
    await confirmation.getByRole("button", { name: "Désactiver" }).click();
    await expect(toast(page, "Catégorie désactivée.")).toBeVisible(NAVIGATION);
    await expect(ligne(page, nouveauNom)).toContainText("Désactivée");
    await expect(ligne(page, nouveauNom)).toContainText("3");
    await sansViolationAxe(page);

    // Plus proposée dans le formulaire public.
    expect(await optionsPubliques(page)).not.toContain(nouveauNom);

    // Les anciennes demandes la gardent (« (désactivée) ») ...
    for (const d of demandes) {
      const { rows } = await avecBase((base) =>
        base.query<{ categorie_id: string }>("select categorie_id from public.demandes where id = $1", [d.id]),
      );
      expect(rows[0].categorie_id).toBe(categorieId);
    }
    await page.goto(`/equipe/demandes/${demandes[1].reference}`);
    await expect(choix).toHaveValue(categorieId, NAVIGATION);
    await expect(choix.locator(`option[value="${categorieId}"]`)).toHaveText(`${nouveauNom} (désactivée)`);

    // ... mais une autre demande ne la propose plus.
    await page.goto(`/equipe/demandes/${autre.reference}`);
    await expect(choix).toBeVisible(NAVIGATION);
    await expect(choix.locator(`option[value="${categorieId}"]`)).toHaveCount(0);
  });

  test("un collaborateur qui tape l'adresse est refusé", async ({ page }) => {
    const collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
    await seConnecter(page, collaborateur, CHEMIN);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vous n'avez pas accès à cette page.");
    await expect(page).toHaveTitle("Accès refusé — Nova Services");
    await expect(page.locator("[data-categorie]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajouter une catégorie" })).toHaveCount(0);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    await expect(menu(page).getByRole("link", { name: "Catégories" })).toHaveCount(0);
    await sansViolationAxe(page);
  });
});
