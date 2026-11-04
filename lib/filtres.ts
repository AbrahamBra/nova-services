// Tri, pagination et paramètres d'adresse des listes de demandes (AD-25).
// Première version (story 1.5) : tri par date de création décroissante,
// pages de 25, numéro de page dans l'adresse (`?page=2`). La recherche, les
// filtres (story 2.5) et le tableau de bord (story 2.8) compléteront ce fichier.
// Sans dépendance au serveur : utilisable par les pages et par les tests.

export const TAILLE_PAGE = 25;

/** Tri par défaut : les plus récentes d'abord ; `id` départage les égalités. */
export const TRI_PAR_DEFAUT = { colonne: "cree_le", croissant: false } as const;

/** Au-delà, le numéro est ramené à la dernière page par la lecture. */
const PAGE_MAXIMALE = 1_000_000;

type ValeurParametre = string | string[] | undefined;
export type ParametresAdresse = Record<string, ValeurParametre>;

/**
 * Lit `?page=` : entier ≥ 1, sinon 1 (`abc`, `0`, `-2`, `2.5`, absent).
 * Un numéro trop grand est gardé (borné) : la lecture le ramène ensuite à la
 * dernière page existante.
 */
export function lireNumeroPage(valeur: ValeurParametre): number {
  const brut = (Array.isArray(valeur) ? valeur[0] : valeur)?.trim();
  if (!brut || !/^\d+$/.test(brut)) return 1;
  const numero = Number(brut);
  if (!Number.isSafeInteger(numero)) return PAGE_MAXIMALE;
  if (numero < 1) return 1;
  return Math.min(numero, PAGE_MAXIMALE);
}

/** Nombre de pages (au moins 1, même sans demande). */
export function nombreDePages(total: number, taille: number = TAILLE_PAGE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / taille));
}

/** Ramène un numéro de page entre 1 et la dernière page. */
export function bornerPage(page: number, total: number, taille: number = TAILLE_PAGE): number {
  return Math.min(Math.max(1, Math.trunc(page)), nombreDePages(total, taille));
}

/** Indices de la première et de la dernière ligne de la page (base 0, inclus). */
export function intervalle(page: number, taille: number = TAILLE_PAGE): { de: number; a: number } {
  const de = (Math.max(1, Math.trunc(page)) - 1) * taille;
  return { de, a: de + taille - 1 };
}

/** Rang (base 1) de la première et de la dernière ligne affichées. */
export function rangsAffiches(
  page: number,
  total: number,
  taille: number = TAILLE_PAGE,
): { premier: number; dernier: number } {
  if (total <= 0) return { premier: 0, dernier: 0 };
  const p = bornerPage(page, total, taille);
  return { premier: (p - 1) * taille + 1, dernier: Math.min(p * taille, total) };
}

/**
 * Adresse d'une page de la liste, en gardant les autres paramètres (futurs
 * filtres). La page 1 n'apparaît pas dans l'adresse.
 */
export function adresseAvecPage(
  chemin: string,
  parametres: ParametresAdresse,
  page: number,
): string {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (cle === "page" || valeur === undefined) continue;
    for (const v of Array.isArray(valeur) ? valeur : [valeur]) recherche.append(cle, v);
  }
  if (page > 1) recherche.set("page", String(page));
  const texte = recherche.toString();
  return texte ? `${chemin}?${texte}` : chemin;
}
