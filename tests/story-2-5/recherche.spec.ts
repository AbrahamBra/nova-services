import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";

// Story 2.5 — recherche et filtres (navigateur). Nécessite la migration
// 20261103000018 appliquée sur nova-dev.
// Critères 1 à 4 d'epics.md : référence complète et « dupont » ; « Non
// traitées » + « Haute » dans l'adresse ; aucun résultat avec « Effacer les
// filtres » ; filtres conservés après l'ouverture d'une demande. Recherche
// lancée 300 ms après la dernière frappe ; retour arrière du navigateur ;
// contrôle axe. Ordinateur et téléphone.
// Base partagée : demandes `TEST-2.5-…` datées dans le futur (en tête de
// liste), vérifiées par leur référence, jamais par un nombre exact.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.5-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const CHEMIN = "/equipe/demandes";

let karim: CompteTest;
let dupont: DemandeTest; // Nouvelle, Haute
let dupontAidi: DemandeTest; // En cours, Haute
let traitee: DemandeTest; // Traitée, Haute
let basse: DemandeTest; // Nouvelle, Basse

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.5" });
  await avecBase(async (base) => {
    const minutes = Math.floor(Math.random() * 1000);
    const creer = (decalage: number, options: Parameters<typeof creerDemandeTest>[2]) =>
      creerDemandeTest(base, PREFIXE, { decalage: `5 days ${minutes + decalage} minutes`, ...options });
    dupont = await creer(0, {
      nomDemandeur: "Jean Dupont",
      objet: "Impression impossible depuis la mise à jour",
      statut: "nouvelle",
      priorite: "haute",
    });
    dupontAidi = await creer(1, {
      nomDemandeur: "Samira Dupont-Aïdi",
      objet: "Messagerie inaccessible sur mobile",
      statut: "en_cours",
      priorite: "haute",
      responsableId: karim.id,
    });
    traitee = await creer(2, {
      objet: "Facture de septembre incomplète",
      statut: "traitee",
      priorite: "haute",
      responsableId: karim.id,
    });
    basse = await creer(3, { objet: "Tarifs pour un site vitrine", statut: "nouvelle", priorite: "basse" });
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
    if (nettoyees && karim) await supprimerComptesTest([karim]);
  }
});

// Story 1.9 : chaque contexte se connecte depuis sa propre IP de test.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function ouvrirListe(page: Page) {
  await page.goto(`/connexion?retour=${encodeURIComponent(CHEMIN)}`);
  await page.getByLabel("Email", { exact: true }).fill(karim.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(karim.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/equipe\/demandes$/, APRES_CONNEXION);
  await expect(page.getByRole("search", { name: "Rechercher et filtrer les demandes" })).toBeVisible(
    NAVIGATION,
  );
}

const estTelephone = () => test.info().project.name === "telephone";

/** Ligne (ordinateur) ou carte (téléphone) d'une demande. */
function element(page: Page, d: DemandeTest) {
  return page.locator(
    estTelephone() ? `li[data-reference="${d.reference}"]` : `tbody tr[data-reference="${d.reference}"]`,
  );
}

const recherche = (page: Page) => page.getByLabel("Rechercher", { exact: true });
const liste = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });

