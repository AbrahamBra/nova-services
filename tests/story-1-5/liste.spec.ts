import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import {
  creerDemandeTest,
  creerDemandesRemplissage,
  supprimerDemandesTest,
  type DemandeTest,
} from "../outils/demandes";

// Story 1.5 — liste des demandes (navigateur). Nécessite la migration
// 20261103000007 appliquée sur nova-dev.
// La base est partagée : chaque processus crée ses propres demandes
// `TEST-1.5-…` (datées dans le futur pour rester en tête de liste, plus 26
// demandes anciennes pour avoir toujours au moins 2 pages) et vérifie leur
// présence et leur ordre, jamais un nombre exact. Tout est effacé à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-1.5-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
// Navigations : le serveur de développement est partagé par 3 processus.
const NAVIGATION = { timeout: 15_000 };
const NOMBRE = String.raw`\d[\d ]*`;
// Story 1.6 : le lien du détail transmet la page de la liste — aucun
// paramètre en page 1, `?page=N` au-delà.
function adresseDetailAttendue(reference: string, position: { numeroPage: number } | undefined): string {
  const numero = position!.numeroPage;
  return numero === 1 ? `/equipe/demandes/${reference}` : `/equipe/demandes/${reference}?page=${numero}`;
}

/** Adresse complète attendue, en expression régulière exacte (fin de l'URL). */
function urlDetailAttendue(reference: string, position: { numeroPage: number } | undefined): RegExp {
  return new RegExp(`${adresseDetailAttendue(reference, position).replace("?", String.raw`\?`)}$`);
}

let compte: CompteTest;
// Du plus ancien au plus récent.
let demandes: DemandeTest[] = [];

// Story 1.9 : chaque test se connecte depuis sa propre IP de test, pour que
// les échecs de connexion d'un test ne bloquent jamais les autres.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  compte = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "1.5" });
  await avecBase(async (base) => {
    await creerDemandesRemplissage(base, PREFIXE, 26);
    demandes = [
      await creerDemandeTest(base, PREFIXE, {
        objet: "Messagerie inaccessible sur mobile",
        statut: "en_cours",
        priorite: "haute",
        responsableId: compte.id,
        decalage: "2 days",
      }),
      await creerDemandeTest(base, PREFIXE, {
        objet: "Question sur la facture d'octobre",
        statut: "traitee",
        priorite: "basse",
        responsableId: compte.id,
        decalage: "2 days 1 minute",
      }),
      await creerDemandeTest(base, PREFIXE, {
        objet: "Impression impossible depuis la mise à jour",
        statut: "nouvelle",
        priorite: "normale",
        societe: null,
        decalage: "2 days 2 minutes",
      }),
    ];
  });
});

test.afterAll(async () => {
  await avecBase((base) => supprimerDemandesTest(base, PREFIXE)).catch((erreur) =>
    console.error(`Nettoyage des demandes de test impossible : ${String(erreur)}`),
  );
  if (compte) await supprimerComptesTest([compte]);
});

