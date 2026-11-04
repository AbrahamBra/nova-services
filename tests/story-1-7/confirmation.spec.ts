import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { verifierEnvironnement } from "../garde-environnement";
import { creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 1.7 — phrase « Un email de confirmation vous a été envoyé. » sur la
// page de confirmation (navigateur). Nécessite la migration 20261103000009.
//
// Aucun appel réel à Resend : l'adresse du test est hors de EMAILS_AUTORISES
// (vérifié avant de commencer), donc l'action note `non_envoye_demo` sans
// rien envoyer. L'envoi réussi ou en échec est ensuite simulé en écrivant
// l'état directement en base. Les demandes créées portent un nom `TEST-…`
// et sont effacées à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

// Story 1.8 : chaque test dépose avec sa propre IP (limite de 5 envois en
// 10 minutes par IP).
test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

const EMAIL_TEST = "sophie.garnier@example.com";
const PHRASE = "Un email de confirmation vous a été envoyé.";
const ADRESSE_CONFIRMATION = /\/confirmation\/([0-9a-f]{64})$/;

const noms: string[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  const autorisees = (process.env.EMAILS_AUTORISES ?? "")
    .split(",")
    .map((adresse) => adresse.trim().toLowerCase());
  if (autorisees.includes("*") || autorisees.includes(EMAIL_TEST)) {
    throw new Error(
      `EMAILS_AUTORISES ne doit autoriser ni « * » ni ${EMAIL_TEST} (aucun envoi réel en test).`,
    );
  }
});

let compte: CompteTest | undefined;

test.afterAll(async () => {
  if (compte) await supprimerComptesTest([compte]);
  if (noms.length === 0) return;
  const base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  try {
    await base.query("delete from public.demandes where nom = any($1::text[])", [noms]);
  } finally {
    await base.end();
  }
});

async function avecBase<T>(travail: (base: Client) => Promise<T>): Promise<T> {
  const base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  try {
    return await travail(base);
  } finally {
    await base.end();
  }
}

const champ = (page: Page, libelle: string) => page.getByLabel(libelle, { exact: true });

async function deposerParLeFormulaire(page: Page, nom: string): Promise<string> {
  await page.goto("/");
  await champ(page, "Nom et prénom").fill(nom);
  await champ(page, "Email").fill(EMAIL_TEST);
  await champ(page, "Catégorie").selectOption({ label: "Problème technique" });
  await champ(page, "Objet").fill("Impression impossible");
  await champ(page, "Description").fill("Depuis lundi, aucun poste n'imprime.");
  await page
    .getByRole("checkbox", {
      name: "J'accepte que mes données soient utilisées pour traiter ma demande.",
    })
    .click();
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(page).toHaveURL(ADRESSE_CONFIRMATION);
  return ADRESSE_CONFIRMATION.exec(page.url())![1];
}

test("phrase sur l'email affichée seulement si l'email est parti", async ({ page }, testInfo) => {
  const nom = `TEST-1.7-${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)} Sophie Garnier`;
  noms.push(nom);

  // 1. Adresse hors de la liste : enregistrée, non envoyée, sans la phrase.
  const jeton = await deposerParLeFormulaire(page, nom);
  await expect(
    page.getByRole("heading", { level: 1, name: "Votre demande a bien été enregistrée." }),
  ).toBeVisible();
  await expect(page.getByText(PHRASE)).toHaveCount(0);
  const etat = await avecBase(async (base) => {
    const { rows } = await base.query(
      "select etat_email from public.demandes where jeton_confirmation = $1",
      [jeton],
    );
    return rows[0]?.etat_email;
  });
  expect(etat).toBe("non_envoye_demo");

  // 1 bis. Le détail côté équipe affiche le bandeau du mode démonstration.
  const reference = await page.getByText(/^NOVA-\d{4}-\d{4,}$/).innerText();
  const adresseConfirmation = page.url();
  compte = await creerCompteTest({
    role: "collaborateur",
    prenom: "Karim",
    etiquette: `1.7-${testInfo.project.name}`,
  });
  const detail = `/equipe/demandes/${reference}`;
  await page.goto(`/connexion?retour=${encodeURIComponent(detail)}`);
  await page.getByLabel("Email", { exact: true }).fill(compte.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(compte.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(new RegExp(`${detail}$`), { timeout: 15_000 });
  await expect(page.getByTestId("bandeau-email")).toHaveText(
    "Email non envoyé (mode démonstration)",
    { timeout: 15_000 },
  );
  await page.goto(adresseConfirmation);

  const ecrireEtat = (etatEmail: string) =>
    avecBase((base) =>
      base.query("update public.demandes set etat_email = $2 where jeton_confirmation = $1", [
        jeton,
        etatEmail,
      ]),
    );

  // 2. Envoi réussi (simulé en base) : la phrase apparaît, sans l'adresse.
  await ecrireEtat("envoye");
  await page.reload();
  await expect(page.getByText(PHRASE, { exact: true })).toBeVisible();
  const texte = await page.locator("body").innerText();
  expect(texte).not.toContain(EMAIL_TEST);
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);

  // 3. Échec ou attente : pas de phrase.
  for (const etatEmail of ["echec", "en_attente"]) {
    await ecrireEtat(etatEmail);
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Votre demande a bien été enregistrée." }),
    ).toBeVisible();
    await expect(page.getByText(PHRASE)).toHaveCount(0);
  }
});
