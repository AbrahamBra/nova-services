import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const racine = fileURLToPath(new URL("../../", import.meta.url));
// Fins de ligne normalisées : avec core.autocrlf, les fichiers peuvent être en CRLF.
const lire = (chemin: string) =>
  readFileSync(racine + chemin, "utf8").replace(/\r\n/g, "\n");

const sauvegarde = lire(".github/workflows/sauvegarde-nocturne.yml");
const reveil = lire(".github/workflows/reveil.yml");
const paquet = JSON.parse(lire("package.json")) as {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

/** Lignes de commandes et de réglages, sans les commentaires. */
const sansCommentaires = (texte: string) =>
  texte
    .split("\n")
    .filter((ligne) => !ligne.trim().startsWith("#"))
    .join("\n");

/** Aucune adresse, clé ou phrase écrite en dur : seulement des `secrets.X`. */
function verifierAucunSecretEnDur(texte: string) {
  expect(texte).not.toMatch(/postgres(ql)?:\/\/[^"'\s]*@/);
  expect(texte).not.toMatch(/sb_(secret|publishable)_/);
  expect(texte).not.toMatch(/--passphrase[ =]/);
  expect(texte).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
}

describe("tâche « Sauvegarde nocturne » (OPS-3, AD-12)", () => {
  const code = sansCommentaires(sauvegarde);

  it("porte le nom affiché « Sauvegarde nocturne »", () => {
    expect(sauvegarde).toMatch(/^name: Sauvegarde nocturne$/m);
  });

  it("tourne chaque nuit à 2 h UTC, à la main, et à chaque modification de son fichier", () => {
    expect(code).toContain('cron: "0 2 * * *"');
    expect(code).toMatch(/^ {2}workflow_dispatch:/m);
    expect(code).toMatch(
      /^ {2}push:\n {4}paths:\n {6}- \.github\/workflows\/sauvegarde-nocturne\.yml\n/m,
    );
  });

  it("n'a que le droit de lire le dépôt et ne tourne qu'une fois à la fois", () => {
    expect(code).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(code).toMatch(/^concurrency:\n {2}group: sauvegarde-nocturne\n/m);
  });

  it("vise la production si son secret existe, sinon le développement", () => {
    expect(code).toContain("${{ secrets.PROD_SUPABASE_DB_URL }}");
    expect(code).toContain("${{ secrets.DEV_SUPABASE_DB_URL }}");
    expect(code).toMatch(/if \[ -n "\$PROD_DB_URL" \]; then\s+environnement=production/);
    expect(code).toMatch(/else\s+environnement=developpement/);
  });

  it("refuse une adresse qui n'est pas le pooler en mode session", () => {
    expect(code).toContain("*.pooler.supabase.com");
    expect(code).toContain('!= "5432"');
    expect(code).toContain("pooler en mode session attendu");
  });

  it("s'arrête avant tout export si la phrase de chiffrement est absente", () => {
    expect(code).toContain('if [ -z "$SAUVEGARDE_PHRASE" ]');
    expect(code).toContain("Phrase de chiffrement absente");
    const verification = code.indexOf("Phrase de chiffrement absente");
    const cible = code.indexOf("pooler en mode session attendu");
    const exportBase = code.indexOf("supabase db dump");
    expect(verification).toBeGreaterThan(-1);
    expect(verification).toBeLessThan(exportBase);
    expect(cible).toBeLessThan(exportBase);
  });

  it("refuse avant tout export une phrase de moins de 32 caractères ou sur plusieurs lignes", () => {
    expect(code).toContain('if [ "${#SAUVEGARDE_PHRASE}" -lt 32 ]');
    expect(code).toContain("Phrase de chiffrement trop courte : 32 caractères au minimum.");
    expect(code).toContain(String.raw`*$'\n'*`);
    expect(code).toContain("aucun retour à la ligne");
    const exportBase = code.indexOf("supabase db dump");
    expect(code.indexOf("trop courte")).toBeLessThan(exportBase);
    expect(code.indexOf("aucun retour à la ligne")).toBeLessThan(exportBase);
  });

  it("n'extrait pas le dépôt (aucune étape n'en a besoin)", () => {
    expect(code).not.toContain("actions/checkout");
  });

  it("utilise Supabase CLI 3.0, la même version que package.json", () => {
    expect(code).toContain("uses: supabase/setup-cli@v1");
    const version = /version: (\d+\.\d+\.\d+)/.exec(code)?.[1];
    expect(version).toBe("3.0.0");
    const declaree = paquet.devDependencies?.supabase ?? paquet.dependencies?.supabase;
    expect(declaree?.replace(/^[~^]/, "")).toBe(version);
  });

  it("exporte rôles, structure et données avec la syntaxe 3.0 (--remote=)", () => {
    expect(code).not.toContain("--db-url");
    const exports = code.match(/supabase db dump [^\n]*/g) ?? [];
    expect(exports).toHaveLength(3);
    for (const ligne of exports) expect(ligne).toContain('--remote="$adresse"');
    expect(exports.find((l) => l.includes("roles.sql"))).toContain("--role-only");
    const structure = exports.find((l) => l.includes("structure.sql"));
    expect(structure).not.toContain("--data-only");
    expect(structure).not.toContain("--role-only");
    expect(exports.find((l) => l.includes("donnees.sql"))).toMatch(/--data-only --use-copy/);
    // Chaque fichier doit être non vide.
    expect(code).toContain('if [ ! -s "$dossier/$fichier" ]');
  });

  it("chiffre une archive tar.gz en AES256, phrase passée par un fichier", () => {
    expect(code).toMatch(/tar -C "\$dossier" -czf - roles\.sql structure\.sql donnees\.sql/);
    expect(code).toContain("--symmetric --cipher-algo AES256");
    expect(code).toContain('--passphrase-file "$phrase"');
    expect(code).toContain("printf '%s' \"$SAUVEGARDE_PHRASE\" > \"$phrase\"");
    // La phrase n'est jamais un argument de programme.
    expect(code).not.toMatch(/gpg[^\n]*\$SAUVEGARDE_PHRASE/);
    // Les fichiers en clair sont supprimés juste après le chiffrement.
    const chiffrement = code.indexOf("--cipher-algo AES256");
    const suppression = code.indexOf('rm -rf "$dossier"');
    expect(suppression).toBeGreaterThan(chiffrement);
    expect(suppression).toBeLessThan(code.indexOf("actions/upload-artifact"));
  });

  it("vérifie le déchiffrement, le refus d'une mauvaise phrase et l'absence de SQL en clair", () => {
    expect(code).toContain("grep -a -q -e 'CREATE TABLE' -e 'COPY public.'");
    expect(code).toContain("--list-packets");
    expect(code).toContain("'^:symkey enc packet:'");
    expect(code).toContain("'^:(encrypted data|aead encrypted) packet:'");
    expect(code).toMatch(/if gpg [^]*?--passphrase-file "\$mauvaise" --decrypt/);
    expect(code).toContain("sha256sum --check");
    expect(code).toContain("--no-symkey-cache");
    // Les vérifications passent avant la publication.
    expect(code.indexOf("sha256sum --check")).toBeLessThan(
      code.indexOf("actions/upload-artifact"),
    );
  });

  it("publie seulement le fichier chiffré, sous un nom daté, pendant 30 jours", () => {
    expect(code).toContain(
      'artefact=sauvegarde-$environnement-$date_jour-$GITHUB_RUN_NUMBER-$GITHUB_RUN_ATTEMPT',
    );
    expect(code).toContain("date -u +%Y-%m-%d");
    const envois = code.match(/uses: actions\/upload-artifact@v4/g) ?? [];
    expect(envois).toHaveLength(1);
    expect(code).toContain("path: ${{ runner.temp }}/envoi/sauvegarde.tar.gz.gpg");
    expect(code).toContain("retention-days: 30");
  });

  it("n'écrit aucune valeur de secret en dur", () => {
    verifierAucunSecretEnDur(sauvegarde);
    expect(code).toContain("${{ secrets.SAUVEGARDE_PHRASE }}");
  });
});

describe("tâche « Réveil » (AD-12)", () => {
  const code = sansCommentaires(reveil);

  it("porte le nom « Réveil » et tourne chaque jour, à la main et à chaque modification", () => {
    expect(reveil).toMatch(/^name: Réveil$/m);
    expect(code).toContain('cron: "0 6 * * *"');
    expect(code).toMatch(/^ {2}workflow_dispatch:/m);
    expect(code).toMatch(/^ {2}push:\n {4}paths:\n {6}- \.github\/workflows\/reveil\.yml\n/m);
    expect(code).toMatch(/^permissions:\n {2}contents: read\n/m);
  });

  it("interroge le développement et la production", () => {
    expect(code).toMatch(/- environnement: developpement\n\s+secret: DEV_SUPABASE_DB_URL/);
    expect(code).toMatch(/- environnement: production\n\s+secret: PROD_SUPABASE_DB_URL/);
    expect(code).toContain("${{ secrets[matrix.secret] }}");
    expect(code).toContain("fail-fast: false");
  });

  it("envoie une vraie requête en lecture seule, sans afficher le résultat", () => {
    expect(code).toContain("begin read only; select count(*) from public.demandes; commit;");
    expect(code).toContain("ON_ERROR_STOP=1");
    expect(code).toContain('PGCONNECT_TIMEOUT: "10"');
    expect(code).toContain("PGSSLMODE: require");
    expect(code).toMatch(/commit;" > \/dev\/null/);
  });

  it("reste verte et le signale si la production n'est pas configurée", () => {
    expect(code).toContain("production non configurée");
    expect(code).toMatch(/production non configurée[^]*?exit 0/);
  });

  it("n'écrit aucune valeur de secret en dur", () => {
    verifierAucunSecretEnDur(reveil);
  });
});