/** Adresse actuelle (chemin et paramètres). */
function adresse(page: Page): string {
  const url = new URL(page.url());
  return url.pathname + url.search;
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

test.describe("recherche et filtres", () => {
  test("critère 1 : référence complète, puis « dupont » (Dupont et Dupont-Aïdi), après 300 ms", async ({
    page,
  }) => {
    await ouvrirListe(page);

    // Référence complète : seule cette demande.
    await recherche(page).fill(dupont.reference);
    // Pas encore lancée : la recherche attend 300 ms sans frappe.
    expect(adresse(page)).toBe(CHEMIN);
    await expect(page).toHaveURL(new RegExp(`\\?q=${dupont.reference}$`), NAVIGATION);
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
    await expect(page.locator(estTelephone() ? "li[data-reference]" : "tbody tr[data-reference]")).toHaveCount(1);
    await expect(page.getByText("1 demande", { exact: true })).toBeVisible();

    // Frappe continue : une seule recherche, lancée après la dernière touche.
    await recherche(page).fill("");
    await recherche(page).pressSequentially("dupont", { delay: 60 });
    await expect(page).toHaveURL(/\?q=dupont$/, NAVIGATION);
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
    await expect(element(page, dupontAidi)).toBeVisible();
    await expect(element(page, basse)).toHaveCount(0);
    await expect(recherche(page)).toHaveValue("dupont");
    await expect(page.getByRole("button", { name: "Effacer les filtres" })).toBeVisible();

    // Sans majuscules ni accents.
    await recherche(page).fill("AÏDI");
    await recherche(page).press("Enter");
    await expect(page).toHaveURL(/\?q=A%C3%8FDI$/, NAVIGATION);
    await expect(element(page, dupontAidi)).toBeVisible(NAVIGATION);
    await expect(element(page, dupont)).toHaveCount(0);

    await sansViolationAxe(page);
  });

  test("frappe continue : une seule lecture, sans entrée d'historique ; Entrée puis retour arrière", async ({
    page,
  }) => {
    await ouvrirListe(page);

    // Lectures de la liste demandées au serveur (navigations côté navigateur).
    const recherches: (string | null)[] = [];
    page.on("request", (requete) => {
      const url = new URL(requete.url());
      const rsc = requete.headers()["rsc"] === "1" || url.searchParams.has("_rsc");
      if (url.pathname === CHEMIN && rsc) recherches.push(url.searchParams.get("q"));
    });
    const historiqueAvant = await page.evaluate(() => history.length);

    await recherche(page).pressSequentially("dupont", { delay: 80 });
    await expect(page).toHaveURL(/\?q=dupont$/, NAVIGATION);
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
    // Une seule recherche, pour le texte complet (aucune pour « d », « du »…).
    expect(recherches.filter((q) => q !== null)).toEqual(["dupont"]);
    // Recherche après la pause : `replace`, pas d'entrée d'historique.
    expect(await page.evaluate(() => history.length)).toBe(historiqueAvant);

    // Entrée : nouvelle entrée d'historique ; le retour arrière y revient.
    await recherche(page).fill("aidi");
    await recherche(page).press("Enter");
    await expect(page).toHaveURL(/\?q=aidi$/, NAVIGATION);
    await expect(element(page, dupont)).toHaveCount(0, NAVIGATION);
    await page.goBack();
    await expect(page).toHaveURL(/\?q=dupont$/, NAVIGATION);
    await expect(recherche(page)).toHaveValue("dupont", NAVIGATION);
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
    // Aucune recherche en attente ne refait la navigation annulée.
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/\?q=dupont$/);
  });

  test("recherche puis liste : le texte part avec le filtre, avant ou après les 300 ms", async ({ page }) => {
    await ouvrirListe(page);

    // Avant les 300 ms : la liste emporte le texte tapé, sans seconde navigation.
    await recherche(page).fill("dupont");
    await liste(page, "Statut").selectOption({ label: "Non traitées" });
    await expect(page).toHaveURL(/\?q=dupont&statut=non_traitees$/, NAVIGATION);
    await expect(recherche(page)).toHaveValue("dupont");
    await expect(element(page, dupontAidi)).toBeVisible(NAVIGATION);
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/\?q=dupont&statut=non_traitees$/);
    await expect(recherche(page)).toHaveValue("dupont");

    // Après les 300 ms.
    await page.getByRole("button", { name: "Effacer les filtres" }).click();
    await expect(page).toHaveURL(/\/equipe\/demandes$/, NAVIGATION);
    await recherche(page).fill("dupont");
    await expect(page).toHaveURL(/\?q=dupont$/, NAVIGATION);
    await liste(page, "Statut").selectOption({ label: "Non traitées" });
    await expect(page).toHaveURL(/\?q=dupont&statut=non_traitees$/, NAVIGATION);
    await expect(recherche(page)).toHaveValue("dupont");
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
    await expect(page.getByTestId("resultats")).not.toHaveAttribute("aria-busy", "true", NAVIGATION);
  });

  test("critère 2 : « Non traitées » et « Haute », dans l'adresse ; retour arrière", async ({ page }) => {
    await ouvrirListe(page);

    await liste(page, "Statut").selectOption({ label: "Non traitées" });
    await expect(page).toHaveURL(/\?statut=non_traitees$/, NAVIGATION);
    await expect(element(page, basse)).toBeVisible(NAVIGATION);

    await liste(page, "Priorité").selectOption({ label: "Haute" });
    await expect(page).toHaveURL(/\?statut=non_traitees&priorite=haute$/, NAVIGATION);
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
    await expect(element(page, dupontAidi)).toBeVisible();
    await expect(element(page, traitee)).toHaveCount(0);
    await expect(element(page, basse)).toHaveCount(0);
    await expect(liste(page, "Statut")).toHaveValue("non_traitees");
    await expect(liste(page, "Priorité")).toHaveValue("haute");

    // Responsable : « Mes demandes » (Karim est responsable de Dupont-Aïdi).
    await liste(page, "Responsable").selectOption({ label: "Mes demandes" });
    await expect(page).toHaveURL(/\?statut=non_traitees&priorite=haute&responsable=moi$/, NAVIGATION);
    await expect(element(page, dupontAidi)).toBeVisible(NAVIGATION);
    await expect(element(page, dupont)).toHaveCount(0);

    // Retour arrière du navigateur : filtres précédents, listes à jour.
    await page.goBack();
    await expect(page).toHaveURL(/\?statut=non_traitees&priorite=haute$/, NAVIGATION);
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
    await expect(liste(page, "Responsable")).toHaveValue("");
    await page.goBack();
    await expect(page).toHaveURL(/\?statut=non_traitees$/, NAVIGATION);
    await expect(liste(page, "Priorité")).toHaveValue("", NAVIGATION);
    await expect(element(page, basse)).toBeVisible(NAVIGATION);

    await sansViolationAxe(page);
  });

  test("critère 3 : aucun résultat, « Effacer les filtres »", async ({ page }) => {
    await ouvrirListe(page);
    const introuvable = `introuvable-${randomUUID().slice(0, 8)}`;
    await recherche(page).fill(introuvable);
    await recherche(page).press("Enter");
    await expect(page).toHaveURL(new RegExp(`\\?q=${introuvable}$`), NAVIGATION);
    const etat = page.getByRole("status").filter({ hasText: "Aucune demande ne correspond à ces filtres." });
    await expect(etat).toBeVisible(NAVIGATION);
    await expect(page.locator("table")).toHaveCount(0);
    await sansViolationAxe(page);

    await etat.getByRole("link", { name: "Effacer les filtres" }).click();
    await expect(page).toHaveURL(/\/equipe\/demandes$/, NAVIGATION);
    await expect(recherche(page)).toHaveValue("", NAVIGATION);
    await expect(page.getByRole("button", { name: "Effacer les filtres" })).toHaveCount(0);
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
  });

  test("critère 4 : ouvrir une demande puis revenir garde les filtres", async ({ page }) => {
    // Trois pages (liste, détail, liste) : plus long que les autres tests,
    // surtout quand le serveur de développement compile le détail.
    test.setTimeout(60_000);
    await ouvrirListe(page);
    await page.goto(`${CHEMIN}?q=dupont&statut=non_traitees&priorite=haute`);
    await expect(element(page, dupontAidi)).toBeVisible(NAVIGATION);
    await expect(recherche(page)).toHaveValue("dupont");

    await element(page, dupontAidi).getByRole("link", { name: dupontAidi.reference }).click();
    await expect(page).toHaveURL(
      new RegExp(`/equipe/demandes/${dupontAidi.reference}\\?q=dupont&statut=non_traitees&priorite=haute$`),
      NAVIGATION,
    );
    await page.getByRole("link", { name: "← Retour aux demandes" }).click();
    await expect(page).toHaveURL(/\/equipe\/demandes\?q=dupont&statut=non_traitees&priorite=haute$/, NAVIGATION);
    await expect(recherche(page)).toHaveValue("dupont");
    await expect(liste(page, "Statut")).toHaveValue("non_traitees");
    await expect(liste(page, "Priorité")).toHaveValue("haute");
    await expect(element(page, dupontAidi)).toBeVisible(NAVIGATION);

    // « Effacer les filtres » de la barre : tout est retiré, focus sur la recherche.
    await page.getByRole("button", { name: "Effacer les filtres" }).click();
    await expect(page).toHaveURL(/\/equipe\/demandes$/, NAVIGATION);
    await expect(recherche(page)).toBeFocused();
    await expect(liste(page, "Statut")).toHaveValue("");
  });

  test("valeur invalide de l'adresse ignorée, sans erreur", async ({ page }) => {
    await ouvrirListe(page);
    await page.goto(`${CHEMIN}?statut=fermee&categorie=abc&page=-1&priorite=haute`);
    await expect(page).toHaveURL(/\/equipe\/demandes\?priorite=haute$/, NAVIGATION);
    await expect(liste(page, "Statut")).toHaveValue("");
    await expect(liste(page, "Priorité")).toHaveValue("haute");
    await expect(element(page, dupont)).toBeVisible(NAVIGATION);
  });
});
