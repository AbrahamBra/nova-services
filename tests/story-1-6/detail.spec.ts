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

// Story 1.6 — détail d'une demande (navigateur). Nécessite la migration
// 20261103000008 appliquée sur nova-dev.
// Base partagée : chaque processus crée ses propres demandes `TEST-1.6-…`
// (datées dans le futur pour rester en tête de liste, plus 26 anciennes pour
// qu'une page 2 existe toujours). Tout est effacé à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-1.6-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };

const DESCRIPTION = "Bonjour,\n<script>window.__piege = 1</script>\nMerci.";

let compte: CompteTest;
let complete: DemandeTest; // téléphone, société, email non envoyé (démonstration)
let minimale: DemandeTest; // sans téléphone ni société, email en échec

// Story 1.9 : chaque test se connecte depuis sa propre IP de test, pour que
// les échecs de connexion d'un test ne bloquent jamais les autres.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  compte = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "1.6" });
  await avecBase(async (base) => {
    await creerDemandesRemplissage(base, PREFIXE, 26);
    complete = await creerDemandeTest(base, PREFIXE, {
      objet: "Impression impossible depuis la mise à jour",
      statut: "en_cours",
      priorite: "haute",
      responsableId: compte.id,
      decalage: "3 days",
    });
    minimale = await creerDemandeTest(base, PREFIXE, {
      objet: "Question sur la facture",
      societe: null,
      decalage: "3 days 1 minute",
    });
    await base.query(
      `update public.demandes
          set telephone = '06 12 34 56 78', description = $2, etat_email = 'non_envoye_demo'
        where id = $1`,
      [complete.id, DESCRIPTION],
    );
    await base.query("update public.demandes set etat_email = 'echec' where id = $1", [minimale.id]);
    await base.query(
      `insert into public.historique
         (demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le)
       values ($1, 'membre', $2, 'changement_priorite', 'normale', 'haute', now() + interval '3 days 5 minutes')`,
      [complete.id, compte.id],
    );
  });
});

test.afterAll(async () => {
  // Demandes d'abord (l'historique cite le compte) ; si leur nettoyage
  // échoue, le compte est gardé plutôt que laissé à moitié supprimé.
  let demandesNettoyees = false;
  try {
    await avecBase((base) => supprimerDemandesTest(base, PREFIXE));
    demandesNettoyees = true;
  } catch (erreur) {
    console.error(`Nettoyage des demandes de test impossible : ${String(erreur)}`);
  } finally {
    if (compte && demandesNettoyees) await supprimerComptesTest([compte]);
  }
});

