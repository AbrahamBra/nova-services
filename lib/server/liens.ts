import "server-only";

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

/** Lien d'invitation : page /auth/confirmer, qui ne consomme le jeton qu'au clic. */
export function lienInvitation(site: string, jetonHache: string): string {
  const parametres = new URLSearchParams({ token_hash: jetonHache, type: "invite" });
  return `${site}/auth/confirmer?${parametres.toString()}`;
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
