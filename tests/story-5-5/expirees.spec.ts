import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { formaterDuree, formaterNombre } from "../../lib/format";
import { verifierEnvironnement } from "../garde-environnement";
import {
  avecBase,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";

// Story 5.5 — bloc « Demandes expirées » de la page Données personnelles
// (navigateur), ordinateur et téléphone. Critère 1 : « N demandes sont
// traitées depuis plus de [durée]. », N calculé en base avec la même règle
// (données d'essai : demandes traitées il y a plus de 2 ans). Fenêtre de
// confirmation : texte précis, « Annuler » sélectionné, puis ANNULER.
// Critère 3 : à 0, « Aucune demande expirée. » et bouton désactivé.
//
// La base est partagée : ce test ne lance JAMAIS une vraie suppression (elle
// toucherait toutes les demandes expirées de nova-dev, données d'essai
// comprises) et ne change pas la durée réglée. La suppression elle-même est
// vérifiée par tests/story-5-5/base.test.ts, dans des transactions annulées.
// Nécessite la migration 20261103000034 appliquée sur nova-dev.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const CHEMIN = "/equipe/admin/donnees";
const LIBELLE = "Supprimer les demandes expirées";

const comptes: CompteTest[] = [];

test.beforeAll(() => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
});

test.afterAll(async () => {
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
});

test.beforeEach(async ({ context }) => {
  await utiliserIpDeTest(context);
});

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.5", ...options });
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

const fenetre = (page: Page) => page.getByRole("alertdialog");
const bloc = (page: Page) => page.getByRole("region", { name: "Demandes expirées" });
const nombreAffiche = (page: Page) => page.getByTestId("nombre-expirees");

async function sansViolationAxe(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Demandes expirées selon la règle (Traitées depuis plus que la durée réglée), lues en base. */
async function expireesEnBase(): Promise<{ nombre: number; dureeMois: number; references: string[] }> {
  return avecBase(async (base) => {
    const { rows } = await base.query<{ duree: number; references: string[] }>(
      `select p.duree_conservation_mois as duree,
              coalesce(array_agg(d.reference order by d.reference)
                         filter (where d.reference is not null), '{}') as references
         from public.parametres p
         left join public.demandes d
           on d.statut = 'traitee'
          and d.traitee_le < now() - make_interval(months => p.duree_conservation_mois)
        group by p.duree_conservation_mois`,
    );
    return { nombre: rows[0].references.length, dureeMois: rows[0].duree, references: rows[0].references };
  });
}

test.describe("story 5.5 — demandes expirées", () => {
  test("critères 1 et 3 : nombre annoncé, fenêtre de confirmation puis Annuler (rien n'est supprimé)", async ({
    page,
  }) => {
    const admin = await compte({ role: "administrateur", prenom: "Claire" });
    const attendu = await expireesEnBase();

    await seConnecter(page, admin, CHEMIN);
    await expect(page.getByRole("heading", { level: 1, name: "Données personnelles" })).toBeVisible(NAVIGATION);
    await expect(bloc(page)).toBeVisible();
    await expect(bloc(page).getByRole("heading", { level: 2, name: "Demandes expirées" })).toBeVisible();
    const bouton = bloc(page).getByRole("button", { name: LIBELLE, exact: true });

    // Sous le bloc d'effacement.
    const hauts = await page
      .getByRole("heading", { level: 2 })
      .evaluateAll((titres) => titres.map((t) => t.textContent));
    expect(hauts.indexOf("Demandes expirées")).toBeGreaterThan(hauts.indexOf("Droit à l'effacement"));

    if (attendu.nombre === 0) {
      // Critère 3 : aucune demande expirée.
      await expect(nombreAffiche(page)).toHaveText("Aucune demande expirée.");
      await expect(bouton).toBeDisabled();
      await sansViolationAxe(page);
      return;
    }

    // Critère 1 : le nombre de la règle, avec la durée réglée.
    const duree = formaterDuree(attendu.dureeMois);
    const texte =
      attendu.nombre === 1
        ? `1 demande est traitée depuis plus de ${duree}.`
        : `${formaterNombre(attendu.nombre)} demandes sont traitées depuis plus de ${duree}.`;
    await expect(nombreAffiche(page)).toHaveText(texte);
    await expect(bouton).toBeEnabled();
    await sansViolationAxe(page);

    // Fenêtre : texte précis, « Annuler » à gauche et sélectionné.
    await bouton.click();
    await expect(fenetre(page)).toBeVisible();
    await expect(fenetre(page).getByRole("heading", { name: LIBELLE })).toBeVisible();
    await expect(fenetre(page)).toContainText(
      attendu.nombre === 1
        ? `1 demande traitée depuis plus de ${duree} va être supprimée définitivement, avec son historique et ses notes. Cette action ne peut pas être annulée.`
        : `${formaterNombre(attendu.nombre)} demandes traitées depuis plus de ${duree} vont être supprimées définitivement, avec leur historique et leurs notes. Cette action ne peut pas être annulée.`,
    );
    const annuler = fenetre(page).getByRole("button", { name: "Annuler" });
    const confirmer = fenetre(page).getByRole("button", { name: LIBELLE });
    await expect(annuler).toBeFocused();
    const [boiteAnnuler, boiteConfirmer] = [await annuler.boundingBox(), await confirmer.boundingBox()];
    if (boiteAnnuler && boiteConfirmer && boiteAnnuler.y === boiteConfirmer.y) {
      expect(boiteAnnuler.x).toBeLessThan(boiteConfirmer.x);
    }
    await sansViolationAxe(page);

    // Annuler : rien n'est supprimé, le bloc est inchangé.
    await annuler.click();
    await expect(fenetre(page)).toHaveCount(0);
    await expect(nombreAffiche(page)).toHaveText(texte);
    await expect(page.getByTestId("toast")).toHaveCount(0);
    const apres = await expireesEnBase();
    expect(apres.references).toEqual(expect.arrayContaining(attendu.references));
  });
});
