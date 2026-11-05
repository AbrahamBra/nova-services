// Choix du projet Supabase visé par un script (story 3.1).
//   sans --production : .env.local (et les autres fichiers .env de Next.js),
//                       qui doit indiquer SUPABASE_ENVIRONNEMENT=developpement ;
//   avec --production : UNIQUEMENT .env.scripts-production.local (exclu de Git
//                       par la règle `.env*` ; nom que Next.js ne charge
//                       jamais tout seul), qui doit indiquer
//                       SUPABASE_ENVIRONNEMENT=production. .env.local n'est
//                       jamais lu dans ce cas.
// Les variables du projet déjà posées dans le terminal (SUPABASE_*,
// NEXT_PUBLIC_SUPABASE_*, HMAC_SECRET) sont effacées d'abord : la valeur
// vérifiée vient du fichier (en développement, dès que .env.local existe).
// Fermé par défaut : au moindre doute, le script s'arrête avant toute
// connexion. Aucune valeur n'est jamais affichée.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import nextEnv from "@next/env";

export const OPTION_PRODUCTION = "--production";
export const FICHIER_PRODUCTION = ".env.scripts-production.local";

/** Variables obligatoires dans le fichier de production. */
export const VARIABLES_PRODUCTION_OBLIGATOIRES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_URL",
];

/** Variables qui désignent un projet ou en dépendent (CLI Supabase comprise). */
export function estVariableDuProjet(nom) {
  return nom.startsWith("SUPABASE_") || nom.startsWith("NEXT_PUBLIC_SUPABASE_") || nom === "HMAC_SECRET";
}

function effacerVariablesDuProjet(env) {
  for (const nom of Object.keys(env)) if (estVariableDuProjet(nom)) delete env[nom];
}

const decrire = (valeur) => (valeur ? `« ${valeur} »` : "(absent)");

/**
 * Repère une option de production mal écrite (sinon ignorée en silence).
 * @param {string[]} args arguments après le nom du script
 * @param {string} nomScript
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} message de refus, ou null
 */
export function optionMalEcrite(nomScript, args, env) {
  const correction = `Écrivez : npm run ${nomScript} -- ${OPTION_PRODUCTION}`;
  // `npm run x --production` (sans `--`) : npm garde l'option pour lui.
  if (env.npm_config_production !== undefined && env.npm_config_production !== "") {
    return `${nomScript} refusé : l'option --production a été lue par npm, pas par le script. ${correction}`;
  }
  const douteuse = args.find(
    (arg) => arg !== OPTION_PRODUCTION && /^-{1,2}prod/i.test(arg),
  );
  if (douteuse) {
    return `${nomScript} refusé : option « ${douteuse} » non reconnue. ${correction}`;
  }
  return null;
}

/**
 * Lit l'environnement demandé, sans rien modifier.
 * @param {{ racine: string, production: boolean, nomScript: string }} options
 * @returns {{ ok: true, environnement: string, variables: Record<string, string> | null }
 *   | { ok: false, message: string }}
 *   `variables` vaut null en développement (chargé par @next/env).
 */
export function lireEnvironnement({ racine, production, nomScript }) {
  if (!production) {
    return { ok: true, environnement: "developpement", variables: null };
  }

  const chemin = join(racine, FICHIER_PRODUCTION);
  if (!existsSync(chemin)) {
    return {
      ok: false,
      message: `${nomScript} refusé : ${FICHIER_PRODUCTION} est introuvable. Créez-le à la racine du projet avec les valeurs du projet Supabase de production (voir docs/exploitation/deploiement.md).`,
    };
  }

  let variables;
  try {
    variables = parseEnv(readFileSync(chemin, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, message: `${nomScript} refusé : ${FICHIER_PRODUCTION} est illisible.` };
  }

  if (variables.SUPABASE_ENVIRONNEMENT !== "production") {
    return {
      ok: false,
      message: `${nomScript} refusé : dans ${FICHIER_PRODUCTION}, SUPABASE_ENVIRONNEMENT vaut ${decrire(
        variables.SUPABASE_ENVIRONNEMENT,
      )} au lieu de « production ».`,
    };
  }

  const manquantes = VARIABLES_PRODUCTION_OBLIGATOIRES.filter((nom) => !variables[nom]?.trim());
  if (manquantes.length > 0) {
    return {
      ok: false,
      message: `${nomScript} refusé : dans ${FICHIER_PRODUCTION}, variable(s) vide(s) ou absente(s) : ${manquantes.join(", ")}.`,
    };
  }

  return { ok: true, environnement: "production", variables };
}

/**
 * Charge l'environnement dans process.env, ou arrête le script.
 * @param {string} nomScript
 * @param {{ productionPermise?: boolean, argv?: string[], racine?: string }} [options]
 * @returns {"developpement" | "production"}
 */
export function chargerEnvironnement(nomScript, options = {}) {
  const { productionPermise = false, argv = process.argv, racine = process.cwd() } = options;
  const args = argv.slice(2);

  const malEcrite = optionMalEcrite(nomScript, args, process.env);
  if (malEcrite) {
    console.error(malEcrite);
    process.exit(1);
  }

  const production = args.includes(OPTION_PRODUCTION);
  if (production && !productionPermise) {
    console.error(
      `${nomScript} refusé : option ${OPTION_PRODUCTION} non permise, ce script ne tourne jamais sur la production.`,
    );
    process.exit(1);
  }

  const resultat = lireEnvironnement({ racine, production, nomScript });
  if (!resultat.ok) {
    console.error(resultat.message);
    process.exit(1);
  }

  if (resultat.variables) {
    effacerVariablesDuProjet(process.env);
    Object.assign(process.env, resultat.variables);
    return "production";
  }

  // Développement : si .env.local existe, c'est lui qui fait foi (@next/env
  // ne remplace jamais une variable déjà posée dans le terminal). Sans
  // .env.local (tâche « Tests » de GitHub), les variables viennent des
  // secrets GitHub, posés dans l'environnement.
  if (existsSync(join(racine, ".env.local"))) effacerVariablesDuProjet(process.env);
  nextEnv.loadEnvConfig(racine, true, { info: () => {}, error: console.error });
  const environnement = process.env.SUPABASE_ENVIRONNEMENT;
  if (environnement !== "developpement") {
    console.error(
      `${nomScript} refusé : SUPABASE_ENVIRONNEMENT vaut ${decrire(
        environnement,
      )} au lieu de « developpement ». Vérifiez .env.local. Pour viser volontairement la production : npm run ${nomScript} -- ${OPTION_PRODUCTION} (si ce script le permet).`,
    );
    process.exit(1);
  }
  return "developpement";
}
