import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 1.4 — connexion à l'espace équipe (navigateur).
// Nécessite la migration 20261103000005 appliquée sur nova-dev.
// Chaque test crée ses propres comptes `TEST-…` jetables, supprimés à la fin :
// ni le compte d'Abraham, ni les comptes de test persistants.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const comptes: CompteTest[] = [];

// Story 1.9 : chaque test se connecte depuis sa propre IP de test, pour que
// les échecs de connexion d'un test ne bloquent jamais les autres.
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

test.beforeAll(() => {
  // Ces tests écrivent dans la base : jamais ailleurs qu'en développement.
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  await supprimerComptesTest(comptes);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest(options);
  comptes.push(c);
  return c;
}

const MESSAGE_REFUS = "Email ou mot de passe incorrect.";
// Connexion, lecture du profil puis rendu de /equipe : plus long que
// l'attente par défaut quand toute la suite tourne sur le serveur de développement.
const APRES_CONNEXION = { timeout: 15_000 };

const champ = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });
// Bandeau du formulaire (l'annonceur de route de Next.js a aussi le rôle « alert »).
const alerte = (page: Page) => page.locator("form").getByRole("alert");

async function seConnecter(page: Page, email: string, motDePasse: string) {
  await champ(page, "Email").fill(email);
  await champ(page, "Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu de l'espace équipe" });
const boutonMenu = (page: Page) => page.getByRole("button", { name: "Menu" });

/** Sous 1 024 px, ouvre le menu replié. */
async function ouvrirMenuSiReplie(page: Page) {
  if (await boutonMenu(page).isVisible()) {
    await boutonMenu(page).click();
    await expect(boutonMenu(page)).toHaveAttribute("aria-expanded", "true");
  }
}

async function seDeconnecter(page: Page) {
  await ouvrirMenuSiReplie(page);
  await menu(page).getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
}

