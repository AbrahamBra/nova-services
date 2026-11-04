import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

// Story 1.8 — limite de 5 envois en 10 minutes par IP. Les tests déposent
// beaucoup : chacun utilise sa propre IP (navigateur) ou sa propre empreinte
// (appel direct de la base), pour ne jamais gêner les autres.

/** En-tête lu par lib/server/adresse-ip.ts quand IP_DE_TEST_AUTORISEE=1. */
export const ENTETE_IP_TEST = "x-nova-ip-test";

/** Adresse fictive, différente à chaque appel. */
export function ipDeTest(): string {
  return `test-${randomUUID()}`;
}

/** Empreinte HMAC fictive (64 caractères hexadécimaux), pour `deposer_demande`. */
export function empreinteDeTest(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Navigateur : toutes les requêtes du contexte portent une IP de test propre.
 * Le serveur doit avoir été lancé par Playwright (IP_DE_TEST_AUTORISEE=1).
 */
export async function utiliserIpDeTest(
  context: BrowserContext,
  ip: string = ipDeTest(),
): Promise<string> {
  await context.setExtraHTTPHeaders({ [ENTETE_IP_TEST]: ip });
  return ip;
}
