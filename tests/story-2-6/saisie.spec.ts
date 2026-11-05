import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { supprimerDemandesTest } from "../outils/demandes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 2.6 — saisie interne (navigateur). Nécessite la migration
// 20261103000020 appliquée sur nova-dev.
// Critères 1 à 4 d'epics.md : « Saisir une demande » dans le menu et en haut
// de la liste, canal en premier, rappel sans case de consentement ; saisie
// par téléphone → toast et détail (canal Téléphone, état `sans_email`) ;
// historique « Saisie par [nom] (téléphone) » ; ni email ni téléphone →
// message sous Email. Et : canal non choisi, accès sans connexion, axe.
// Ordinateur et téléphone. Base partagée : compte et demandes `TEST-2.6-…`,
// effacés à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.6-${randomUUID().slice(0, 8)}`;
const CHEMIN = "/equipe/demandes/nouvelle";
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };

let nadia: CompteTest;
let categorie: { id: string; nom: string };

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  nadia = await creerCompteTest({ prenom: "Nadia", etiquette: "2.6" });
  categorie = await avecBase(async (base) => {
    const { rows } = await base.query<{ id: string; nom: string }>(
      "select id, nom from public.categories where actif order by ordre, nom limit 1",
    );
    if (rows.length === 0) throw new Error("Une catégorie active est nécessaire à ces tests.");
    return rows[0];
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
    if (demandesNettoyees && nadia) await supprimerComptesTest([nadia]);
  }
});

// Story 1.9 : chaque contexte se connecte depuis sa propre IP de test.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function seConnecter(page: Page, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(nadia.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(nadia.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(new RegExp(`${retour}$`), APRES_CONNEXION);
}

