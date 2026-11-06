import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  clientServiceTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { creerDemandeTest, supprimerDemandesTest } from "../outils/demandes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 4.2 — modifier, désactiver, réactiver un compte (navigateur),
// ordinateur et téléphone.
// Critère 1 : nom et rôle modifiés, liste à jour, toast ; Léo voit
// « Administration » à son chargement de page suivant.
// Critère 2 : Léo responsable de 2 demandes En cours ; la fenêtre les
// annonce (« Annuler » sélectionné) ; après confirmation, « Désactivé ».
// Critère 3 : Léo désactivé est refusé à la connexion ; sur ma ligne, ni
// « Désactiver » ni champ Rôle. Session ouverte : page suivante → /connexion.
// Critère 4 : « Réactiver » et « Réactiver ce compte » (invitation) : Léo
// peut à nouveau se connecter. Contrôle axe à chaque écran.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const PREFIXE = `TEST-4.2-${randomUUID().slice(0, 8)}`;

const comptes: CompteTest[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  try {
    await avecBase((base) => supprimerDemandesTest(base, PREFIXE));
    await effacerJournalDesComptesTest(comptes.map((c) => c.id));
  } catch (erreur) {
    console.error(`Nettoyage impossible : ${String(erreur)}`);
  }
  const service = clientServiceTest();
  for (const c of comptes) {
    await service.auth.admin.updateUserById(c.id, { ban_duration: "none" }).catch(() => {});
  }
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "4.2", ...options });
  comptes.push(c);
  return c;
}

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Ligne (ordinateur) ou carte (téléphone) visible d'un compte. */
function ligneCompte(page: Page, email: string) {
  return page.locator(`[data-compte="${email}"]:visible`);
}

function toast(page: Page, texte: string) {
  return page.getByTestId("toast").filter({ hasText: texte });
}

/**
 * Compte désactivé ET bloqué dans Auth, comme après « Désactiver » : la
 * connexion réussie après la réactivation prouve le déblocage. Le blocage
 * est levé au nettoyage (afterAll) avant la suppression.
 */
async function compteDesactiveBloque(): Promise<CompteTest> {
  const c = await compte({ etat: "desactive", prenom: "Leo" });
  const { error } = await clientServiceTest().auth.admin.updateUserById(c.id, {
    ban_duration: "876000h",
  });
  if (error) throw new Error(`Blocage Auth du compte de test impossible (${error.code ?? error.status}).`);
  return c;
}

async function ouvrirComptes(page: Page, admin: CompteTest) {
  await seConnecter(page, admin, "/equipe/admin/comptes");
  await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible(APRES_CONNEXION);
}

/** Autre navigateur (nouveau contexte, sans session). */
async function autreNavigateur(browser: Browser): Promise<Page> {
  const u = test.info().project.use;
  const contexte = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    locale: u.locale,
    timezoneId: u.timezoneId,
  });
  await utiliserIpDeTest(contexte);
  return contexte.newPage();
}

async function ouvrirMenuSiReplie(page: Page) {
  const bouton = page.getByRole("button", { name: "Menu" });
  if (await bouton.isVisible()) {
    await bouton.click();
    await expect(bouton).toHaveAttribute("aria-expanded", "true");
  }
}

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu de l'espace équipe" });

async function etat(email: string): Promise<string> {
  const { rows } = await avecBase((b) =>
    b.query<{ etat: string }>("select etat from public.membres where email = $1", [email]),
  );
  return rows[0].etat;
}

