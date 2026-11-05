// Mesure de la liste filtrée (story 2.5, NFR-7) sur le projet de DÉVELOPPEMENT.
//   npm run mesure:liste
// Avec la session de TEST-Collaborateur (TEST_COLLAB_EMAIL et
// TEST_COLLAB_MOT_DE_PASSE de .env.local, créés par `npm run comptes:test`),
// lit la première page de la liste par le même chemin que la page
// (lib/demandes.ts → lib/filtres.ts → vue `demandes_liste` ou
// `rechercher_demandes`), pour plusieurs combinaisons de recherche et de
// filtres. Chaque lecture est faite 3 fois ; le temps retenu est le plus
// long. Attendu : moins de 2 secondes (code de sortie 1 au-delà).
// À lancer après `npm run donnees:charge` (2 000 demandes), puis effacer la
// charge (`npm run donnees:charge -- --vider`). Jamais dans la CI.
// Refusé hors du projet de développement.

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { clientPubliable, preparerEnvironnement } from "./commun.ts";

preparerEnvironnement("mesure:liste");

// Les fichiers de lib/ importent avec l'alias « @/ » de tsconfig.json, que
// Node ne connaît pas : il est traduit ici vers les fichiers du projet. Les
// modules de Next.js sans table d'exports (`next/headers`) sont repris avec
// leur extension `.js`.
registerHooks({
  resolve(specifier, context, suivant) {
    if (specifier.startsWith("@/")) {
      const chemin = join(process.cwd(), specifier.slice(2));
      for (const fin of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(chemin + fin)) return suivant(pathToFileURL(chemin + fin).href, context);
      }
    }
    try {
      return suivant(specifier, context);
    } catch (erreur) {
      if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
        return suivant(`${specifier}.js`, context);
      }
      throw erreur;
    }
  },
});

const LIMITE_MS = 2000;
const ESSAIS = 3;

type Scenario = { titre: string; filtres: Record<string, string>; page?: number };

const SCENARIOS: Scenario[] = [
  { titre: "Sans filtre", filtres: {} },
  { titre: "Recherche « dupont »", filtres: { q: "dupont" } },
  // Très large : une seule lettre, presque toutes les demandes.
  { titre: "Recherche « e » (très large)", filtres: { q: "e" } },
  // Page au-delà de la fin : ramenée à la dernière page (deux lectures).
  { titre: "Recherche « e », page au-delà de la fin", filtres: { q: "e" }, page: 1_000_000 },
  {
    titre: "Recherche « aidi » + Non traitées + Haute",
    filtres: { q: "aidi", statut: "non_traitees", priorite: "haute" },
  },
  {
    titre: "Recherche « charge » + En cours + Mes demandes + Formulaire",
    filtres: { q: "charge", statut: "en_cours", responsable: "moi", canal: "formulaire" },
  },
  {
    titre: "Non traitées + Sans responsable",
    filtres: { statut: "non_traitees", responsable: "aucun" },
  },
  { titre: "Traitée + Basse + Email", filtres: { statut: "traitee", priorite: "basse", canal: "email" } },
];

async function principal() {
  const email = process.env.TEST_COLLAB_EMAIL;
  const motDePasse = process.env.TEST_COLLAB_MOT_DE_PASSE;
  if (!email || !motDePasse) {
    throw new Error("TEST_COLLAB_EMAIL ou TEST_COLLAB_MOT_DE_PASSE manquant dans .env.local : lancez npm run comptes:test.");
  }

  const { lireDemandesAvec } = await import("../lib/demandes.ts");
  const { lireFiltres } = await import("../lib/filtres.ts");

  const client = clientPubliable();
  const { error } = await client.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw new Error(`Connexion de TEST-Collaborateur impossible (${error.code ?? error.status}).`);

  try {
    const charge = await lireDemandesAvec(client, 1, { q: "TEST-charge-" });
    if (!charge.ok) {
      throw new Error(`Lecture de la charge impossible (${charge.code}) : migrations 0018 et 0019 appliquées ?`);
    }
    const nombreCharge = charge.donnees.total;
    console.log(`Demandes de charge visibles : ${nombreCharge}.`);
    if (nombreCharge < 2000) {
      console.log("Attention : moins de 2 000 demandes de charge. Lancez d'abord npm run donnees:charge.");
    }

    let depassement = false;
    for (const scenario of SCENARIOS) {
      const filtres = lireFiltres(scenario.filtres);
      let pire = 0;
      let total = 0;
      let pageLue = 1;
      for (let essai = 0; essai < ESSAIS; essai++) {
        const debut = performance.now();
        const resultat = await lireDemandesAvec(client, scenario.page ?? 1, filtres);
        const duree = performance.now() - debut;
        if (!resultat.ok) throw new Error(`Lecture impossible : ${scenario.titre} (${resultat.code}).`);
        total = resultat.donnees.total;
        pageLue = resultat.donnees.page;
        pire = Math.max(pire, duree);
      }
      const ok = pire < LIMITE_MS;
      if (!ok) depassement = true;
      console.log(
        `${ok ? "OK " : "LENT"} ${String(Math.round(pire)).padStart(5)} ms  ${scenario.titre} (${total} demandes${scenario.page ? `, page ${pageLue}` : ""})`,
      );
    }
    console.log(
      depassement
        ? `Au moins une lecture dépasse ${LIMITE_MS} ms.`
        : `Toutes les lectures filtrées sous ${LIMITE_MS} ms (pire de ${ESSAIS} essais).`,
    );
    if (depassement) process.exitCode = 1;
  } finally {
    await client.auth.signOut({ scope: "local" }).catch(() => {});
  }
}

principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : "Erreur inattendue.");
  process.exit(1);
});
