import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { formaterDuree } from "../../lib/format";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { creerDemandeTest, supprimerDemandesTest } from "../outils/demandes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 5.3 — enregistrement de VRAIES valeurs (navigateur, ordinateur).
// Critère 1 : l'email de contact changé s'affiche sur le formulaire public et
// sur la page de confirmation (avec le nom affiché changé : « Contactez … »).
// Critère 2 : 3 ans dans l'aperçu et sur le formulaire public.
// Journal : « Paramètres modifiés : … » avec les seuls champs changés.
// Nécessite la migration 20261103000032 appliquée sur nova-dev.
//
// La ligne `parametres` est partagée (formulaire public, autres tests) :
// fichier joué seulement par le projet « valeurs-reelles », qui DÉPEND des
// projets « ordinateur » et « telephone » (il passe après tous les autres),
// et les valeurs de départ sont TOUJOURS remises (finally), même en échec.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-5.3-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const CHEMIN = "/equipe/admin/parametres";

const NOUVEAU_NOM = "TEST-5.3 Nova Accueil";
const NOUVEL_EMAIL = "accueil@nova.example";

const comptes: CompteTest[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  try {
    await avecBase((base) => supprimerDemandesTest(base, PREFIXE));
  } catch (erreur) {
    console.error(`Nettoyage des demandes impossible : ${String(erreur)}`);
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
  const c = await creerCompteTest({ etiquette: "5.3", ...options });
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

const toast = (page: Page, texte: string) => page.getByTestId("toast").filter({ hasText: texte });
const champ = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });

type Ligne = {
  nom_affiche: string;
  email_contact: string;
  duree_conservation_mois: number;
  mis_a_jour_le: string;
};

async function lireLigne(): Promise<Ligne> {
  const { rows } = await avecBase((base) =>
    base.query<Ligne>(
      "select nom_affiche, email_contact, duree_conservation_mois, mis_a_jour_le::text from public.parametres",
    ),
  );
  return rows[0];
}

/** Remet exactement les valeurs de départ (sans ligne de journal). */
async function remettre(depart: Ligne): Promise<void> {
  await avecBase((base) =>
    base.query(
      `update public.parametres
          set nom_affiche = $1, email_contact = $2, duree_conservation_mois = $3,
              mis_a_jour_le = $4::timestamptz`,
      [depart.nom_affiche, depart.email_contact, depart.duree_conservation_mois, depart.mis_a_jour_le],
    ),
  );
}

test("critères 1 et 2 : nouvelles valeurs sur le formulaire public et la confirmation, journal", async ({
  page,
}) => {
  const depart = await lireLigne();
  // Valeurs de départ attendues par d'autres tests : sans elles, ce test
  // ne prouverait pas un changement.
  expect(
    depart.nom_affiche,
    `Nom affiché de départ déjà égal à la valeur de test « ${NOUVEAU_NOM} » : remettez la valeur réelle avant de lancer ce test.`,
  ).not.toBe(NOUVEAU_NOM);
  expect(
    depart.email_contact,
    `Email de contact de départ déjà égal à la valeur de test « ${NOUVEL_EMAIL} » : remettez la valeur réelle avant de lancer ce test.`,
  ).not.toBe(NOUVEL_EMAIL);
  expect(
    depart.duree_conservation_mois,
    "Durée de départ déjà égale à 36 mois (valeur de test) : remettez la valeur réelle avant de lancer ce test.",
  ).not.toBe(36);
  const admin = await compte({ role: "administrateur", prenom: "Claire" });

  try {
    await seConnecter(page, admin, CHEMIN);
    await expect(champ(page, "Email de contact")).toHaveValue(depart.email_contact, NAVIGATION);

    await champ(page, "Nom affiché").fill(`  ${NOUVEAU_NOM} `);
    await champ(page, "Email de contact").fill(NOUVEL_EMAIL.toUpperCase());
    await champ(page, "Durée de conservation").selectOption({ label: "3 ans" });
    await expect(page.getByTestId("apercu-mention")).toHaveText(
      "Vos informations servent uniquement à traiter votre demande. Elles sont conservées 3 ans " +
        `après son traitement, puis supprimées. Pour les faire effacer, écrivez à ${NOUVEL_EMAIL}.`,
    );
    await page.getByRole("button", { name: "Enregistrer les paramètres" }).click();
    await expect(toast(page, "Paramètres enregistrés.")).toBeVisible(NAVIGATION);
    // Valeurs telles qu'enregistrées (espaces retirés, minuscules).
    await expect(champ(page, "Nom affiché")).toHaveValue(NOUVEAU_NOM);
    await expect(champ(page, "Email de contact")).toHaveValue(NOUVEL_EMAIL);

    const apres = await lireLigne();
    expect(apres).toMatchObject({
      nom_affiche: NOUVEAU_NOM,
      email_contact: NOUVEL_EMAIL,
      duree_conservation_mois: 36,
    });
    expect(new Date(apres.mis_a_jour_le).getTime()).toBeGreaterThan(new Date(depart.mis_a_jour_le).getTime());

    // Formulaire public : en-tête, « 3 ans », lien mailto.
    await page.goto("/");
    await expect(page.locator("header").getByText(NOUVEAU_NOM, { exact: true })).toBeVisible(NAVIGATION);
    await expect(page.getByText("Elles sont conservées 3 ans après son traitement")).toBeVisible();
    await expect(page.getByRole("link", { name: NOUVEL_EMAIL })).toHaveAttribute(
      "href",
      `mailto:${NOUVEL_EMAIL}`,
    );

    // Page de confirmation d'une demande : « Contactez [nom] » et l'email.
    const demande = await avecBase((base) => creerDemandeTest(base, PREFIXE));
    const { rows } = await avecBase((base) =>
      base.query<{ jeton: string }>(
        "select jeton_confirmation as jeton from public.demandes where id = $1",
        [demande.id],
      ),
    );
    await page.goto(`/confirmation/${rows[0].jeton}`);
    await expect(page.getByText(`Contactez ${NOUVEAU_NOM}`)).toBeVisible(NAVIGATION);
    await expect(page.getByRole("link", { name: NOUVEL_EMAIL })).toBeVisible();

    // Journal : les trois champs changés, anciennes et nouvelles valeurs.
    await page.goto("/equipe/admin/journal?type=parametre");
    await expect(
      page
        .getByText(
          `Paramètres modifiés : nom affiché « ${depart.nom_affiche} » → « ${NOUVEAU_NOM} » ; ` +
            `email de contact « ${depart.email_contact} » → « ${NOUVEL_EMAIL} » ; ` +
            `durée de conservation « ${formaterDuree(depart.duree_conservation_mois)} » → « 3 ans »`,
        )
        .filter({ visible: true })
        .first(),
    ).toBeVisible(NAVIGATION);
  } finally {
    await remettre(depart);
  }

  // Remis : le formulaire public affiche de nouveau les valeurs de départ.
  expect(await lireLigne()).toEqual(depart);
  await page.goto("/");
  await expect(page.getByRole("link", { name: depart.email_contact })).toBeVisible(NAVIGATION);
  await expect(
    page.getByText(`Elles sont conservées ${formaterDuree(depart.duree_conservation_mois)} après son traitement`),
  ).toBeVisible();
});
