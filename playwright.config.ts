import { defineConfig, devices } from "@playwright/test";

// Port dédié aux tests, distinct de l'aperçu (3000) : un serveur lancé à la
// main sans IP_DE_TEST_AUTORISEE n'est jamais réutilisé par erreur (tous les
// tests partageraient alors 127.0.0.1 et la limite d'envois, story 1.8).
const PORT = 3210;
const enCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // En local : 3 navigateurs à la fois au plus. Davantage sature le serveur
  // de développement et la base partagée (attentes dépassées). CI inchangée.
  workers: enCI ? undefined : 3,
  forbidOnly: enCI,
  retries: enCI ? 1 : 0,
  reporter: enCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "on-first-retry",
  },
  projects: [
    { name: "ordinateur", use: { ...devices["Desktop Chrome"] } },
    { name: "telephone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // En CI : version construite (plus proche de la production).
    // En local : serveur de développement, réutilisé s'il tourne déjà.
    command: enCI ? `npm run build && npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !enCI,
    timeout: 180_000,
    // Story 1.8 : l'en-tête x-nova-ip-test remplace l'IP, pour que chaque
    // test dépose avec sa propre adresse sans atteindre la limite d'envois
    // (tests/outils/ip-test.ts). Seulement pour le serveur lancé ici, sur le
    // port dédié aux tests.
    env: { IP_DE_TEST_AUTORISEE: "1" },
  },
});
