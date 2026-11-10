import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
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

// Story 5.1 — page Journal (navigateur), ordinateur et téléphone.
// Critère 1 : ouverte depuis le menu « Journal », la page montre les
// événements du plus récent au plus ancien, avec date, type, description et
// auteur (« Système » pour un échec d'email et un blocage de connexion).
// Critère 2 : le filtre « Compte » ne garde que les événements de comptes,
// dont « Compte créé : … Léo Martin (Collaborateur) » ; un type inconnu est
// retiré de l'adresse.
// Critère 3 : un collaborateur qui tape l'adresse est refusé.
// Contrôle axe à chaque écran. Lignes créées par les vraies fonctions
// (`creer_membre` avec auteur, `noter_resultat_email`) ou, pour le blocage de
// connexion, insérées comme le ferait `terminer_connexion` ; toutes effacées
// en fin de test (comptes, demande et journal `TEST-5.1-…`).

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };

const comptes: CompteTest[] = [];
const prefixes: string[] = [];
/** Lignes du journal écrites par le système pour ces tests. */
const lignesSysteme: number[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  try {
    await effacerJournalDesComptesTest(comptes.map((c) => c.id));
    if (lignesSysteme.length > 0) {
      await avecBase(async (base) => {
        await base.query("begin");
        try {
          await base.query("select set_config('nova.purge_journal', 'on', true)");
          await base.query(
            "delete from public.journal where id = any($1::bigint[]) and auteur_type = 'systeme'",
            [lignesSysteme],
          );
          await base.query("commit");
        } catch (erreur) {
          await base.query("rollback").catch(() => {});
          throw erreur;
        }
      });
    }
  } catch (erreur) {
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`);
  }
  await avecBase(async (base) => {
    for (const prefixe of prefixes) await supprimerDemandesTest(base, prefixe);
  }).catch((erreur) => console.error(`Nettoyage des demandes impossible : ${String(erreur)}`));
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.1", ...options });
  comptes.push(c);
  return c;
}

/**
 * Trois événements, du plus ancien au plus récent : blocage de connexion
 * (système), échec d'email (système), compte de Léo créé par l'administrateur.
 * Renvoie l'identifiant de chaque ligne et le nom de Léo.
 */
async function evenements(admin: CompteTest) {
  return avecBase(async (base) => {
    const { rows: connexion } = await base.query<{ id: string }>(
      `insert into public.journal (type, details, auteur_type)
       values ('connexion',
               '{"evenement": "connexion_bloquee", "bloque": "email", "duree_minutes": 15}',
               'systeme')
       returning id`,
    );
    lignesSysteme.push(Number(connexion[0].id));

    const prefixe = `TEST-5.1-${randomUUID().slice(0, 8)}`;
    prefixes.push(prefixe);
    const demande = await creerDemandeTest(base, prefixe);
    await base.query("select public.noter_resultat_email($1, 'echec', 'invalid_api_key')", [demande.id]);
    const { rows: email } = await base.query<{ id: string }>(
      `select id from public.journal
        where details ->> 'evenement' = 'echec_confirmation' and details ->> 'reference' = $1`,
      [demande.reference],
    );
    if (email.length !== 1) {
      throw new Error(`Ligne echec_confirmation introuvable pour ${demande.reference} (${email.length} trouvée(s)).`);
    }
    lignesSysteme.push(Number(email[0].id));

    // Compte créé par l'administrateur, comme l'action `inviter`.
    const code = randomUUID().slice(0, 8);
    const leo: CompteTest = {
      id: "",
      nom: `TEST-5.1-${code} Léo Martin`,
      email: `test-5-1-${code}@example.com`,
      motDePasse: randomBytes(18).toString("base64url"),
      role: "collaborateur",
      etat: "actif",
    };
    const service = clientServiceTest();
    const { data, error } = await service.auth.admin.createUser({
      email: leo.email,
      password: leo.motDePasse,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`Compte Auth : ${error?.code ?? error?.status}`);
    leo.id = data.user.id;
    comptes.push(leo);
    const { error: erreurMembre } = await service.rpc("creer_membre", {
      p_id: leo.id,
      p_nom: leo.nom,
      p_email: leo.email,
      p_role: "collaborateur",
      p_etat: "actif",
      p_auteur_id: admin.id,
    });
    if (erreurMembre) throw new Error(`creer_membre : ${erreurMembre.message}`);
    const { rows: cree } = await base.query<{ id: string }>(
      `select id from public.journal
        where details ->> 'evenement' = 'compte_cree' and details ->> 'membre_id' = $1`,
      [leo.id],
    );
    if (cree.length !== 1) {
      throw new Error(`Ligne compte_cree introuvable pour le membre ${leo.id} (${cree.length} trouvée(s)).`);
    }

    return {
      connexion: connexion[0].id,
      email: email[0].id,
      compte: cree[0].id,
      reference: demande.reference,
      leo,
    };
  });
}

async function seConnecter(page: Page, c: CompteTest, retour: string) {
  await page.goto(`/connexion?retour=${encodeURIComponent(retour)}`);
  await page.getByLabel("Email", { exact: true }).fill(c.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(c.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu de l'espace équipe" });
const boutonMenu = (page: Page) => page.getByRole("button", { name: "Menu" });
const filtre = (page: Page) => page.getByRole("navigation", { name: "Filtrer par type" });
/** Ligne (tableau ou carte, celle qui est affichée) du journal. */
const ligne = (page: Page, id: string) => page.locator(`[data-journal="${id}"]:visible`);

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Rang de chaque ligne affichée, dans l'ordre de la page. */
async function rangs(page: Page): Promise<string[]> {
  return page
    .locator("[data-journal]:visible")
    .evaluateAll((elements) => elements.map((e) => e.getAttribute("data-journal") ?? ""));
}

test.describe("story 5.1 — journal", () => {
  test("critères 1 et 2 : plus récent en haut, « Système », filtre « Compte », type inconnu retiré", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const ids = await evenements(admin);

    await seConnecter(page, admin, "/equipe/admin/comptes");
    await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible(APRES_CONNEXION);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    await menu(page).getByRole("link", { name: "Journal" }).click();
    await expect(page).toHaveURL(/\/equipe\/admin\/journal$/, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible(NAVIGATION);
    await expect(page).toHaveTitle("Journal — Nova Services");

    // Critère 1 : les trois lignes, du plus récent au plus ancien.
    await expect(ligne(page, ids.compte)).toContainText(
      `Compte créé : ${ids.leo.nom} (Collaborateur)`,
    );
    await expect(ligne(page, ids.compte)).toContainText(admin.nom);
    await expect(ligne(page, ids.compte)).toContainText("Compte");
    await expect(ligne(page, ids.compte)).toContainText(/\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}/);
    await expect(ligne(page, ids.email)).toContainText(
      `Email de confirmation non envoyé pour ${ids.reference} (code : invalid_api_key)`,
    );
    await expect(ligne(page, ids.email)).toContainText("Système");
    await expect(ligne(page, ids.connexion)).toContainText(
      "Connexion bloquée 15 minutes après 5 échecs (même email)",
    );
    await expect(ligne(page, ids.connexion)).toContainText("Système");
    const ordre = await rangs(page);
    expect(ordre.indexOf(ids.compte)).toBeGreaterThanOrEqual(0);
    expect(ordre.indexOf(ids.compte)).toBeLessThan(ordre.indexOf(ids.email));
    expect(ordre.indexOf(ids.email)).toBeLessThan(ordre.indexOf(ids.connexion));
    expect(ordre.length).toBeLessThanOrEqual(50);
    await expect(filtre(page).getByRole("link", { name: "Tous" })).toHaveAttribute("aria-current", "true");
    await sansViolationAxe(page);

    // Critère 2 : filtre « Compte ».
    await filtre(page).getByRole("link", { name: "Compte", exact: true }).click();
    await expect(page).toHaveURL(/\/equipe\/admin\/journal\?type=compte$/, NAVIGATION);
    await expect(filtre(page).getByRole("link", { name: "Compte", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(ligne(page, ids.compte)).toContainText(`Compte créé : ${ids.leo.nom} (Collaborateur)`);
    // Les lignes email et connexion de ce test ne sont plus affichées.
    await expect(ligne(page, ids.email)).toHaveCount(0);
    await expect(ligne(page, ids.connexion)).toHaveCount(0);
    await sansViolationAxe(page);

    // Type inconnu : ignoré, adresse ramenée à sa forme canonique.
    await page.goto("/equipe/admin/journal?type=xyz");
    await expect(page).toHaveURL(/\/equipe\/admin\/journal$/, NAVIGATION);
    await expect(ligne(page, ids.email)).toBeVisible();
  });

  test("critère 3 : un collaborateur qui tape l'adresse est refusé", async ({ page }) => {
    const collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
    await seConnecter(page, collaborateur, "/equipe/admin/journal");
    await expect(page).toHaveURL(/\/equipe\/admin\/journal$/, APRES_CONNEXION);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Vous n'avez pas accès à cette page.",
    );
    await expect(page).toHaveTitle("Accès refusé — Nova Services");
    await expect(page.locator("[data-journal]")).toHaveCount(0);
    await expect(filtre(page)).toHaveCount(0);
    if (await boutonMenu(page).isVisible()) await boutonMenu(page).click();
    await expect(menu(page).getByRole("link", { name: "Journal" })).toHaveCount(0);
    await sansViolationAxe(page);
  });
});