async function seConnecter(page: Page, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(compte.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(compte.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(new RegExp(`${retour.replace(/[?]/g, "\\?")}$`), APRES_CONNEXION);
}

/** Attend la fin du chargement du détail (l'en-tête n'existe pas dans le squelette). */
async function attendreDetail(page: Page, d: DemandeTest) {
  await expect(page.getByRole("heading", { level: 1, name: d.objet })).toBeVisible(NAVIGATION);
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

test.describe("détail d'une demande", () => {
  test("contenu complet, bandeau démonstration, historique, retour", async ({ page }) => {
    // Adresse directe : la base partagée peut repousser la ligne en page 2
    // (le clic sur une ligne est couvert par la story 1.5).
    await seConnecter(page, `/equipe/demandes/${complete.reference}`);
    await attendreDetail(page, complete);
    await expect(page).toHaveTitle(`${complete.reference} — Nova Services`);

    // Menu : rubrique « Demandes » active (ouvert sur téléphone).
    if (test.info().project.name === "telephone") {
      await page.getByRole("button", { name: "Menu" }).click();
    }
    const menu = page.getByRole("navigation", { name: "Menu de l'espace équipe" });
    await expect(menu.getByRole("link", { name: "Demandes" })).toHaveAttribute("aria-current", "page");
    if (test.info().project.name === "telephone") {
      await page.keyboard.press("Escape");
    }

    const principal = page.getByRole("main");
    await expect(principal.getByText(complete.reference, { exact: true })).toBeVisible();
    await expect(principal.locator('header [data-statut="en_cours"]')).toHaveText("En cours");
    await expect(principal.locator('header [data-priorite="haute"]')).toHaveText("Haute");
    await expect(principal).toContainText(/Reçue le \d{2}\/\d{2}\/\d{4} à \d{2}:\d{2} via Formulaire/);

    // Description telle que saisie : script affiché, jamais exécuté.
    const description = page.getByTestId("description");
    await expect(description).toHaveText(DESCRIPTION, { useInnerText: true });
    expect(await page.evaluate(() => (window as unknown as { __piege?: number }).__piege)).toBeUndefined();

    // Demandeur.
    await expect(principal).toContainText(complete.nom);
    await expect(principal).toContainText("Atelier Garnier");
    await expect(page.getByRole("link", { name: "sophie.garnier@example.com" })).toHaveAttribute(
      "href",
      "mailto:sophie.garnier@example.com",
    );
    await expect(page.getByRole("link", { name: "06 12 34 56 78" })).toHaveAttribute("href", "tel:0612345678");
    await expect(page.getByTestId("bandeau-email")).toHaveText("Email non envoyé (mode démonstration)");

    // Historique, du plus ancien au plus récent.
    const historique = page.getByTestId("historique").locator("li");
    await expect(historique).toHaveCount(2);
    await expect(historique.nth(0)).toContainText("Demandeur (formulaire) a créé la demande");
    await expect(historique.nth(0)).toContainText(/\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}/);
    await expect(historique.nth(1)).toContainText(`${compte.nom} a changé la priorité : Normale → Haute`);

    // Colonne d'information.
    const infos = page.getByRole("complementary", { name: "Informations" });
    await expect(infos).toContainText(compte.nom);
    await expect(infos.locator('[data-statut="en_cours"]')).toHaveText("En cours");

    await sansViolationAxe(page);

    await page.getByRole("link", { name: "← Retour aux demandes" }).click();
    await expect(page).toHaveURL(/\/equipe\/demandes$/, NAVIGATION);
  });

  test("sans téléphone ni société, email en échec", async ({ page }) => {
    await seConnecter(page, `/equipe/demandes/${minimale.reference}`);
    await attendreDetail(page, minimale);
    const principal = page.getByRole("main");
    await expect(principal).toContainText("Non renseigné");
    await expect(principal.getByText("Société", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("bandeau-email")).toHaveText("Email de confirmation non envoyé");
    const infos = page.getByRole("complementary", { name: "Informations" });
    await expect(infos).toContainText("Aucun");
  });

  test("retour : venu de ?page=2, « ← Retour aux demandes » ramène à ?page=2", async ({ page }) => {
    await seConnecter(page, `/equipe/demandes/${complete.reference}?page=2`);
    await attendreDetail(page, complete);
    const retour = page.getByRole("link", { name: "← Retour aux demandes" });
    await expect(retour).toHaveAttribute("href", "/equipe/demandes?page=2");
    await retour.click();
    await expect(page).toHaveURL(/\/equipe\/demandes\?page=2$/, NAVIGATION);
    await expect(page.getByTestId("pagination-texte")).toHaveText(/^26–/, NAVIGATION);
  });

  test("référence inconnue ou mal formée : « Demande introuvable. »", async ({ page }) => {
    await seConnecter(page, "/equipe/demandes/NOVA-2026-999999");
    await expect(page.getByRole("heading", { level: 1, name: "Demande introuvable." })).toBeVisible(
      NAVIGATION,
    );
    await expect(page.getByRole("main").getByRole("link", { name: "Retour aux demandes" })).toHaveAttribute(
      "href",
      "/equipe/demandes",
    );
    await sansViolationAxe(page);

    const reponse = await page.goto("/equipe/demandes/abc");
    expect(reponse?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { level: 1, name: "Demande introuvable." })).toBeVisible(
      NAVIGATION,
    );
  });

  test("mise en page : deux colonnes sur ordinateur, une sur téléphone, sans défilement horizontal", async ({
    page,
  }) => {
    const telephone = test.info().project.name === "telephone";
    if (!telephone) await page.setViewportSize({ width: 1440, height: 900 });
    await seConnecter(page, `/equipe/demandes/${complete.reference}`);
    await attendreDetail(page, complete);

    const description = await page.getByTestId("description").boundingBox();
    const infos = await page.getByRole("complementary", { name: "Informations" }).boundingBox();
    expect(description && infos).toBeTruthy();
    if (telephone) {
      // Une colonne : les informations sous le contenu principal.
      expect(infos!.y).toBeGreaterThan(description!.y + description!.height);
    } else {
      // Deux colonnes : les informations à droite, à la même hauteur.
      expect(infos!.x).toBeGreaterThan(description!.x + description!.width);
      expect(Math.abs(infos!.y - description!.y)).toBeLessThan(80);
    }
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(debordement).toBeLessThanOrEqual(0);
    await sansViolationAxe(page);
  });

  test("liste à 1 440 px : aucune colonne ne déborde (Responsable visible)", async ({ page }) => {
    test.skip(test.info().project.name !== "ordinateur", "Tableau complet : ordinateur seulement.");
    await page.setViewportSize({ width: 1440, height: 900 });
    await seConnecter(page, "/equipe/demandes");
    await expect(page.getByTestId("pagination-texte")).toBeVisible(NAVIGATION);
    // Menu latéral ouvert (240 px), comme dans le constat de la story 1.5.
    await expect(page.getByRole("navigation", { name: "Menu de l'espace équipe" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Responsable" })).toBeVisible();

    // Tout élément qui défile horizontalement : la page et chaque ancêtre du
    // tableau (dont le conteneur `overflow-x-auto`), jusqu'à la racine.
    const ecarts = await page.locator("table").evaluate((table) => {
      const mesures: Record<string, number> = {};
      const racine = document.documentElement;
      mesures.page = racine.scrollWidth - racine.clientWidth;
      let e: HTMLElement | null = table.parentElement;
      for (let i = 0; e && e !== racine; e = e.parentElement, i++) {
        const style = getComputedStyle(e);
        if (["auto", "scroll"].includes(style.overflowX) || e === table.parentElement) {
          mesures[`${e.tagName.toLowerCase()}#${i}`] = e.scrollWidth - e.clientWidth;
        }
      }
      return mesures;
    });
    expect(Object.keys(ecarts).length).toBeGreaterThan(1);
    for (const [element, ecart] of Object.entries(ecarts)) {
      expect(ecart, element).toBeLessThanOrEqual(0);
    }
    // La dernière colonne finit dans la zone visible.
    const derniere = await page.getByRole("columnheader", { name: "Responsable" }).boundingBox();
    expect(derniere!.x + derniere!.width).toBeLessThanOrEqual(1440);
  });
});
