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

// Story 5.4 — page Données personnelles (navigateur), ordinateur et
// téléphone. Critère 1 : la recherche par email (majuscules et espaces
// compris) montre les 3 demandes de la personne, et l'email n'apparaît
// jamais dans l'adresse. Critère 2 : après « Effacer ces 3 demandes » et
// confirmation, elles ne sont plus ni dans la liste ni dans la recherche.
// Critère 3 : le journal montre « 3 demandes effacées (droit à
// l'effacement) » au nom de l'administratrice, sans l'email. Aussi : email
// mal écrit, aucune demande, liste changée entre-temps, collaborateur refusé,
// axe sur chaque écran.
// Jamais les données d'essai (jean.dupont@example.com) : chaque test a son
// email `test-5-4-<code>@example.com` et ses demandes `TEST-5.4-…` ; les
// références inscrites dans `effacements`, les demandes, le journal et les
// comptes sont effacés à la fin.
// Nécessite la migration 20261103000033 appliquée sur nova-dev.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const CHEMIN = "/equipe/admin/donnees";

const comptes: CompteTest[] = [];
const prefixes: string[] = [];
const references: string[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  await avecBase(async (base) => {
    try {
      await base.query("delete from public.effacements where reference = any($1::text[])", [references]);
    } finally {
      for (const prefixe of prefixes) await supprimerDemandesTest(base, prefixe);
    }
  }).catch((erreur) => console.error(`Nettoyage des demandes impossible : ${String(erreur)}`));
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.4", ...options });
  comptes.push(c);
  return c;
}

/** Email et préfixe propres au test. */
function demandeur() {
  const code = randomUUID().slice(0, 8);
  const prefixe = `TEST-5.4-${code}`;
  prefixes.push(prefixe);
  return { email: `test-5-4-${code}@example.com`, prefixe };
}

/** `nombre` demandes de cet email, de la plus ancienne à la plus récente ; une note sur la première. */
async function demandesDe(
  prefixe: string,
  email: string,
  nombre: number,
  auteurNote?: CompteTest,
): Promise<DemandeTest[]> {
  return avecBase(async (base) => {
    const creees: DemandeTest[] = [];
    for (let i = 0; i < nombre; i++) {
      const d = await creerDemandeTest(base, prefixe, {
        email,
        objet: `Demande ${prefixe.slice(-4)} n° ${i + 1}`,
        decalage: `-${nombre - i} days`,
      });
      references.push(d.reference);
      creees.push(d);
    }
    if (auteurNote && creees.length > 0) {
      await base.query(
        "insert into public.notes (demande_id, auteur_id, texte) values ($1, $2, 'Note de test 5.4')",
        [creees[0].id, auteurNote.id],
      );
    }
    return creees;
  });
}

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(new RegExp(`${retour.replaceAll("/", "\\/").replace("?", "\\?")}$`), APRES_CONNEXION);
}

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu de l'espace équipe" });
const boutonMenu = (page: Page) => page.getByRole("button", { name: "Menu" });
const toast = (page: Page, texte: string) => page.getByTestId("toast").filter({ hasText: texte });
const champEmail = (page: Page) => page.getByLabel("Email du demandeur", { exact: true });
const rechercher = (page: Page) => page.getByRole("button", { name: "Rechercher", exact: true });
const fenetre = (page: Page) => page.getByRole("alertdialog");
/** Demande trouvée (ligne du tableau ou carte, celle qui est affichée). */
const trouvee = (page: Page, reference: string) => page.locator(`[data-reference="${reference}"]:visible`);

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Rang de chaque demande affichée, dans l'ordre de la page. */
async function rangs(page: Page): Promise<string[]> {
  return page
    .locator("[data-reference]:visible")
    .evaluateAll((elements) => elements.map((e) => e.getAttribute("data-reference") ?? ""));
}

/** L'adresse de la page, sans paramètre ni email. */
function adresseSansEmail(page: Page, email: string) {
  const adresse = new URL(page.url());
  expect(adresse.pathname).toBe(CHEMIN);
  expect(adresse.search).toBe("");
  expect(decodeURIComponent(page.url()).toLowerCase()).not.toContain(email.split("@")[0]);
}

