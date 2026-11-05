import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { verifierEnvironnement } from "../garde-environnement";
import { avecBase, creerCompteTest, supprimerComptesTest, type CompteTest } from "../outils/comptes";
import { utiliserIpDeTest } from "../outils/ip-test";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "../outils/demandes";

// Story 2.2 — ajouter une note interne (navigateur). Nécessite la migration
// 20261103000015 appliquée sur nova-dev.
// Critères 1 à 3 d'epics.md : note avec nom, date et heure, toast « Note
// ajoutée. », ligne d'historique, sans recharger la page ; zone vide → « Écrivez
// le texte de la note. » sans appel ; « Aucune note interne. ». Texte piégé
// affiché tel quel. Contrôle axe. Ordinateur et téléphone.
// Base partagée : comptes et demandes `TEST-2.2-…`, effacés à la fin.

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const PREFIXE = `TEST-2.2-${randomUUID().slice(0, 8)}`;
const APRES_CONNEXION = { timeout: 15_000 };
const NAVIGATION = { timeout: 15_000 };
const LIBELLE_ZONE = "Ajouter une note (visible uniquement par l'équipe)";

let karim: CompteTest; // collaborateur

test.beforeAll(async () => {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.2" });
});

test.afterAll(async () => {
  // Demandes d'abord (notes et historique citent le compte).
  let demandesNettoyees = false;
  try {
    await avecBase((base) => supprimerDemandesTest(base, PREFIXE));
    demandesNettoyees = true;
  } catch (erreur) {
    console.error(`Nettoyage des demandes de test impossible : ${String(erreur)}`);
  } finally {
    if (demandesNettoyees && karim) await supprimerComptesTest([karim]);
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
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const resultats = await new AxeBuilder({ page }).analyze();
  expect(resultats.violations).toEqual([]);
}

/** Compte les appels d'actions serveur ; `delai` les ralentit (état « Ajout… »). */
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

function blocNotes(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Notes internes" }) });
}

/** « 03/11/2026 à 09:16 » à l'heure de Paris, pour une date donnée. */
function heureParis(date: Date): string {
  const jour = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const heure = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${jour} à ${heure}`;
}

test.describe("ajouter une note interne", () => {
  test("critère 3 puis 1 : « Aucune note interne. », puis note avec nom, date et heure, toast, historique, sans recharger", async ({
    page,
  }) => {
    const d = await demande({ statut: "en_cours", responsableId: karim.id });
    await ouvrir(page, d);

    // Bloc placé entre Demandeur et Historique.
    const titres = await page.getByRole("heading", { level: 2 }).allTextContents();
    expect(titres.indexOf("Notes internes")).toBe(titres.indexOf("Demandeur") + 1);
    expect(titres.indexOf("Historique")).toBe(titres.indexOf("Notes internes") + 1);

    // Critère 3.
    const bloc = blocNotes(page);
    await expect(bloc.getByText("Aucune note interne.")).toBeVisible();
    await expect(page.getByTestId("historique").locator("li")).toHaveCount(1);

    // Repère posé dans la page : il disparaîtrait si la page était rechargée.
    await page.evaluate(() => {
      (window as unknown as { __sansRechargement?: boolean }).__sansRechargement = true;
    });

    const zone = page.getByLabel(LIBELLE_ZONE);
    await zone.fill("Rappelée à 9 h");
    await expect(bloc.getByTestId("compteur-note")).toHaveText(/^14 \/ 2\s000$/);

    await suivreActions(page, 1_000);
    const avant = Date.now();
    await bloc.getByRole("button", { name: "Ajouter la note" }).click();
    const enCours = bloc.getByRole("button", { name: "Ajout…" });
    await expect(enCours).toBeVisible();
    await expect(enCours).toBeDisabled();

    // Critère 1 : toast, note avec nom, date et heure ; zone vidée.
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText("Note ajoutée.", NAVIGATION);
    const notes = bloc.getByTestId("note");
    await expect(notes).toHaveCount(1);
    await expect(notes.first().getByTestId("texte-note")).toHaveText("Rappelée à 9 h");
    const entete = (await notes.first().locator("p").first().textContent()) ?? "";
    // Minute de l'ajout (ou la suivante, si l'appel a franchi la minute).
    const attendus = [avant, avant + 60_000].map((t) => `${karim.nom} · ${heureParis(new Date(t))}`);
    expect(attendus).toContain(entete);
    await expect(zone).toHaveValue("");
    await expect(bloc.getByText("Aucune note interne.")).toHaveCount(0);

    // Ligne d'historique, sans le texte de la note.
    const lignes = page.getByTestId("historique").locator("li");
    await expect(lignes).toHaveCount(2);
    await expect(lignes.nth(1)).toContainText(`${karim.nom} a ajouté une note interne`);
    await expect(page.getByTestId("historique")).not.toContainText("Rappelée");

    expect(
      await page.evaluate(() => (window as unknown as { __sansRechargement?: boolean }).__sansRechargement),
    ).toBe(true);

    // Aucun moyen de modifier ou de supprimer une note.
    await expect(bloc.getByRole("button", { name: /Modifier|Supprimer/ })).toHaveCount(0);

    await sansViolationAxe(page);
  });

  test("critère 2 : zone vide ou espaces seulement → « Écrivez le texte de la note. », focus, rien d'envoyé", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, d);
    const appels = await suivreActions(page);
    const bloc = blocNotes(page);
    const zone = page.getByLabel(LIBELLE_ZONE);
    const bouton = bloc.getByRole("button", { name: "Ajouter la note" });

    await bouton.click();
    await expect(bloc.getByText("Écrivez le texte de la note.")).toBeVisible();
    await expect(zone).toBeFocused();
    await expect(zone).toHaveAttribute("aria-invalid", "true");

    await zone.fill("   \n  ");
    await expect(bloc.getByText("Écrivez le texte de la note.")).toHaveCount(0);
    await bouton.click();
    await expect(bloc.getByText("Écrivez le texte de la note.")).toBeVisible();
    await expect(zone).toBeFocused();

    expect(appels.nombre).toBe(0);
    await expect(bloc.getByText("Aucune note interne.")).toBeVisible();
    await expect(page.getByTestId("historique").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("toast")).toHaveCount(0);

    await sansViolationAxe(page);
  });

  test("double clic sur « Ajouter la note » : un seul appel, une seule note ; zone en lecture seule pendant l'envoi", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, d);
    const appels = await suivreActions(page, 1_000);
    const bloc = blocNotes(page);
    const zone = page.getByLabel(LIBELLE_ZONE);
    await zone.fill("Note envoyée une fois");
    await bloc.getByRole("button", { name: "Ajouter la note" }).dblclick();
    await expect(zone).toHaveAttribute("readonly", "");
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText("Note ajoutée.", NAVIGATION);
    await expect(bloc.getByTestId("note")).toHaveCount(1);
    await expect(zone).not.toHaveAttribute("readonly", "");
    expect(appels.nombre).toBe(1);
    await expect(page.getByTestId("historique").locator("li")).toHaveCount(2);
  });

  test("plus de 2 000 caractères : message sous la zone dès le dépassement, relié à la zone, rien d'envoyé", async ({
    page,
  }) => {
    const d = await demande();
    await ouvrir(page, d);
    const appels = await suivreActions(page);
    const bloc = blocNotes(page);
    const zone = page.getByLabel(LIBELLE_ZONE);
    const message = bloc.getByTestId("erreur-note");

    await zone.fill("a".repeat(2000));
    await expect(message).toHaveCount(0);
    await zone.fill("a".repeat(2001));
    await expect(message).toHaveText(/^La note ne doit pas dépasser 2\s000 caractères\.$/);
    await expect(bloc.getByTestId("compteur-note")).toHaveText(/^2\s001 \/ 2\s000$/);
    await expect(zone).toHaveAttribute("aria-invalid", "true");
    const decrit = (await zone.getAttribute("aria-describedby")) ?? "";
    const idMessage = await message.locator("..").getAttribute("id");
    expect(decrit.split(" ")).toContain(idMessage);
    await expect(message.locator("..")).toHaveAttribute("aria-live", "polite");

    await bloc.getByRole("button", { name: "Ajouter la note" }).click();
    await expect(zone).toBeFocused();
    expect(appels.nombre).toBe(0);
    await expect(bloc.getByText("Aucune note interne.")).toBeVisible();

    // Revenu sous la limite : le message disparaît.
    await zone.fill("a".repeat(2000));
    await expect(message).toHaveCount(0);
  });

  test("texte piégé sur une demande Traitée : affiché tel quel, retours à la ligne conservés, aucun script exécuté", async ({
    page,
  }) => {
    const d = await demande({ statut: "traitee" });
    await ouvrir(page, d);
    const dialogues: string[] = [];
    page.on("dialog", async (dialogue) => {
      dialogues.push(dialogue.message());
      await dialogue.dismiss();
    });

    const texte = "Ligne 1\n<script>alert('piège')</script>\n<img src=x onerror=alert(1)>";
    const bloc = blocNotes(page);
    await page.getByLabel(LIBELLE_ZONE).fill(texte);
    await bloc.getByRole("button", { name: "Ajouter la note" }).click();
    await expect(page.getByRole("status").getByTestId("toast")).toHaveText("Note ajoutée.", NAVIGATION);

    const affiche = bloc.getByTestId("texte-note");
    await expect(affiche).toHaveCount(1);
    expect(await affiche.innerText()).toBe(texte);
    await expect(affiche.locator("script, img")).toHaveCount(0);
    expect(dialogues).toEqual([]);
  });

  test("réseau coupé pendant l'ajout : toast d'erreur rouge, texte conservé", async ({ page }) => {
    const d = await demande();
    await ouvrir(page, d);
    await page.route("**/equipe/demandes/**", async (route) => {
      const requete = route.request();
      if (requete.method() === "POST" && (await requete.headerValue("next-action"))) {
        await route.abort("internetdisconnected");
      } else {
        await route.continue();
      }
    });

    const bloc = blocNotes(page);
    const zone = page.getByLabel(LIBELLE_ZONE);
    await zone.fill("Note à garder");
    await bloc.getByRole("button", { name: "Ajouter la note" }).click();
    await expect(page.getByRole("alert").getByTestId("toast")).toHaveText(
      "Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant.",
      NAVIGATION,
    );
    await expect(zone).toHaveValue("Note à garder");
    await expect(bloc.getByRole("button", { name: "Ajouter la note" })).toBeEnabled();
    await expect(bloc.getByText("Aucune note interne.")).toBeVisible();
  });
});
