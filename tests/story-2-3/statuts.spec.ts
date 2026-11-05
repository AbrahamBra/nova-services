import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";

// Story 2.3 — marquer traitée, rouvrir, classer sans suite (navigateur).
// Nécessite la migration 20261103000016 appliquée sur nova-dev.
// Critères 1 à 4 d'epics.md : badge et historique sans recharger la page,
// seul le passage permis proposé ; fenêtre « Classer sans suite » (Annuler
// sélectionné, focus gardé, Échap, focus rendu, raison vide refusée sans
// appel) ; rouvrir avec un responsable désactivé ; onglet périmé. Contrôle
// axe. Ordinateur et téléphone.
// Base partagée : comptes et demandes `TEST-2.3-…`, effacés à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.3-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };

let karim: CompteTest; // collaborateur
let leo: CompteTest; // désactivé

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.3" });
  leo = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.3" });
});

test.afterAll(async () => {
  // Demandes d'abord (notes et historique citent les comptes).
  let demandesNettoyees = false;
  try {
    await avecBase((base) => supprimerDemandesTest(base, PREFIXE));
    demandesNettoyees = true;
  } catch (erreur) {
    console.error(`Nettoyage des demandes de test impossible : ${String(erreur)}`);
  } finally {
    if (demandesNettoyees) await supprimerComptesTest([karim, leo].filter(Boolean));
  }
});

// Story 1.9 : chaque contexte se connecte depuis sa propre IP de test.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

