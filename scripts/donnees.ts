// Données d'essai du projet de développement (story 1.5, AD-27).
//   npm run donnees:remplir   remplace les demandes d'essai par celles de
//                             supabase/essai/demandes-essai.sql
//   npm run donnees:vider     supprime les demandes dont l'objet ou le nom
//                             commence par « TEST- », avec leur historique
// Refusé hors du projet de développement (SUPABASE_ENVIRONNEMENT).
//
// À savoir :
//   - chaque `donnees:remplir` consomme de vrais numéros de référence
//     (compteur de l'année) : des trous dans la numérotation sont normaux ;
//   - `donnees:vider` supprime aussi les demandes `TEST-…` créées par des
//     tests qui tournent au même moment : ne pas le lancer pendant les tests.
// Connexion directe à la base (SUPABASE_DB_URL), dans une seule transaction :
// la clé secrète n'a aucun droit direct sur les tables (migration 0004).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { FORMAT_EMAIL, preparerEnvironnement } from "./commun.ts";

const ACTIONS = ["remplir", "vider"] as const;
type Action = (typeof ACTIONS)[number];

const action = process.argv[2] as Action;
if (!ACTIONS.includes(action)) {
  console.error("Usage : node scripts/donnees.ts remplir|vider");
  process.exit(1);
}

preparerEnvironnement(`donnees:${action}`);

// Seules les demandes d'essai : objet ou nom préfixé « TEST- » (AD-27).
// L'historique part en cascade.
const VIDER_TOUT = `delete from public.demandes where objet like 'TEST-%' or nom like 'TEST-%'`;
// Avant un nouveau remplissage : seulement les demandes du fichier d'essai
// (objet « TEST-… »), pas celles des tests automatiques en cours.
const VIDER_ESSAI = `delete from public.demandes where objet like 'TEST-%'`;

function emailDuCompte(variable: string, parDefaut: string): string {
  const email = (process.env[variable] || parDefaut).trim().toLowerCase();
  if (!FORMAT_EMAIL.test(email)) {
    throw new Error(`${variable} ne semble pas valide dans .env.local.`);
  }
  return email;
}

async function principal() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL manquant dans .env.local.");

  const base = new pg.Client({ connectionString: url });
  await base.connect();
  base.on("notice", (avis) => console.log(avis.message));
  try {
    await base.query("begin");
    if (action === "vider") {
      const { rowCount } = await base.query(VIDER_TOUT);
      await base.query("commit");
      console.log(`Demandes d'essai supprimées : ${rowCount ?? 0}.`);
      return;
    }

    const { rowCount } = await base.query(VIDER_ESSAI);
    if (rowCount) console.log(`Anciennes demandes d'essai remplacées : ${rowCount}.`);

    // Identifiants des comptes de test retrouvés par leur email (.env.local).
    await base.query("select set_config('nova.test_admin_email', $1, true)", [
      emailDuCompte("TEST_ADMIN_EMAIL", "test-admin@example.com"),
    ]);
    await base.query("select set_config('nova.test_collab_email', $1, true)", [
      emailDuCompte("TEST_COLLAB_EMAIL", "test-collaborateur@example.com"),
    ]);

    const seed = readFileSync(join(process.cwd(), "supabase", "essai", "demandes-essai.sql"), "utf8");
    await base.query(seed);
    await base.query("commit");
  } catch (erreur) {
    await base.query("rollback").catch(() => {});
    throw erreur;
  } finally {
    await base.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : "Erreur inattendue.");
  process.exit(1);
});
