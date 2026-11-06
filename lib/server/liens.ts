import "server-only";
import type { TypeLien } from "@/lib/schemas/mot-de-passe";

// Liens envoyés aux membres (epic 4) : fabriqués par l'application à partir
// du jeton haché de `generateLink` et de NEXT_PUBLIC_SITE_URL. Jamais à
// partir de l'en-tête Host de la requête (qu'un client peut choisir).

/**
 * Adresse du site (origine, sans barre finale), lue dans NEXT_PUBLIC_SITE_URL.
 * null si absente ou invalide (pas http(s), chemin, paramètres) : l'action
 * refuse alors de créer le lien.
 */
export function adresseDuSite(valeur: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  if (typeof valeur !== "string") return null;
  const texte = valeur.trim().replace(/\/+$/, "");
  if (texte === "") return null;
  let url: URL;
  try {
    url = new URL(texte);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

/**
 * Lien vers /auth/confirmer (invitation ou réinitialisation du mot de passe),
 * page qui ne consomme le jeton qu'au clic sur « Continuer ».
 */
export function lienConfirmation(site: string, jetonHache: string, type: TypeLien): string {
  const parametres = new URLSearchParams({ token_hash: jetonHache, type });
  return `${site}/auth/confirmer?${parametres.toString()}`;
}

/** Lien d'invitation (story 4.1). */
export function lienInvitation(site: string, jetonHache: string): string {
  return lienConfirmation(site, jetonHache, "invite");
}

/** Lien de réinitialisation du mot de passe (story 4.3). */
export function lienMotDePasse(site: string, jetonHache: string): string {
  return lienConfirmation(site, jetonHache, "recovery");
}

/** Marge pour l'écart d'horloge entre ce serveur et Supabase Auth. */
const MARGE_HORLOGE_MS = 2 * 60 * 1000;

/**
 * Vrai si le compte renvoyé par `generateLink` vient d'être créé (date de
 * création postérieure au début de l'appel, à la marge d'horloge près).
 * Date absente ou illisible : considéré comme existant (jamais supprimé).
 */
export function creeParCetAppel(creeLe: unknown, debut: number): boolean {
  if (typeof creeLe !== "string") return false;
  const date = Date.parse(creeLe);
  return Number.isFinite(date) && date >= debut - MARGE_HORLOGE_MS;
}