function demande(options: Parameters<typeof creerDemandeTest>[2] = {}): Promise<DemandeTest> {
  return avecBase((base) => creerDemandeTest(base, PREFIXE, options));
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

/** Compte les appels d'actions serveur ; `delai` les ralentit (états « … »). */
async function suivreActions(page: Page, delai = 0): Promise<{ nombre: number }> {
  const appels = { nombre: 0 };
  await page.route("**/equipe/demandes/**", async (route) => {
    const requete = route.request();
    if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
      appels.nombre++;
      if (delai > 0) await new Promise((r) => setTimeout(r, delai));
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

const MESSAGE_RESEAU =
  "Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant.";

/** Partie « Statut » : reçoit le focus après une action (le bouton cliqué disparaît). */
function partieStatut(page: Page) {
  return page.getByTestId("actions-statut");
}

function panneau(page: Page) {
  return page.getByRole("complementary", { name: "Informations" });
}

const BOUTONS_STATUT = ["Marquer comme traitée", "Rouvrir", "Classer sans suite"];

/** Boutons de statut visibles dans le panneau, dans l'ordre. */
async function boutonsStatut(page: Page): Promise<string[]> {
  const textes = await panneau(page).getByRole("button").allTextContents();
  return textes.map((t) => t.trim()).filter((t) => BOUTONS_STATUT.includes(t));
}

function lignesHistorique(page: Page) {
  return page.getByTestId("historique").locator("li");
}

test.describe("changer le statut", () => {
  test("critères 1 et 4 : En cours → « Marquer comme traitée », badge vert, historique, sans recharger", async ({
    page,
  }) => {
    const d = await demande({ statut: "en_cours", responsableId: karim.id });
    await ouvrir(page, d);

    // Critère 4 : seul le passage permis.
    expect(await boutonsStatut(page)).toEqual(["Marquer comme traitée"]);
    await poserRepere(page);

    await suivreActions(page, 800);
    await panneau(page).getByRole("button", { name: "Marquer comme traitée" }).click();
    await expect(panneau(page).getByRole("button", { name: "Enregistrement…" })).toBeDisabled();

    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      "Demande marquée comme traitée.",
      NAVIGATION,
    );
    await expect(panneau(page).locator("[data-statut]")).toHaveAttribute("data-statut", "traitee");
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Traitée");
    await expect(page.locator("header [data-statut]")).toHaveText("Traitée");
    await expect(lignesHistorique(page)).toHaveCount(2);
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `${karim.nom} a changé le statut : En cours → Traitée`,
    );
    // Boutons à jour : seul « Rouvrir ». Focus sur la partie « Statut », pas sur <body>.
    await expect(panneau(page).getByRole("button", { name: "Rouvrir" })).toBeVisible();
    await expect(partieStatut(page)).toBeFocused();
    await expect(partieStatut(page)).toHaveAttribute("aria-label", "Statut : Traitée");
    expect(await boutonsStatut(page)).toEqual(["Rouvrir"]);
    await expect(page.getByTestId("responsable")).toHaveText(karim.nom);
    await sansRechargement(page);

    await sansViolationAxe(page);
  });

  test("critère 2 : Traitée → « Rouvrir », En cours avec le même responsable", async ({ page }) => {
    const d = await demande({ statut: "traitee", responsableId: karim.id });
    await ouvrir(page, d);
    expect(await boutonsStatut(page)).toEqual(["Rouvrir"]);
    await poserRepere(page);

    await panneau(page).getByRole("button", { name: "Rouvrir" }).click();
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText("Demande rouverte.", NAVIGATION);
    await expect(panneau(page).locator("[data-statut]")).toHaveText("En cours");
    await expect(page.getByTestId("responsable")).toHaveText(karim.nom);
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `${karim.nom} a changé le statut : Traitée → En cours`,
    );
    expect(await boutonsStatut(page)).toEqual(["Marquer comme traitée"]);
    await expect(partieStatut(page)).toBeFocused();
    await sansRechargement(page);
  });

  test("Rouvrir une demande classée sans suite (sans responsable) : Nouvelle, toast dédié", async ({
    page,
  }) => {
    const d = await demande({ statut: "traitee", responsableId: null });
    await ouvrir(page, d);
    await panneau(page).getByRole("button", { name: "Rouvrir" }).click();
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      "Demande rouverte. Elle revient en Nouvelle, sans responsable.",
      NAVIGATION,
    );
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Nouvelle");
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
    await expect(partieStatut(page)).toBeFocused();
  });

  for (const [depart, bouton] of [
    ["en_cours", "Marquer comme traitée"],
    ["traitee", "Rouvrir"],
  ] as const) {
    test(`réseau coupé sur « ${bouton} » : toast rouge, rien ne change, bouton de nouveau actif`, async ({
      page,
    }) => {
      const d = await demande({ statut: depart, responsableId: karim.id });
      await ouvrir(page, d);
      await couperActions(page);
      await panneau(page).getByRole("button", { name: bouton }).click();
      await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(MESSAGE_RESEAU, NAVIGATION);
      await expect(panneau(page).getByRole("button", { name: bouton })).toBeEnabled();
      await expect(panneau(page).locator("[data-statut]")).toHaveAttribute("data-statut", depart);
      await expect(lignesHistorique(page)).toHaveCount(1);
    });
  }

  test("Rouvrir avec un responsable désactivé : Nouvelle sans responsable, toast dédié", async ({ page }) => {
    const d = await demande({ statut: "traitee", responsableId: leo.id });
    await ouvrir(page, d);
    await panneau(page).getByRole("button", { name: "Rouvrir" }).click();
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      "Demande rouverte. Son responsable n'est plus actif : elle revient en Nouvelle.",
      NAVIGATION,
    );
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Nouvelle");
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `${karim.nom} a changé le statut : Traitée → Nouvelle`,
    );
    await expect(panneau(page).getByRole("button", { name: "Prendre en charge" })).toBeVisible();
    expect(await boutonsStatut(page)).toEqual(["Classer sans suite"]);
  });

  test("onglet périmé : toast rouge « Ce changement de statut n'est pas autorisé. », détail rafraîchi", async ({
    page,
  }) => {
    const d = await demande({ statut: "en_cours", responsableId: karim.id });
    await ouvrir(page, d);
    // Changé ailleurs pendant que la page est ouverte.
    await avecBase((base) =>
      base.query("update public.demandes set statut = 'traitee' where id = $1", [d.id]),
    );
    await panneau(page).getByRole("button", { name: "Marquer comme traitée" }).click();
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(
      "Ce changement de statut n'est pas autorisé.",
      NAVIGATION,
    );
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Traitée");
    expect(await boutonsStatut(page)).toEqual(["Rouvrir"]);
    await expect(lignesHistorique(page)).toHaveCount(1);
  });
});