test.describe("story 5.4 — droit à l'effacement", () => {
  test("critères 1 à 3 : recherche sans email dans l'adresse, effacement confirmé, journal", async ({ page }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const { email, prefixe } = demandeur();
    const demandes = await demandesDe(prefixe, email, 3, admin);
    const refs = demandes.map((d) => d.reference);

    // Entrée « Données » entre « Paramètres » et « Journal ».
    await seConnecter(page, admin, "/equipe/admin/parametres");
    await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible(NAVIGATION);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    const libelles = await menu(page).getByRole("link").allTextContents();
    expect(libelles.indexOf("Données")).toBe(libelles.indexOf("Paramètres") + 1);
    expect(libelles.indexOf("Journal")).toBe(libelles.indexOf("Données") + 1);
    await menu(page).getByRole("link", { name: "Données" }).click();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`), NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: "Données personnelles" })).toBeVisible(NAVIGATION);
    await expect(page.getByRole("heading", { level: 2, name: "Droit à l'effacement" })).toBeVisible();
    await expect(page).toHaveTitle("Données personnelles — Nova Services");
    await sansViolationAxe(page);

    // Email mal écrit : message sous le champ, focus, aucune recherche.
    await champEmail(page).fill("jean@dupont");
    await rechercher(page).click();
    await expect(page.getByText("Cette adresse email ne semble pas valide.", { exact: true })).toBeVisible();
    await expect(champEmail(page)).toHaveAttribute("aria-invalid", "true");
    await expect(champEmail(page)).toBeFocused();
    await expect(champEmail(page)).toHaveValue("jean@dupont");
    await expect(page.getByText("Aucune demande avec cet email.")).toHaveCount(0);
    adresseSansEmail(page, "jean@dupont");
    await sansViolationAxe(page);

    // Aucune demande.
    await champEmail(page).fill(`aucune-${email}`);
    await expect(page.getByText("Cette adresse email ne semble pas valide.", { exact: true })).toHaveCount(0);
    await rechercher(page).click();
    await expect(page.getByText("Aucune demande avec cet email.", { exact: true })).toBeVisible(NAVIGATION);
    await expect(page.getByRole("button", { name: /^Effacer/ })).toHaveCount(0);

    // Critère 1 : majuscules et espaces compris, ses 3 demandes, plus récente
    // en haut ; l'adresse reste sans email.
    await champEmail(page).fill(`  ${email.toUpperCase()} `);
    await page.keyboard.press("Enter");
    await expect(trouvee(page, refs[2])).toBeVisible(NAVIGATION);
    expect(await rangs(page)).toEqual([...refs].reverse());
    await expect(trouvee(page, refs[0])).toContainText(demandes[0].objet);
    await expect(trouvee(page, refs[0])).toContainText("Nouvelle");
    await expect(trouvee(page, refs[0]).getByRole("link", { name: refs[0] })).toHaveAttribute(
      "href",
      `/equipe/demandes/${refs[0]}`,
    );
    adresseSansEmail(page, email);
    await sansViolationAxe(page);

    // Fenêtre : texte précis, « Annuler » sélectionné ; Annuler ne change rien.
    await page.getByRole("button", { name: "Effacer ces 3 demandes" }).click();
    await expect(fenetre(page)).toBeVisible();
    await expect(fenetre(page)).toContainText(
      `3 demandes de ${email} vont être effacées définitivement, avec leur historique et leurs notes. Cette action ne peut pas être annulée.`,
    );
    await expect(fenetre(page).getByRole("button", { name: "Annuler" })).toBeFocused();
    await sansViolationAxe(page);
    await fenetre(page).getByRole("button", { name: "Annuler" }).click();
    await expect(fenetre(page)).toHaveCount(0);
    await expect(trouvee(page, refs[0])).toBeVisible();

    // Critère 2 : confirmé.
    await page.getByRole("button", { name: "Effacer ces 3 demandes" }).click();
    await fenetre(page).getByRole("button", { name: "Effacer ces 3 demandes" }).click();
    await expect(toast(page, "3 demandes effacées.")).toBeVisible(NAVIGATION);
    await expect(page.locator("[data-reference]:visible")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Effacer/ })).toHaveCount(0);
    adresseSansEmail(page, email);

    const enBase = await avecBase(async (base) => {
      const { rows: restantes } = await base.query(
        "select 1 from public.demandes where reference = any($1::text[])",
        [refs],
      );
      const { rows: registre } = await base.query(
        "select 1 from public.effacements where reference = any($1::text[])",
        [refs],
      );
      const { rows: notes } = await base.query(
        "select 1 from public.notes where demande_id = any($1::uuid[])",
        [demandes.map((d) => d.id)],
      );
      const { rows: journal } = await base.query<{ id: string }>(
        `select id from public.journal
          where auteur_id = $1 and details ->> 'evenement' = 'demandeur_efface'`,
        [admin.id],
      );
      return { restantes: restantes.length, registre: registre.length, notes: notes.length, journal };
    });
    expect(enBase).toMatchObject({ restantes: 0, registre: 3, notes: 0 });
    expect(enBase.journal).toHaveLength(1);

    // Plus dans la recherche de l'écran Données…
    await rechercher(page).click();
    await expect(page.getByText("Aucune demande avec cet email.", { exact: true })).toBeVisible(NAVIGATION);

    // … ni dans la liste ni dans la recherche des demandes.
    await page.goto("/equipe/demandes");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(NAVIGATION);
    for (const reference of refs) await expect(trouvee(page, reference)).toHaveCount(0);
    for (const recherche of [prefixe, refs[0]]) {
      await page.goto(`/equipe/demandes?q=${encodeURIComponent(recherche)}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(NAVIGATION);
      for (const reference of refs) await expect(trouvee(page, reference)).toHaveCount(0);
    }
    // Le détail d'une demande effacée : introuvable.
    await page.goto(`/equipe/demandes/${refs[0]}`);
    await expect(page.getByText(/introuvable/i).first()).toBeVisible(NAVIGATION);

    // Critère 3 : journal, au nom de l'administratrice, sans l'email.
    await page.goto("/equipe/admin/journal?type=donnees");
    const ligne = page.locator(`[data-journal="${enBase.journal[0].id}"]:visible`);
    await expect(ligne).toContainText("3 demandes effacées (droit à l'effacement)", NAVIGATION);
    await expect(ligne).toContainText(admin.nom);
    await expect(ligne).toContainText("Données");
    await expect(ligne).not.toContainText(email);
    await expect(page.getByText(email)).toHaveCount(0);
    await sansViolationAxe(page);
  });

  test("liste changée depuis la recherche : rien n'est effacé, nouvelle recherche proposée", async ({ page }) => {
    const admin = await compte({ role: "administrateur", prenom: "Hugo" });
    const { email, prefixe } = demandeur();
    const [premiere] = await demandesDe(prefixe, email, 1);

    await seConnecter(page, admin, CHEMIN);
    await champEmail(page).fill(email);
    await rechercher(page).click();
    await expect(trouvee(page, premiere.reference)).toBeVisible(NAVIGATION);
    await expect(page.getByRole("button", { name: "Effacer cette demande" })).toBeVisible();

    // Une nouvelle demande arrive entre-temps.
    const [nouvelle] = await demandesDe(prefixe, email, 1);

    await page.getByRole("button", { name: "Effacer cette demande" }).click();
    await expect(fenetre(page)).toContainText(
      `1 demande de ${email} va être effacée définitivement, avec son historique et ses notes.`,
    );
    await fenetre(page).getByRole("button", { name: "Effacer cette demande" }).click();
    const bandeau = page.getByRole("alert").filter({ hasText: "La liste a changé depuis votre recherche." });
    await expect(bandeau).toContainText(
      "La liste a changé depuis votre recherche. Vérifiez-la avant d'effacer.",
      NAVIGATION,
    );
    await expect(fenetre(page)).toHaveCount(0);
    // Le bandeau seul (pas de toast), avec le focus ; « Effacer » désactivé
    // jusqu'à une nouvelle recherche.
    await expect(bandeau).toBeFocused();
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Effacer cette demande" })).toBeDisabled();
    const restantes = await avecBase(async (base) => {
      const { rows } = await base.query(
        "select 1 from public.demandes where reference = any($1::text[])",
        [[premiere.reference, nouvelle.reference]],
      );
      return rows.length;
    });
    expect(restantes).toBe(2);
    await sansViolationAxe(page);

    // Relancée avec l'email de la recherche, remis dans le champ.
    await champEmail(page).fill("autre@example.com");
    await bandeau.getByRole("button", { name: "Relancer la recherche" }).click();
    await expect(champEmail(page)).toHaveValue(email);
    await expect(trouvee(page, nouvelle.reference)).toBeVisible(NAVIGATION);
    await expect(trouvee(page, premiere.reference)).toBeVisible();
    await expect(page.getByRole("button", { name: "Effacer ces 2 demandes" })).toBeVisible();
    await expect(bandeau).toHaveCount(0);
  });

  test("un collaborateur qui tape l'adresse est refusé", async ({ page }) => {
    const collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
    await seConnecter(page, collaborateur, CHEMIN);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vous n'avez pas accès à cette page.");
    await expect(page).toHaveTitle("Accès refusé — Nova Services");
    await expect(champEmail(page)).toHaveCount(0);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    await expect(menu(page).getByRole("link", { name: "Données" })).toHaveCount(0);
    await sansViolationAxe(page);
  });
});
