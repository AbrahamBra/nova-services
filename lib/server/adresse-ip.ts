import "server-only";
import { estHorsProduction, type Environnement } from "@/lib/server/empreintes";

// Adresse IP du visiteur, pour la limite d'envois (AD-14, AD-16). L'adresse
// n'est jamais stockée ni tracée : elle passe aussitôt dans
// lib/server/empreintes.ts.
//
// Fermé par défaut : seul SUPABASE_ENVIRONNEMENT=developpement ouvre les
// autres en-têtes (même règle que lib/server/empreintes.ts).
// - Hors développement (variable absente ou inconnue comprise) ou sur
//   Netlify (NETLIFY=true) : uniquement l'en-tête posé par Netlify,
//   x-nf-client-connection-ip. Les autres en-têtes peuvent être falsifiés par
//   le visiteur. En-tête absent : null (le dépôt est refusé ; à vérifier sur
//   une prévisualisation, story 3.1).
// - En développement : l'en-tête de test (voir ci-dessous), puis
//   x-nf-client-connection-ip s'il est présent (prévisualisation Netlify),
//   puis le premier élément non vide de x-forwarded-for, puis 127.0.0.1.
// - Tests seulement : avec IP_DE_TEST_AUTORISEE=1 (posée par
//   playwright.config.ts, jamais sur Netlify), l'en-tête x-nova-ip-test
//   remplace l'IP, pour que chaque test dépose avec sa propre adresse.
//   Ignoré sur Netlify et hors développement, même si la variable y était
//   posée par erreur.

export const ENTETE_NETLIFY = "x-nf-client-connection-ip";
export const ENTETE_RELAIS = "x-forwarded-for";
export const ENTETE_TEST = "x-nova-ip-test";
export const IP_LOCALE = "127.0.0.1";

/** Au-delà, la valeur n'est pas une adresse : elle est coupée. */
const LONGUEUR_MAX = 100;

export type LecteurEntetes = { get(nom: string): string | null };

/** Vrai si seul l'en-tête Netlify fait foi : hors développement, ou sur Netlify. */
export function estSurNetlify(env: Environnement = process.env): boolean {
  return env.NETLIFY === "true" || !estHorsProduction(env);
}

export function enteteDeTestAutorise(env: Environnement = process.env): boolean {
  return env.IP_DE_TEST_AUTORISEE === "1" && !estSurNetlify(env);
}

function nettoyer(valeur: string | null | undefined): string | null {
  const propre = (valeur ?? "").trim().slice(0, LONGUEUR_MAX);
  return propre === "" ? null : propre;
}

/** IP du visiteur selon l'environnement ; null hors développement sans l'en-tête Netlify. */
export function lireAdresseIp(
  entetes: LecteurEntetes,
  env: Environnement = process.env,
): string | null {
  if (estSurNetlify(env)) {
    return nettoyer(entetes.get(ENTETE_NETLIFY));
  }
  if (enteteDeTestAutorise(env)) {
    const test = nettoyer(entetes.get(ENTETE_TEST));
    if (test !== null) return test;
  }
  const netlify = nettoyer(entetes.get(ENTETE_NETLIFY));
  if (netlify !== null) return netlify;
  const relais = (entetes.get(ENTETE_RELAIS) ?? "")
    .split(",")
    .map(nettoyer)
    .find((valeur) => valeur !== null);
  return relais ?? IP_LOCALE;
}