test.describe("classer sans suite", () => {
  test("critère 3 : fenêtre, raison obligatoire, puis Traitée, note et historique", async ({ page }) => {
    const d = await demande();
    await ouvrir(page, d);
    expect(await boutonsStatut(page)).toEqual(["Classer sans suite"]);
    await poserRepere(page);
    const appels = await suivreActions(page, 800);

    const declencheur = panneau(page).getByRole("button", { name: "Classer sans suite" });
    await declencheur.click();
    const fenetre = page.getByRole("alertdialog", { name: "Classer sans suite" });
    await expect(fenetre).toBeVisible();
    await expect(fenetre).toContainText(
      "La demande passera à Traitée sans être traitée. Indiquez la raison (spam, doublon…) : elle sera ajoutée aux notes internes.",
    );
    // « Annuler » sélectionné à l'ouverture, à gauche du bouton destructeur (ordinateur).
    const annuler = fenetre.getByRole("button", { name: "Annuler" });
    const confirmer = fenetre.getByRole("button", { name: "Classer sans suite" });
    await expect(annuler).toBeFocused();
    const [boiteAnnuler, boiteConfirmer] = await Promise.all([annuler.boundingBox(), confirmer.boundingBox()]);
    if (!boiteAnnuler || !boiteConfirmer) throw new Error("boutons invisibles");
    if ((page.viewportSize()?.width ?? 0) >= 640) {
      expect(boiteAnnuler.x).toBeLessThan(boiteConfirmer.x);
    }
    const zone = fenetre.getByLabel("Raison du classement");
    await expect(fenetre.getByTestId("compteur-raison")).toHaveText(/^0 \/ 2\s000$/);

    await sansViolationAxe(page);

    // Raison vide : message sous la zone, rien d'envoyé.
    await confirmer.click();
    await expect(fenetre.getByText("Écrivez la raison du classement.")).toBeVisible();
    await expect(zone).toBeFocused();
    await expect(zone).toHaveAttribute("aria-invalid", "true");
    expect(appels.nombre).toBe(0);

    // Focus gardé dans la fenêtre : Tab depuis le dernier bouton revient dedans.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await fenetre.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    // Échap ferme, focus rendu au bouton d'origine.
    await page.keyboard.press("Escape");
    await expect(fenetre).toHaveCount(0);
    await expect(declencheur).toBeFocused();
    expect(appels.nombre).toBe(0);

    // Avec la raison.
    await declencheur.click();
    await fenetre.getByLabel("Raison du classement").fill("Doublon de la demande précédente");
    await expect(fenetre.getByTestId("compteur-raison")).toHaveText(/^32 \/ 2\s000$/);
    await confirmer.click();
    await expect(fenetre.getByRole("button", { name: "Classement…" })).toBeDisabled();

    await expect(page.getByRole("status").getByTestId("toast")).toHaveText(
      "Demande classée sans suite.",
      NAVIGATION,
    );
    await expect(fenetre).toHaveCount(0);
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Traitée");
    await expect(page.getByTestId("responsable")).toHaveText("Aucun");
    await expect(page.getByTestId("texte-note")).toHaveText("Doublon de la demande précédente");
    await expect(lignesHistorique(page)).toHaveCount(2);
    await expect(lignesHistorique(page).nth(1)).toContainText(
      `Classée sans suite par ${karim.nom} : Nouvelle → Traitée`,
    );
    await expect(page.getByTestId("historique")).not.toContainText("Doublon");
    expect(await boutonsStatut(page)).toEqual(["Rouvrir"]);
    // Le bouton d'origine a disparu : focus sur la partie « Statut », pas sur <body>.
    await expect(partieStatut(page)).toBeFocused();
    expect(appels.nombre).toBe(1);
    await sansRechargement(page);
  });

  test("« Annuler » ferme sans rien envoyer ; réseau coupé : toast rouge, fenêtre ouverte, raison conservée", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, d);
    const declencheur = panneau(page).getByRole("button", { name: "Classer sans suite" });
    const fenetre = page.getByRole("alertdialog", { name: "Classer sans suite" });

    await declencheur.click();
    await fenetre.getByLabel("Raison du classement").fill("Spam");
    await fenetre.getByRole("button", { name: "Annuler" }).click();
    await expect(fenetre).toHaveCount(0);
    await expect(declencheur).toBeFocused();
    await expect(panneau(page).locator("[data-statut]")).toHaveText("Nouvelle");

    await couperActions(page);
    await declencheur.click();
    const zone = fenetre.getByLabel("Raison du classement");
    // Saisie conservée entre deux ouvertures.
    await expect(zone).toHaveValue("Spam");
    await fenetre.getByRole("button", { name: "Classer sans suite" }).click();
    // Toast rouge (la fenêtre modale masque le reste de la page aux lecteurs
    // d'écran : repéré par son type, pas par son rôle).
    await expect(page.locator('[data-testid="toast"][data-type="erreur"]')).toHaveText(
      MESSAGE_RESEAU,
      NAVIGATION,
    );
    // Fenêtre ouverte, raison conservée ; pas de message sous la zone ni
    // d'aria-invalid (réservés à une raison vide ou trop longue).
    await expect(fenetre).toBeVisible();
    await expect(zone).toHaveValue("Spam");
    await expect(fenetre.getByTestId("erreur-raison")).toHaveCount(0);
    await expect(zone).not.toHaveAttribute("aria-invalid", "true");
    await expect(fenetre.getByRole("button", { name: "Classer sans suite" })).toBeEnabled();
  });

  test("raison de plus de 2 000 caractères : message sous la zone, relié à la zone, rien d'envoyé", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, d);
    const appels = await suivreActions(page);
    await panneau(page).getByRole("button", { name: "Classer sans suite" }).click();
    const fenetre = page.getByRole("alertdialog", { name: "Classer sans suite" });
    const zone = fenetre.getByLabel("Raison du classement");
    const message = fenetre.getByTestId("erreur-raison");

    await zone.fill("a".repeat(2000));
    await expect(message).toHaveCount(0);
    await zone.fill("a".repeat(2001));
    await expect(message).toHaveText(/^La raison ne doit pas dépasser 2\s000 caractères\.$/);
    await expect(fenetre.getByTestId("compteur-raison")).toHaveText(/^2\s001 \/ 2\s000$/);
    await expect(zone).toHaveAttribute("aria-invalid", "true");
    const decrit = (await zone.getAttribute("aria-describedby")) ?? "";
    const idMessage = await message.locator("..").getAttribute("id");
    expect(decrit.split(" ")).toContain(idMessage);
    await expect(message.locator("..")).toHaveAttribute("aria-live", "polite");

    await fenetre.getByRole("button", { name: "Classer sans suite" }).click();
    await expect(zone).toBeFocused();
    expect(appels.nombre).toBe(0);
    await expect(fenetre).toBeVisible();

    await zone.fill("a".repeat(2000));
    await expect(message).toHaveCount(0);
  });

  test("onglet périmé : fenêtre fermée, toast rouge, détail rafraîchi, focus sur la partie « Statut »", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, d);
    await panneau(page).getByRole("button", { name: "Classer sans suite" }).click();
    const fenetre = page.getByRole("alertdialog", { name: "Classer sans suite" });
    await fenetre.getByLabel("Raison du classement").fill("Doublon");
    // Prise en charge ailleurs pendant que la fenêtre est ouverte.
    await avecBase((base) =>
      base.query(
        "update public.demandes set statut = 'en_cours', responsable_id = $2 where id = $1",
        [d.id, karim.id],
      ),
    );
    await fenetre.getByRole("button", { name: "Classer sans suite" }).click();
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(
      "Ce changement de statut n'est pas autorisé.",
      NAVIGATION,
    );
    await expect(fenetre).toHaveCount(0);
    await expect(panneau(page).locator("[data-statut]")).toHaveText("En cours");
    expect(await boutonsStatut(page)).toEqual(["Marquer comme traitée"]);
    await expect(partieStatut(page)).toBeFocused();
    await expect(page.getByTestId("notes-vide")).toBeVisible();
  });
});