async function sansViolationAxe(page: Page) {
  // Couleurs mesurées à leur valeur finale : le bouton réactivé après un
  // refus passe de 50 % à 100 % d'opacité en 150 ms (transition).
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

test.describe("connexion à l'espace équipe", () => {
  test("un administrateur passe par « Espace équipe » et arrive sur « Bonjour [prénom] »", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const prenom = admin.nom.split(" ")[0];

    await page.goto("/");
    await page.getByRole("link", { name: "Espace équipe" }).click();
    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
    await sansViolationAxe(page);

    await seConnecter(page, admin.email, admin.motDePasse);
    await expect(page).toHaveURL(/\/equipe$/, APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Bonjour ${prenom}`);

    // Menu : seulement les rubriques qui existent, Administration, nom et rôle.
    await ouvrirMenuSiReplie(page);
    await expect(menu(page).getByRole("link", { name: "Accueil" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(menu(page).getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(menu(page).getByText(admin.nom, { exact: true })).toBeVisible();
    await expect(menu(page).getByText("Administrateur", { exact: true })).toBeVisible();
    // Story 1.5 : Accueil, Demandes et Administration ; story 2.6 : Saisir une
    // demande ; story 4.1 : « Comptes » remplace « Vue d'ensemble » ; story
    // 5.1 : « Journal » ; story 5.2 : « Catégories » ; story 5.3 : « Paramètres » ;
    // story 5.4 : « Données ».
    await expect(menu(page).getByRole("link")).toHaveCount(8);
    await sansViolationAxe(page);

    // Zone administrateur ouverte à l'administrateur.
    await menu(page).getByRole("link", { name: "Comptes" }).click();
    await expect(page).toHaveURL(/\/equipe\/admin\/comptes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

    // Déconnexion, puis une page interne renvoie vers la connexion.
    await seDeconnecter(page);
    await page.goto("/equipe/admin");
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipe%2Fadmin$/);
  });

  test("/equipe sans session renvoie vers la connexion, puis revient sur /equipe ; un collaborateur n'a pas l'administration", async ({
    page,
  }) => {
    const collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });

    await page.goto("/equipe");
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipe$/);
    await seConnecter(page, collaborateur.email, collaborateur.motDePasse);
    await expect(page).toHaveURL(/\/equipe$/, APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `Bonjour ${collaborateur.nom.split(" ")[0]}`,
    );

    // Menu replié sous 1 024 px, derrière « Menu ».
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(boutonMenu(page)).toBeVisible();
    await expect(boutonMenu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(menu(page)).toBeHidden();
    await boutonMenu(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("link", { name: "Accueil" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(boutonMenu(page)).toBeFocused();

    if (test.info().project.name === "ordinateur") {
      // Ouvert puis élargi à 1 024 px : le panneau replié se referme.
      await boutonMenu(page).click();
      await expect(boutonMenu(page)).toHaveAttribute("aria-expanded", "true");
      await page.setViewportSize({ width: 1024, height: 800 });
      // Bouton masqué à cette largeur : lu par son attribut, hors arbre d'accessibilité.
      await expect(page.locator("button[aria-controls]")).toHaveAttribute("aria-expanded", "false");
      await page.setViewportSize({ width: 1000, height: 800 });
      await expect(menu(page)).toBeHidden();
    }

    if (test.info().project.name === "ordinateur") {
      // À partir de 1 024 px : menu ouvert, sans bouton « Menu ».
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(boutonMenu(page)).toBeHidden();
      await expect(menu(page)).toBeVisible();
    }

    await ouvrirMenuSiReplie(page);
    await expect(menu(page).getByText("Collaborateur", { exact: true })).toBeVisible();
    await expect(menu(page).getByRole("heading", { name: "Administration" })).toHaveCount(0);
    // Story 1.5 : Accueil et Demandes ; story 2.6 : Saisir une demande.
    await expect(menu(page).getByRole("link")).toHaveCount(3);

    // L'administration est refusée au collaborateur.
    await page.goto("/equipe/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Vous n'avez pas accès à cette page.",
    );
    await sansViolationAxe(page);
    await page.getByRole("link", { name: "Retour à l'accueil" }).click();
    await expect(page).toHaveURL(/\/equipe$/);

    await seDeconnecter(page);
    await page.goto("/equipe");
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipe$/);
    await page.reload();
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipe$/);
  });

  test("une adresse de retour extérieure mène à /equipe", async ({ page }) => {
    const collaborateur = await compte({ role: "collaborateur" });
    await page.goto(`/connexion?retour=${encodeURIComponent("https://exemple.com")}`);
    await seConnecter(page, collaborateur.email, collaborateur.motDePasse);
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/equipe$/, APRES_CONNEXION);
  });

  test("un mauvais mot de passe et un email inconnu reçoivent le même message, l'email reste", async ({
    page,
  }) => {
    const collaborateur = await compte({ role: "collaborateur" });

    await page.goto("/connexion");
    await seConnecter(page, collaborateur.email, "mauvais-mot-de-passe");
    await expect(alerte(page)).toHaveText(MESSAGE_REFUS);
    await expect(page).toHaveURL(/\/connexion$/);
    await expect(champ(page, "Email")).toHaveValue(collaborateur.email);
    await expect(champ(page, "Mot de passe")).toHaveValue("");
    await sansViolationAxe(page);

    await champ(page, "Email").fill("test-1-4-inconnu@example.com");
    await champ(page, "Mot de passe").fill("un-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(alerte(page)).toHaveText(MESSAGE_REFUS);
    await expect(champ(page, "Email")).toHaveValue("test-1-4-inconnu@example.com");
  });

  test("un compte désactivé ou invité est refusé avec le même message et sa session est fermée", async ({
    page,
  }) => {
    for (const etat of ["desactive", "invite"] as const) {
      const c = await compte({ etat });
      await page.goto("/connexion");
      await seConnecter(page, c.email, c.motDePasse);
      await expect(alerte(page)).toHaveText(MESSAGE_REFUS);
      await expect(page).toHaveURL(/\/connexion$/);

      // Aucune session restante : l'espace équipe renvoie vers la connexion.
      await page.goto("/equipe");
      await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipe$/);
      const cookiesSession = (await page.context().cookies()).filter((k) => k.name.startsWith("sb-"));
      expect(cookiesSession).toEqual([]);
    }
  });

  test("les champs vides sont signalés sous les champs", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Indiquez votre adresse email.")).toBeVisible();
    await expect(page.getByText("Indiquez votre mot de passe.")).toBeVisible();
    await expect(champ(page, "Email")).toBeFocused();
  });

  test("un administrateur venu de /equipe/admin y revient après connexion ; /connexion le renvoie ensuite vers l'espace équipe", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur" });
    await page.goto("/connexion?retour=%2Fequipe%2Fadmin");
    await seConnecter(page, admin.email, admin.motDePasse);
    // Story 4.1 : /equipe/admin mène à « Comptes ».
    await expect(page).toHaveURL(/\/equipe\/admin\/comptes$/, APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

    // Déjà connecté : la page de connexion mène à l'espace équipe.
    await page.goto("/connexion");
    await expect(page).toHaveURL(/\/equipe$/);
    await page.goto("/connexion?retour=%2Fequipe%2Fadmin");
    await expect(page).toHaveURL(/\/equipe\/admin\/comptes$/);
  });

  test("les droits sont relus à chaque page : rétrogradé, l'administrateur perd l'administration ; désactivé, il revient à la connexion", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur" });
    await page.goto("/connexion");
    await seConnecter(page, admin.email, admin.motDePasse);
    await expect(page).toHaveURL(/\/equipe$/, APRES_CONNEXION);

    await avecBase((base) =>
      base.query("update public.membres set role = 'collaborateur' where id = $1", [admin.id]),
    );
    await page.goto("/equipe/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Vous n'avez pas accès à cette page.",
    );
    await expect(page).toHaveTitle("Accès refusé — Nova Services");

    await avecBase((base) =>
      base.query("update public.membres set etat = 'desactive' where id = $1", [admin.id]),
    );
    await page.reload();
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipe%2Fadmin$/);
    // Session sans membre actif : le formulaire reste affiché (pas de boucle).
    await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
  });
});