test.describe("gérer un compte", () => {
  test("critère 1 : nom et rôle modifiés ; Léo voit « Administration » au chargement suivant", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await compte({ role: "collaborateur", prenom: "Leo" });

    // Léo est connecté avant le changement : pas d'Administration.
    const pageLeo = await autreNavigateur(browser);
    try {
      await seConnecter(pageLeo, leo, "/equipe");
      await expect(pageLeo).toHaveURL(/\/equipe$/, APRES_CONNEXION);
      await ouvrirMenuSiReplie(pageLeo);
      await expect(menu(pageLeo).getByRole("heading", { name: "Administration" })).toHaveCount(0);

      await ouvrirComptes(page, admin);
      await sansViolationAxe(page);
      const ligne = ligneCompte(page, leo.email);
      await ligne.getByRole("button", { name: "Modifier" }).click();
      const fenetre = page.getByRole("dialog", { name: "Modifier le compte" });
      await expect(fenetre).toBeVisible();
      await expect(fenetre.getByLabel("Nom et prénom")).toHaveValue(leo.nom);
      await expect(fenetre.getByLabel("Rôle")).toHaveValue("collaborateur");
      await sansViolationAxe(page);

      // Nom vide : message sous le champ, focus dessus.
      await fenetre.getByLabel("Nom et prénom").fill("  ");
      await fenetre.getByRole("button", { name: "Enregistrer" }).click();
      await expect(fenetre.getByText("Indiquez le nom et prénom du membre.")).toBeVisible();
      await expect(fenetre.getByLabel("Nom et prénom")).toBeFocused();

      const nouveauNom = `${leo.nom} Junior`;
      await fenetre.getByLabel("Nom et prénom").fill(nouveauNom);
      await fenetre.getByLabel("Rôle").selectOption("administrateur");
      await fenetre.getByRole("button", { name: "Enregistrer" }).click();
      await expect(fenetre).toBeHidden(NAVIGATION);
      await expect(toast(page, "Compte modifié.")).toBeVisible();
      await expect(ligneCompte(page, leo.email)).toContainText(nouveauNom);
      await expect(ligneCompte(page, leo.email)).toContainText("Administrateur");

      // Chargement de page suivant : Léo voit « Administration ».
      await pageLeo.reload();
      await ouvrirMenuSiReplie(pageLeo);
      await expect(menu(pageLeo).getByRole("heading", { name: "Administration" })).toBeVisible(NAVIGATION);
    } finally {
      await pageLeo.context().close();
    }
  });

  test("critères 2 et 3 : désactivation annoncée, Léo refusé à la connexion, sa session ouverte coupée", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await compte({ role: "collaborateur", prenom: "Leo" });
    await avecBase(async (base) => {
      await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: leo.id });
      await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: leo.id });
    });

    // Session ouverte de Léo.
    const pageLeo = await autreNavigateur(browser);
    try {
      await seConnecter(pageLeo, leo, "/equipe");
      await expect(pageLeo).toHaveURL(/\/equipe$/, APRES_CONNEXION);

      await ouvrirComptes(page, admin);

      // Ma ligne : « Modifier » sans Rôle, jamais « Désactiver ».
      const maLigne = ligneCompte(page, admin.email);
      await expect(maLigne.getByRole("button", { name: "Désactiver" })).toHaveCount(0);
      await maLigne.getByRole("button", { name: "Modifier" }).click();
      const fenetreMoi = page.getByRole("dialog", { name: "Modifier le compte" });
      await expect(fenetreMoi.getByLabel("Nom et prénom")).toBeVisible();
      await expect(fenetreMoi.getByLabel("Rôle")).toHaveCount(0);
      await fenetreMoi.getByRole("button", { name: "Annuler" }).click();
      await expect(fenetreMoi).toBeHidden();

      // Critère 2 : la fenêtre annonce les 2 demandes.
      const ligne = ligneCompte(page, leo.email);
      await ligne.getByRole("button", { name: "Désactiver" }).click();
      const fenetre = page.getByRole("alertdialog", { name: "Désactiver le compte" });
      await expect(fenetre).toBeVisible();
      await expect(fenetre).toContainText(`${leo.nom} ne pourra plus se connecter.`);
      await expect(fenetre).toContainText("Ses 2 demandes en cours reviendront en Nouvelle, sans responsable.");
      await expect(fenetre.getByRole("button", { name: "Annuler" })).toBeFocused();
      await sansViolationAxe(page);
      await fenetre.getByRole("button", { name: "Désactiver" }).click();
      await expect(fenetre).toBeHidden(NAVIGATION);
      await expect(toast(page, "Compte désactivé.")).toBeVisible();
      await expect(ligneCompte(page, leo.email)).toContainText("Désactivé");
      await expect(ligneCompte(page, leo.email).getByRole("button", { name: "Réactiver" })).toBeVisible();
      expect(await etat(leo.email)).toBe("desactive");

      const { rows } = await avecBase((b) =>
        b.query<{ n: number }>(
          `select count(*)::int as n from public.demandes
            where nom like $1 and statut = 'nouvelle' and responsable_id is null`,
          [`${PREFIXE}%`],
        ),
      );
      expect(rows[0].n).toBe(2);

      // Session ouverte : la page suivante renvoie à la connexion.
      await pageLeo.reload();
      await expect(pageLeo).toHaveURL(/\/connexion/, NAVIGATION);
    } finally {
      await pageLeo.context().close();
    }

    // Critère 3 : connexion refusée, même message qu'un mauvais mot de passe.
    const pageRefus = await autreNavigateur(browser);
    try {
      await seConnecter(pageRefus, leo, "/equipe");
      await expect(pageRefus.getByText("Email ou mot de passe incorrect.")).toBeVisible(NAVIGATION);
      await expect(pageRefus).toHaveURL(/\/connexion/);
    } finally {
      await pageRefus.context().close();
    }
  });

  test("critère 4 : « Réactiver » rend l'accès", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await compteDesactiveBloque();

    await ouvrirComptes(page, admin);
    const ligne = ligneCompte(page, leo.email);
    await expect(ligne).toContainText("Désactivé");
    await ligne.getByRole("button", { name: "Réactiver" }).click();
    await expect(toast(page, "Compte réactivé.")).toBeVisible(NAVIGATION);
    await expect(ligneCompte(page, leo.email)).toContainText("Actif");
    await expect(ligneCompte(page, leo.email).getByRole("button", { name: "Désactiver" })).toBeVisible();
    await sansViolationAxe(page);
    expect(await etat(leo.email)).toBe("actif");

    const pageLeo = await autreNavigateur(browser);
    try {
      await seConnecter(pageLeo, leo, "/equipe");
      await expect(pageLeo).toHaveURL(/\/equipe$/, APRES_CONNEXION);
    } finally {
      await pageLeo.context().close();
    }
  });

  test("critère 4 : invitation d'un email désactivé, « Réactiver ce compte »", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const leo = await compteDesactiveBloque();

    await ouvrirComptes(page, admin);
    await page.getByRole("button", { name: "Inviter un membre" }).click();
    const fenetre = page.getByRole("dialog", { name: "Inviter un membre" });
    await fenetre.getByLabel("Nom et prénom").fill(leo.nom);
    await fenetre.getByLabel("Email").fill(leo.email.toUpperCase());
    await fenetre.getByRole("button", { name: "Inviter", exact: true }).click();
    await expect(fenetre.getByText("Cette adresse appartient à un compte désactivé.")).toBeVisible(NAVIGATION);
    await sansViolationAxe(page);
    await fenetre.getByRole("button", { name: "Réactiver ce compte" }).click();
    await expect(fenetre).toBeHidden(NAVIGATION);
    await expect(toast(page, "Compte réactivé.")).toBeVisible();
    await expect(ligneCompte(page, leo.email)).toContainText("Actif", NAVIGATION);
    expect(await etat(leo.email)).toBe("actif");

    // Débloqué dans Auth : Léo peut se reconnecter.
    const pageLeo = await autreNavigateur(browser);
    try {
      await seConnecter(pageLeo, leo, "/equipe");
      await expect(pageLeo).toHaveURL(/\/equipe$/, APRES_CONNEXION);
    } finally {
      await pageLeo.context().close();
    }
  });
});
