import "server-only";
import { createHmac, randomBytes } from "node:crypto";

// Empreintes HMAC-SHA-256 des IP (et, story 1.9, des emails de connexion)
// (AD-14). Seul endroit où HMAC_SECRET est lue (AD-9). Une empreinte ne
// permet pas de retrouver l'adresse sans le secret ; l'adresse elle-même
// n'est jamais stockée, tracée ni renvoyée.
//
// Secret absent :
// - en production : aucune empreinte, le dépôt est refusé et une erreur est
//   tracée (sans valeur) ;
// - hors production (SUPABASE_ENVIRONNEMENT = « developpement » : poste
//   d'Abraham, CI) : une clé aléatoire est tirée une fois par processus
//   serveur, avec un avertissement. Les empreintes ne vivent qu'une heure :
//   changer de clé au redémarrage est sans conséquence.
// Toute autre valeur de SUPABASE_ENVIRONNEMENT (absente comprise) compte
// comme la production : on refuse plutôt que d'utiliser une clé de repli.

export type Environnement = Record<string, string | undefined>;

/** Domaines séparés : la même IP et le même email n'ont jamais la même empreinte. */
export type DomaineEmpreinte = "ip" | "email";

const FORMAT_EMPREINTE = /^[0-9a-f]{64}$/;

let cleDeRepli: string | null = null;

/** Hors production seulement si l'environnement le dit explicitement. */
export function estHorsProduction(env: Environnement = process.env): boolean {
  return env.SUPABASE_ENVIRONNEMENT === "developpement";
}

/**
 * Secret HMAC : HMAC_SECRET, sinon (hors production) une clé aléatoire
 * propre au processus, sinon null (production sans secret).
 */
export function lireCleHmac(env: Environnement = process.env): string | null {
  const secret = env.HMAC_SECRET?.trim();
  if (secret) return secret;
  if (!estHorsProduction(env)) {
    console.error("[empreintes] HMAC_SECRET manquant en production : empreinte impossible");
    return null;
  }
  if (cleDeRepli === null) {
    cleDeRepli = randomBytes(32).toString("hex");
    console.warn(
      "[empreintes] HMAC_SECRET absent : clé aléatoire tirée pour ce serveur (développement seulement)",
    );
  }
  return cleDeRepli;
}

/** HMAC-SHA-256 de `domaine:valeur`, en hexadécimal (64 caractères). */
export function calculerEmpreinte(
  domaine: DomaineEmpreinte,
  valeur: string,
  cle: string,
): string {
  return createHmac("sha256", cle).update(`${domaine}:${valeur}`, "utf8").digest("hex");
}

export function estEmpreinte(valeur: unknown): valeur is string {
  return typeof valeur === "string" && FORMAT_EMPREINTE.test(valeur);
}

/** Empreinte d'une IP, ou null si aucun secret n'est disponible (production). */
export function empreinteIp(ip: string, env: Environnement = process.env): string | null {
  const cle = lireCleHmac(env);
  return cle === null ? null : calculerEmpreinte("ip", ip, cle);
}

/**
 * Empreinte d'un email de connexion (story 1.9), passé en minuscules et sans
 * espaces, ou null si aucun secret n'est disponible (production).
 */
export function empreinteEmail(email: string, env: Environnement = process.env): string | null {
  const cle = lireCleHmac(env);
  return cle === null ? null : calculerEmpreinte("email", email.trim().toLowerCase(), cle);
}

/** Tests seulement : oublie la clé de repli (comme un redémarrage du serveur). */
export function oublierCleDeRepli(): void {
  cleDeRepli = null;
}