async function ouvrirListe(page: Page) {
  await page.goto(`/connexion?retour=${encodeURIComponent("/equipe/demandes")}`);
  await page.getByLabel("Email", { exact: true }).fill(compte.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(compte.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/equipe\/demandes$/, APRES_CONNEXION);
  await expect(page.getByRole("heading", { level: 1, name: "Demandes" })).toBeVisible();
}

function adressePage(numeroPage: number): string {
  return numeroPage === 1 ? "/equipe/demandes" : `/equipe/demandes?page=${numeroPage}`;
}

/**
 * Ouvre une page de la liste (sauf si elle est déjà affichée), puis attend
 * la fin du chargement : le titre existe aussi dans les squelettes, la
 * pagination non (toujours présente ici : au moins 26 demandes).
 */
async function ouvrirPage(page: Page, numeroPage: number) {
  const adresse = adressePage(numeroPage);
  const actuelle = new URL(page.url());
  if (actuelle.pathname + actuelle.search !== adresse) await page.goto(adresse);
  await expect(page.getByTestId("pagination-texte")).toBeVisible(NAVIGATION);
}

type Position = { rang: number; numeroPage: number };

/**
 * Base partagée : d'autres processus peuvent placer leurs demandes avant
 * celles de cette exécution. Parcourt les pages jusqu'à trouver toutes les
 * références demandées ; renvoie leur rang global et leur page.
 * `selecteur` : lignes du tableau ou cartes, selon l'affichage.
 */
async function localiser(
  page: Page,
  references: string[],
  selecteur: string,
): Promise<Map<string, Position>> {
  const trouvees = new Map<string, Position>();
  let rang = 0;
  for (let numeroPage = 1; numeroPage <= 10 && trouvees.size < references.length; numeroPage++) {
    await ouvrirPage(page, numeroPage);
    const vues = await page
      .locator(selecteur)
      .evaluateAll((elements) => elements.map((e) => e.getAttribute("data-reference")));
    for (const reference of vues) {
      if (reference && references.includes(reference) && !trouvees.has(reference)) {
        trouvees.set(reference, { rang, numeroPage });
      }
      rang++;
    }
  }
  expect([...trouvees.keys()].sort()).toEqual([...references].sort());
  return trouvees;
}

async function allerA(page: Page, position: Position | undefined) {
  await ouvrirPage(page, position!.numeroPage);
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

const texteDePagination = (page: Page) => page.getByTestId("pagination-texte");
const ligne = (page: Page, d: DemandeTest) => page.locator(`tbody tr[data-reference="${d.reference}"]`);
const carte = (page: Page, d: DemandeTest) => page.locator(`li[data-reference="${d.reference}"]`);

test.describe("liste des demandes", () => {
  test("ordinateur : tableau complet, plus récentes d'abord, badges avec le mot", async ({ page }) => {
    test.skip(test.info().project.name !== "ordinateur", "Tableau complet : ordinateur seulement.");
    await page.setViewportSize({ width: 1280, height: 900 });
    await ouvrirListe(page);

    // Menu : rubrique « Demandes » active, « Accueil » non.
    const menu = page.getByRole("navigation", { name: "Menu de l'espace équipe" });
    await expect(menu.getByRole("link", { name: "Demandes" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");

    await expect(page.getByRole("columnheader")).toHaveText([
      "Référence",
      "Date",
      "Demandeur",
      "Objet",
      "Catégorie",
      "Canal",
      "Statut",
      "Priorité",
      "Responsable",
    ]);

    // Ordre : la plus récente des trois d'abord (retrouvées par leur référence).
    const positions = await localiser(
      page,
      demandes.map((d) => d.reference),
      "tbody tr[data-reference]",
    );
    const rangs = demandes.map((d) => positions.get(d.reference)!.rang);
    expect(rangs[2]).toBeLessThan(rangs[1]);
    expect(rangs[1]).toBeLessThan(rangs[0]);

    const [enCours, traitee, nouvelle] = demandes;
    await allerA(page, positions.get(enCours.reference));
    const l1 = ligne(page, enCours);
    await expect(l1.getByRole("link", { name: enCours.reference })).toHaveAttribute(
      "href",
      // Story 1.6 : la page de la liste est transmise au détail (`?page=2`).
      adresseDetailAttendue(enCours.reference, positions.get(enCours.reference)),
    );
    await expect(l1).toContainText(enCours.nom);
    await expect(l1).toContainText("Atelier Garnier");
    await expect(l1).toContainText(enCours.objet);
    await expect(l1).toContainText("Formulaire");
    await expect(l1.locator('[data-statut="en_cours"]')).toHaveText("En cours");
    await expect(l1.locator('[data-priorite="haute"]')).toHaveText("Haute");
    await expect(l1.locator("td").last()).toHaveText(compte.nom);
    await expect(l1.locator("td").nth(1)).toHaveText(/^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/);

    await allerA(page, positions.get(traitee.reference));
    await expect(ligne(page, traitee).locator('[data-statut="traitee"]')).toHaveText("Traitée");
    await expect(ligne(page, traitee).locator('[data-priorite="basse"]')).toHaveText("Basse");
    await allerA(page, positions.get(nouvelle.reference));
    await expect(ligne(page, nouvelle).locator('[data-statut="nouvelle"]')).toHaveText("Nouvelle");
    await expect(ligne(page, nouvelle).locator('[data-priorite="normale"]')).toHaveText("Normale");
    // Sans responsable : « — ».
    await expect(ligne(page, nouvelle).locator("td").last()).toHaveText("—");

    await sansViolationAxe(page);

    // Toute la ligne ouvre le détail.
    await ligne(page, nouvelle).click();
    await expect(page).toHaveURL(urlDetailAttendue(nouvelle.reference, positions.get(nouvelle.reference)), NAVIGATION);
  });

  test("pagination : « 1–25 sur N », Suivant mène à ?page=2, Précédent revient", async ({ page }) => {
    await ouvrirListe(page);
    await expect(texteDePagination(page)).toHaveText(new RegExp(`^1–25 sur ${NOMBRE}$`));
    await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();

    // Lien réel (avec adresse) : jamais le bouton inactif d'un rendu précédent.
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    const suivant = pagination.getByRole("link", { name: "Suivant" });
    await expect(suivant).toHaveAttribute("href", "/equipe/demandes?page=2");
    await suivant.click();
    await expect(page).toHaveURL(/\/equipe\/demandes\?page=2$/, NAVIGATION);
    await expect(texteDePagination(page)).toHaveText(new RegExp(`^26–${NOMBRE} sur ${NOMBRE}$`));

    const precedent = pagination.getByRole("link", { name: "Précédent" });
    await expect(precedent).toHaveAttribute("href", "/equipe/demandes");
    await precedent.click();
    await expect(page).toHaveURL(/\/equipe\/demandes$/, NAVIGATION);
    await expect(texteDePagination(page)).toHaveText(new RegExp(`^1–25 sur ${NOMBRE}$`));
    // Première page : « Précédent » inactif.
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByText("Précédent")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("page hors bornes : ?page=abc redirige vers la page 1, ?page=99999 vers la dernière page", async ({
    page,
  }) => {
    await ouvrirListe(page);

    await page.goto("/equipe/demandes?page=abc");
    await expect(page).toHaveURL(/\/equipe\/demandes$/, NAVIGATION);
    await expect(texteDePagination(page)).toHaveText(new RegExp(`^1–25 sur ${NOMBRE}$`));

    // Au moins 2 pages (26 demandes de remplissage) : adresse canonique de la dernière.
    await page.goto("/equipe/demandes?page=99999");
    await expect(page).toHaveURL(/\/equipe\/demandes\?page=([2-9]|[1-9]\d+)$/, NAVIGATION);
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByText("Suivant")).toHaveAttribute(
      "aria-disabled",
      "true",
      NAVIGATION,
    );
  });

  test("affichage selon la largeur : cartes sur téléphone, tableau réduit sur tablette", async ({
    page,
  }) => {
    const [enCours, , nouvelle] = demandes;

    if (test.info().project.name === "telephone") {
      await ouvrirListe(page);
      const positions = await localiser(
        page,
        [enCours.reference, nouvelle.reference],
        "li[data-reference]",
      );
      await allerA(page, positions.get(enCours.reference));
      // Menu replié, une carte par demande, pas de tableau.
      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
      await expect(page.locator("table")).toBeHidden();
      const c = carte(page, enCours);
      await expect(c).toBeVisible();
      await expect(c.getByRole("link", { name: enCours.reference })).toBeVisible();
      await expect(c).toContainText(enCours.objet);
      await expect(c.locator('[data-statut="en_cours"]')).toHaveText("En cours");
      await expect(c.locator('[data-priorite="haute"]')).toHaveText("Haute");
      await expect(c).toContainText(`${enCours.nom} · Atelier Garnier`);
      await expect(c).toContainText(/\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}/);
      await sansViolationAxe(page);

      // Toute la carte ouvre le détail.
      await allerA(page, positions.get(nouvelle.reference));
      await carte(page, nouvelle).click();
      await expect(page).toHaveURL(urlDetailAttendue(nouvelle.reference, positions.get(nouvelle.reference)), NAVIGATION);
      return;
    }

    // Tablette : tableau réduit à 5 colonnes, menu replié.
    await page.setViewportSize({ width: 800, height: 1000 });
    await ouvrirListe(page);
    const positions = await localiser(page, [enCours.reference], "tbody tr[data-reference]");
    await allerA(page, positions.get(enCours.reference));
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    const entetesVisibles = page.locator("thead th:visible");
    await expect(entetesVisibles).toHaveText(["Référence", "Date", "Objet", "Statut", "Priorité"]);
    await expect(ligne(page, enCours).locator("td:visible")).toHaveCount(5);
    await expect(carte(page, enCours)).toBeHidden();
    await sansViolationAxe(page);

    // Sous 640 px : cartes.
    await page.setViewportSize({ width: 500, height: 900 });
    await expect(page.locator("table")).toBeHidden();
    await expect(carte(page, enCours)).toBeVisible();
  });
});