async function ouvrirSaisie(page: Page) {
  await seConnecter(page, CHEMIN);
  await expect(page.getByRole("heading", { level: 1, name: "Saisir une demande" })).toBeVisible(
    NAVIGATION,
  );
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

const radio = (page: Page, nom: "Téléphone" | "Email") =>
  page.getByRole("radiogroup", { name: "Canal" }).getByRole("radio", { name: nom });
const champEmail = (page: Page) => page.getByRole("textbox", { name: /^Email/ });
const champTelephone = (page: Page) => page.getByRole("textbox", { name: /^Téléphone/ });

/** Remplit la demande (sans canal ni coordonnées). */
async function remplirDemande(page: Page, nom: string, objet: string) {
  await page.getByLabel("Nom et prénom", { exact: true }).fill(nom);
  await page.getByLabel("Catégorie", { exact: true }).selectOption(categorie.id);
  await page.getByLabel("Objet", { exact: true }).fill(objet);
  await page.getByLabel("Description", { exact: true }).fill("Souhaite un rendez-vous jeudi.");
}

test.describe("saisir une demande", () => {
  test("critère 1 : liens du menu et de la liste, canal en premier, rappel, pas de consentement", async ({
    page,
  }) => {
    await seConnecter(page, "/equipe/demandes");

    // En haut de la liste.
    await page.getByRole("main").getByRole("link", { name: "Saisir une demande" }).click();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`), NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: "Saisir une demande" })).toBeVisible();

    // Dans le menu (replié sur téléphone), rubrique active.
    const bouton = page.getByRole("button", { name: "Menu" });
    if (await bouton.isVisible()) await bouton.click();
    const lien = page
      .getByRole("navigation", { name: "Menu de l'espace équipe" })
      .getByRole("link", { name: "Saisir une demande" });
    await expect(lien).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("navigation", { name: "Menu de l'espace équipe" }).getByRole("link", {
        name: "Demandes",
        exact: true,
      }),
    ).not.toHaveAttribute("aria-current", "page");
    if (await bouton.isVisible()) await bouton.click();

    // Canal en premier, sans valeur par défaut.
    const formulaire = page.locator("form").filter({ has: page.getByRole("radiogroup") });
    const premier = formulaire.locator("input:not([type=hidden]), select, textarea").first();
    await expect(premier).toHaveAttribute("name", "canal");
    await expect(radio(page, "Téléphone")).not.toBeChecked();
    await expect(radio(page, "Email")).not.toBeChecked();

    // Mêmes champs que le formulaire public, email facultatif.
    await expect(page.getByLabel("Nom et prénom", { exact: true })).toBeVisible();
    await expect(page.getByText("Email (facultatif)")).toBeVisible();
    await expect(champTelephone(page)).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Société/ })).toBeVisible();
    await expect(page.getByLabel("Catégorie", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Objet", { exact: true })).toBeVisible();
    await expect(page.getByText("0 / 5 000")).toBeVisible();

    // Rappel, sans case de consentement ni champ piège.
    await expect(
      page.getByText("Pensez à informer le demandeur de l'usage de ses données."),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.locator("input[name=site_web]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enregistrer la demande" })).toBeEnabled();

    await sansViolationAxe(page);
  });

  test("critères 2 et 3 : téléphone sans email → toast, détail (Téléphone), « Saisie par … (téléphone) »", async ({
    page,
  }) => {
    await ouvrirSaisie(page);
    const nom = `${PREFIXE} M. Lambert`;
    const objet = `Rendez-vous ${randomUUID().slice(0, 6)}`;

    await radio(page, "Téléphone").check();
    await remplirDemande(page, nom, objet);
    await champTelephone(page).fill("06 12 34 56 78");

    // Pendant l'envoi : « Enregistrement… », bouton désactivé.
    await page.route(`**${CHEMIN}`, async (route) => {
      const requete = route.request();
      if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
        await new Promise((r) => setTimeout(r, 800));
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Enregistrer la demande" }).click();
    await expect(page.getByRole("button", { name: "Enregistrement…" })).toBeDisabled();

    // Le toast part dès la réponse de l'action (5 s) : vérifié avant la fin du
    // chargement du détail, qui peut être lent sur le serveur de développement.
    const toast = page.getByRole("status").getByTestId("toast");
    await expect(toast).toHaveText(/^Demande NOVA-\d{4}-\d{4,} enregistrée\.$/, NAVIGATION);
    const annonce = (await toast.textContent()) ?? "";
    await expect(page).toHaveURL(/\/equipe\/demandes\/NOVA-\d{4}-\d{4,}$/, NAVIGATION);
    const reference = decodeURIComponent(new URL(page.url()).pathname.split("/").pop() ?? "");
    expect(annonce).toBe(`Demande ${reference} enregistrée.`);
    await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
    await expect(page.getByText(/via Téléphone/)).toBeVisible();
    await expect(page.getByTestId("bandeau-email")).toHaveCount(0);

    const lignes = page.getByTestId("historique").locator("li");
    await expect(lignes).toHaveCount(1);
    await expect(lignes.first()).toContainText(`Saisie par ${nadia.nom} (téléphone)`);

    const enBase = await avecBase(async (base) => {
      const { rows } = await base.query<{
        canal: string;
        email: string | null;
        etat_email: string;
        saisie_par_id: string;
      }>("select canal, email, etat_email, saisie_par_id from public.demandes where reference = $1", [
        reference,
      ]);
      return rows[0];
    });
    expect(enBase).toEqual({
      canal: "telephone",
      email: null,
      etat_email: "sans_email",
      saisie_par_id: nadia.id,
    });

    await sansViolationAxe(page);

    // Retour arrière : le formulaire rempli n'est pas réaffiché.
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`${CHEMIN}$`));
  });

  test("critère 4 : ni email ni téléphone → message sous Email, focus, saisie conservée", async ({
    page,
  }) => {
    await ouvrirSaisie(page);
    const nom = `${PREFIXE} Sans coordonnées`;
    await radio(page, "Email").check();
    await remplirDemande(page, nom, "Sans coordonnées");
    await page.getByRole("button", { name: "Enregistrer la demande" }).click();

    await expect(page.getByText("Indiquez au moins un email ou un téléphone.")).toBeVisible();
    await expect(champEmail(page)).toBeFocused();
    await expect(champEmail(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Nom et prénom", { exact: true })).toHaveValue(nom);
    await expect(radio(page, "Email")).toBeChecked();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`));

    // Le message disparaît dès qu'on renseigne le téléphone.
    await champTelephone(page).fill("01 23 45 67 89");
    await expect(page.getByText("Indiquez au moins un email ou un téléphone.")).toHaveCount(0);

    await sansViolationAxe(page);
  });

  test("canal non choisi : « Choisissez le canal. », focus sur Téléphone", async ({ page }) => {
    await ouvrirSaisie(page);
    await remplirDemande(page, `${PREFIXE} Sans canal`, "Sans canal");
    await champTelephone(page).fill("06 00 00 00 00");
    await page.getByRole("button", { name: "Enregistrer la demande" }).click();

    await expect(page.getByText("Choisissez le canal.")).toBeVisible();
    await expect(radio(page, "Téléphone")).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`));
  });

  test("catégorie désactivée après l'affichage : message sous Catégorie, liste rechargée, saisie conservée", async ({
    page,
  }, testInfo) => {
    const nomCategorie = `${PREFIXE} Catégorie ${testInfo.project.name}`;
    const categorieId = await avecBase(async (base) => {
      const { rows } = await base.query<{ id: string }>(
        "insert into public.categories (nom, ordre) values ($1, 99) returning id",
        [nomCategorie],
      );
      return rows[0].id;
    });
    await ouvrirSaisie(page);
    const nom = `${PREFIXE} Catégorie retirée`;
    await radio(page, "Téléphone").check();
    await remplirDemande(page, nom, "Catégorie retirée");
    await champTelephone(page).fill("06 11 22 33 44");
    const liste = page.getByLabel("Catégorie", { exact: true });
    await liste.selectOption({ label: nomCategorie });
    await avecBase((base) =>
      base.query("update public.categories set actif = false where id = $1", [categorieId]),
    );

    await page.getByRole("button", { name: "Enregistrer la demande" }).click();

    await expect(page.getByText("Choisissez une catégorie dans la liste.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`));
    await expect(liste).toHaveAttribute("aria-invalid", "true");
    await expect(liste).toBeFocused();
    // Liste rechargée sans la catégorie désactivée, rien de choisi à sa place.
    await expect(liste.locator("option", { hasText: nomCategorie })).toHaveCount(0);
    await expect(liste).toHaveValue("");
    await expect(page.getByLabel("Nom et prénom", { exact: true })).toHaveValue(nom);
    await expect(page.getByLabel("Objet", { exact: true })).toHaveValue("Catégorie retirée");
    await expect(champTelephone(page)).toHaveValue("06 11 22 33 44");
    await expect(radio(page, "Téléphone")).toBeChecked();
  });

  test("canal Email : le détail montre l'état de l'email (mode démonstration)", async ({ page }) => {
    // Aucun envoi réel en test : l'adresse est hors de EMAILS_AUTORISES
    // (comme tests/story-1-7/confirmation.spec.ts), l'email est noté
    // `non_envoye_demo` et le détail l'affiche.
    const email = `lambert-${randomUUID().slice(0, 8)}@example.com`;
    const autorisees = (process.env.EMAILS_AUTORISES ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase());
    test.skip(
      autorisees.includes("*") || autorisees.includes(email),
      "EMAILS_AUTORISES autorise toutes les adresses : pas d'envoi réel en test.",
    );

    await ouvrirSaisie(page);
    const objet = `Email ${randomUUID().slice(0, 6)}`;
    await radio(page, "Email").check();
    await remplirDemande(page, `${PREFIXE} M. Lambert`, objet);
    await champEmail(page).fill(email);
    await page.getByRole("button", { name: "Enregistrer la demande" }).click();

    await expect(page).toHaveURL(/\/equipe\/demandes\/NOVA-\d{4}-\d{4,}$/, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
    await expect(page.getByText(/via Email/)).toBeVisible();
    await expect(page.getByRole("link", { name: email })).toBeVisible();
    await expect(page.getByTestId("bandeau-email")).toHaveText(
      "Email non envoyé (mode démonstration)",
    );
    await expect(page.getByTestId("historique").locator("li").first()).toContainText(
      `Saisie par ${nadia.nom} (email)`,
    );
  });

  test("sans connexion : retour à la connexion, puis à la saisie", async ({ page }) => {
    await page.goto(CHEMIN);
    await expect(page).toHaveURL(
      /\/connexion\?retour=%2Fequipe%2Fdemandes%2Fnouvelle$/,
      NAVIGATION,
    );
    await page.getByLabel("Email", { exact: true }).fill(nadia.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(nadia.motDePasse);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`), APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1, name: "Saisir une demande" })).toBeVisible();
  });
});
