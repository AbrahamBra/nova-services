import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Story 3.4 — contenu de la tâche « Restauration de test » (OPS-4, AD-12,
// AD-30). Décision d'Abraham (06/11/2026) : restauration dans une base
// jetable de la machine GitHub, jamais dans nova-dev ni en production.

const racine = fileURLToPath(new URL("../../", import.meta.url));
// Fins de ligne normalisées : avec core.autocrlf, les fichiers peuvent être en CRLF.
const lire = (chemin: string) =>
  readFileSync(racine + chemin, "utf8").replace(/\r\n/g, "\n");

const tache = lire(".github/workflows/restauration-test.yml");
const configuration = lire("supabase/config.toml");
const paquet = JSON.parse(lire("package.json")) as {
  devDependencies?: Record<string, string>;
};

/** Lignes de commandes et de réglages, sans les commentaires. */
const code = tache
  .split("\n")
  .filter((ligne) => !ligne.trim().startsWith("#"))
  .join("\n");

const position = (texte: string) => {
  const i = code.indexOf(texte);
  expect(i, texte).toBeGreaterThan(-1);
  return i;
};

describe("tâche « Restauration de test »", () => {
  it("porte le nom affiché « Restauration de test » et ne se lance qu'à la main", () => {
    expect(tache).toMatch(/^name: Restauration de test$/m);
    expect(code).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(code).not.toMatch(/^ {2}(schedule|push|pull_request|workflow_run):/m);
  });

  it("n'a que les droits de lire les tâches et le dépôt", () => {
    expect(code).toMatch(/^permissions:\n {2}actions: read\n {2}contents: read\n\n/m);
    expect(code).toMatch(/^concurrency:\n {2}group: restauration-test\n/m);
  });

  it("n'utilise aucun secret de base : seulement la phrase et le jeton GitHub", () => {
    const secrets = [...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(secrets).toEqual(["SAUVEGARDE_PHRASE"]);
    expect(code).toContain("GH_TOKEN: ${{ github.token }}");
    expect(code).not.toMatch(/DB_URL \}\}|SUPABASE_DB_URL|PROD_|DEV_/);
    expect(code).not.toMatch(/postgres(ql)?:\/\/[^"'\s]*@/);
    expect(code).not.toMatch(/sb_(secret|publishable)_/);
    expect(code).not.toMatch(/--passphrase[ =]/);
    expect(code).not.toContain("db push");
    expect(code).not.toContain("--linked");
  });

  it("refuse une phrase absente, trop courte ou sur plusieurs lignes avant tout téléchargement", () => {
    expect(code).toContain('if [ -z "$SAUVEGARDE_PHRASE" ]');
    expect(code).toContain('if [ "${#SAUVEGARDE_PHRASE}" -lt 32 ]');
    expect(code).toContain(String.raw`*$'\n'*`);
    expect(position("Phrase de chiffrement absente")).toBeLessThan(position("gh run download"));
  });

  it("prend le dernier fichier de production réussi de « Sauvegarde nocturne », ou l'exécution donnée", () => {
    expect(code).toContain("--workflow sauvegarde-nocturne.yml");
    expect(code).toContain("--status success");
    expect(code).toContain('startswith("sauvegarde-production-")');
    expect(code).toContain("select(.expired == false)");
    expect(code).toContain('".github/workflows/sauvegarde-nocturne.yml success"');
    // Entrée passée par une variable, jamais recopiée dans le script.
    expect(code).toContain("EXECUTION: ${{ inputs.execution }}");
    expect(code).toContain('[[ ! "$EXECUTION" =~ ^[0-9]+$ ]]');
    expect(code).toContain("Aucune sauvegarde de production disponible");
  });

  it("vérifie et déchiffre avec la phrase passée par un fichier, sans l'afficher", () => {
    expect(code).toContain("printf '%s' \"$SAUVEGARDE_PHRASE\" > \"$phrase\"");
    expect(code).toContain('--passphrase-file "$phrase"');
    expect(code).not.toMatch(/gpg[^\n]*\$SAUVEGARDE_PHRASE/);
    expect(code).toContain("'^:symkey enc packet:'");
    expect(code).toContain("--no-symkey-cache");
    expect(code).toContain("Déchiffrement impossible : phrase fausse");
    expect(position("Déchiffrement impossible")).toBeLessThan(position("supabase start"));
  });

  it("démarre une base locale jetable, sans les migrations du dépôt ni seed.sql", () => {
    expect(code).not.toContain("actions/checkout");
    expect(code).toContain("uses: supabase/setup-cli@v1");
    expect(/version: (\d+\.\d+\.\d+)/.exec(code)?.[1]).toBe(
      paquet.devDependencies?.supabase?.replace(/^[~^]/, ""),
    );
    // Même version de PostgreSQL que supabase/config.toml.
    const versionDepot = /^major_version = (\d+)$/m.exec(configuration)?.[1];
    expect(versionDepot).toBeDefined();
    expect(code).toMatch(new RegExp(String.raw`^\s*major_version = ${versionDepot}$`, "m"));
    expect(code).toMatch(/\[db\.seed\]\n\s*enabled = false/);
    expect(code).toContain('supabase start --workdir "$projet"');
    // Garde-fou : adresse locale seulement.
    expect(code).toContain(String.raw`(127\.0\.0\.1|localhost)`);
  });

  it("restaure rôles, structure puis données en une transaction, arrêt à la première erreur", () => {
    const restauration = /psql [^]*?--dbname "\$BASE_JETABLE"/.exec(code)?.[0] ?? "";
    expect(restauration).toContain("--single-transaction");
    expect(restauration).toContain("--variable ON_ERROR_STOP=1");
    expect(restauration).toContain("--variable VERBOSITY=sqlstate");
    const roles = restauration.indexOf("roles.sql");
    const structure = restauration.indexOf("structure.sql");
    const replica = restauration.indexOf("SET session_replication_role = replica");
    const donnees = restauration.indexOf("donnees.sql");
    expect(roles).toBeGreaterThan(-1);
    expect(roles).toBeLessThan(structure);
    expect(structure).toBeLessThan(replica);
    expect(replica).toBeLessThan(donnees);
  });

  it("rejoue les effacements après la restauration", () => {
    expect(code).toContain("select public.rejouer_effacements()");
    expect(position("--single-transaction")).toBeLessThan(
      position("select public.rejouer_effacements()"),
    );
  });

  it("compare les nombres et publie le rapport, en rouge s'ils diffèrent", () => {
    expect(code).toContain("Comparer et publier le rapport");
    expect(code).toMatch(/Comparer et publier le rapport\n\s+if: always\(\)/);
    for (const ligne of [
      "Demandes dans donnees.sql",
      "Demandes restaurées",
      "Membres dans donnees.sql / restaurés",
      "Comptes dans donnees.sql / restaurés",
      "Historique dans donnees.sql / restauré",
      "Notes dans donnees.sql / restaurées",
      "Demandes effacées à nouveau (rejouer_effacements)",
      "Durée (s)",
      "Durée totale",
    ]) {
      expect(code).toContain(ligne);
    }
    expect(code).toContain('[ "$DEMANDES_FICHIER" = "$DEMANDES_RESTAUREES" ]');
    expect(code).toContain('[ "$HISTORIQUE_FICHIER" = "$HISTORIQUE_RESTAURE" ]');
    expect(code).toContain('[ "$NOTES_FICHIER" = "$NOTES_RESTAUREES" ]');
    for (const table of ["public.demandes", "public.historique", "public.notes", "public.membres", "auth.users"]) {
      expect(code).toMatch(new RegExp(`compter_table ${table.replace(".", String.raw`\.`)} `));
    }
    // En-têtes COPY avec ou sans guillemets.
    expect(code).toContain(String.raw`entete2 = "COPY \"" schema "\".\"" table "\" "`);
    expect(code).toMatch(/Nombres différents :\$ecart"\n\s+exit 1/);
  });

  it("une erreur de psql fait échouer l'étape ; fonction absente : message dédié", () => {
    expect(code).not.toMatch(/echo "[a-z]+=\$\(requete/);
    expect(code).toContain(
      "Fonction rejouer_effacements absente : la migration 0027 n'était pas appliquée en production au moment de cette sauvegarde.",
    );
    expect(position("to_regprocedure('public.rejouer_effacements()')")).toBeLessThan(
      position("select public.rejouer_effacements()"),
    );
  });

  it("chemins temporaires posés dans la première étape (runner.temp absent au niveau de la tâche)", () => {
    expect(code).not.toContain("${{ runner.temp }}");
    expect(code).toContain('echo "DUREES=$RUNNER_TEMP/durees" >> "$GITHUB_ENV"');
    expect(code).toContain('echo "DEBUT_RESTAURATION=$(date +%s)" >> "$GITHUB_ENV"');
  });

  it("numéro d'exécution inexistant : message de la procédure, pas l'erreur brute", () => {
    expect(code).toMatch(/2>\/dev\/null\) \|\| chemin=""/);
    expect(code).toContain("n'est pas une « Sauvegarde nocturne » réussie.");
  });

  it("ne publie aucun fichier et détruit la base et les fichiers en clair à la fin", () => {
    expect(code).not.toContain("actions/upload-artifact");
    expect(code).toMatch(/Détruire la base jetable et les fichiers en clair\n\s+if: always\(\)/);
    expect(code).toContain("--no-backup");
    expect(code).toContain('"$RUNNER_TEMP/restauration"');
  });
});
