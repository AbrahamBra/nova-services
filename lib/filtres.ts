// Tri, pagination, recherche et filtres des listes de demandes (AD-25).
// Story 1.5 : tri par date de création décroissante, pages de 25, numéro de
// page dans l'adresse (`?page=2`).
// Story 2.5 : recherche et filtres dans l'adresse (`?q=dupont&statut=
// non_traitees&responsable=aucun`), lus et écrits ici, puis traduits en
// conditions sur la vue `demandes_liste` (lib/demandes.ts). Le tableau de
// bord (story 2.8) réutilisera ces mêmes conditions.
// Sans dépendance au serveur : utilisable par les pages, la barre de filtres
// (navigateur) et les tests.

import {
  CANAUX,
  PRIORITES,
  STATUTS,
  TYPES_JOURNAL,
  type Canal,
  type Priorite,
  type Statut,
  type TypeJournal,
} from "@/lib/domaine";

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

// Recherche et filtres (story 2.5) --------------------------------------------

/** Longueur maximale du texte cherché ; au-delà, il est ignoré. */
export const LONGUEUR_MAX_RECHERCHE = 100;

/** Valeurs du filtre Statut : « Non traitées » (Nouvelle et En cours), ou un statut. */
export const FILTRES_STATUT = ["non_traitees", ...STATUTS] as const;
export type FiltreStatut = (typeof FILTRES_STATUT)[number];

/** Statuts de « Non traitées ». */
export const STATUTS_NON_TRAITES: readonly Statut[] = ["nouvelle", "en_cours"];

/** Responsable : « Sans responsable », « Mes demandes », ou l'identifiant d'un membre. */
export const RESPONSABLE_AUCUN = "aucun";
export const RESPONSABLE_MOI = "moi";

export type Filtres = {
  /** Texte cherché, sans espaces en début et fin, 100 caractères au plus. */
  q?: string;
  statut?: FiltreStatut;
  priorite?: Priorite;
  /** Identifiant d'une catégorie (minuscules). */
  categorie?: string;
  canal?: Canal;
  /** `aucun`, `moi` ou l'identifiant d'un membre (minuscules). */
  responsable?: string;
};

/** Paramètres des filtres, dans l'ordre où ils sont écrits dans l'adresse. */
export const CLES_FILTRES = ["q", "statut", "priorite", "categorie", "canal", "responsable"] as const;
export type CleFiltre = (typeof CLES_FILTRES)[number];

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function premiere(valeur: ValeurParametre): string | undefined {
  return Array.isArray(valeur) ? valeur[0] : valeur;
}

function parmi<T extends string>(liste: readonly T[], valeur: ValeurParametre): T | undefined {
  const brut = premiere(valeur);
  return brut !== undefined && (liste as readonly string[]).includes(brut) ? (brut as T) : undefined;
}

function identifiant(valeur: ValeurParametre): string | undefined {
  const brut = premiere(valeur)?.trim();
  return brut && FORMAT_UUID.test(brut) ? brut.toLowerCase() : undefined;
}

/**
 * Même traitement que `prive.normaliser` (migration 0019), testé contre
 * elle : minuscules, ligatures développées, accents retirés (NFD puis signes
 * diacritiques combinants), tirets et apostrophes en espaces, espaces
 * réduites, sans espace au début ni à la fin.
 */
export function normaliserRecherche(texte: string): string {
  return texte
    .normalize("NFC")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[łøđħıŧ]/g, (c) => "lodhit"["łøđħıŧ".indexOf(c)])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-'‐‑‒–—‘’]/g, " ")
    .replace(/[ \t\n\r\f\v  ]+/g, " ")
    .trim();
}

/**
 * Texte cherché : sans espaces autour ; vide, trop long, ou sans rien à
 * chercher une fois normalisé (« - », « ' »), ignoré.
 */
export function lireRecherche(valeur: ValeurParametre): string | undefined {
  const texte = premiere(valeur)?.trim();
  if (!texte || texte.length > LONGUEUR_MAX_RECHERCHE) return undefined;
  if (normaliserRecherche(texte) === "") return undefined;
  return texte;
}

/**
 * Lit les filtres de l'adresse. Une valeur invalide est ignorée, sans
 * erreur (`statut=fermee`, `categorie=abc`…).
 */
export function lireFiltres(parametres: ParametresAdresse): Filtres {
  const filtres: Filtres = {};
  const q = lireRecherche(parametres.q);
  if (q !== undefined) filtres.q = q;
  const statut = parmi(FILTRES_STATUT, parametres.statut);
  if (statut) filtres.statut = statut;
  const priorite = parmi(PRIORITES, parametres.priorite);
  if (priorite) filtres.priorite = priorite;
  const categorie = identifiant(parametres.categorie);
  if (categorie) filtres.categorie = categorie;
  const canal = parmi(CANAUX, parametres.canal);
  if (canal) filtres.canal = canal;
  const responsable =
    parmi([RESPONSABLE_AUCUN, RESPONSABLE_MOI], parametres.responsable) ??
    identifiant(parametres.responsable);
  if (responsable) filtres.responsable = responsable;
  return filtres;
}

/** Vrai dès qu'un filtre (ou une recherche) est actif. */
export function aDesFiltres(filtres: Filtres): boolean {
  return CLES_FILTRES.some((cle) => (filtres[cle] ?? "") !== "");
}

/**
 * Paramètres de l'adresse de la liste (forme canonique) : les filtres actifs
 * dans l'ordre de `CLES_FILTRES`, puis `page` au-delà de la page 1.
 */
export function parametresListe(filtres: Filtres, page: number = 1): Record<string, string> {
  const parametres: Record<string, string> = {};
  for (const cle of CLES_FILTRES) {
    const valeur = filtres[cle];
    if (valeur !== undefined && valeur !== "") parametres[cle] = valeur;
  }
  if (page > 1) parametres.page = String(Math.trunc(page));
  return parametres;
}

/** Adresse de la liste avec ces filtres et cette page (page 1 sans `page`). */
export function adresseListe(chemin: string, filtres: Filtres, page: number = 1): string {
  const texte = new URLSearchParams(parametresListe(filtres, page)).toString();
  return texte ? `${chemin}?${texte}` : chemin;
}

/**
 * Vrai si les paramètres reçus sont exactement la forme canonique (mêmes
 * paramètres, une seule valeur chacun, ordre indifférent). Sinon, la page
 * redirige vers `adresseListe` : valeurs invalides retirées, page bornée.
 */
export function estAdresseCanonique(
  parametres: ParametresAdresse,
  filtres: Filtres,
  page: number,
): boolean {
  const attendus = parametresListe(filtres, page);
  const recus = Object.entries(parametres).filter(([, valeur]) => valeur !== undefined);
  if (recus.length !== Object.keys(attendus).length) return false;
  return recus.every(([cle, valeur]) => typeof valeur === "string" && attendus[cle] === valeur);
}

/** Condition sur une colonne de `demandes_liste`, appliquée par lib/demandes.ts. */
export type Condition =
  | { colonne: string; operateur: "eq"; valeur: string }
  | { colonne: string; operateur: "in"; valeurs: readonly string[] }
  | { colonne: string; operateur: "est_vide" };

/**
 * Traduit les filtres (hors recherche texte, qui passe par
 * `rechercher_demandes`) en conditions sur la vue. `membreId` : le membre
 * connecté, pour « Mes demandes » ; sans lui, ce filtre ne renvoie rien.
 */
export function conditionsDesFiltres(filtres: Filtres, membreId: string | null): Condition[] {
  const conditions: Condition[] = [];
  if (filtres.statut === "non_traitees") {
    conditions.push({ colonne: "statut", operateur: "in", valeurs: STATUTS_NON_TRAITES });
  } else if (filtres.statut) {
    conditions.push({ colonne: "statut", operateur: "eq", valeur: filtres.statut });
  }
  if (filtres.priorite) {
    conditions.push({ colonne: "priorite", operateur: "eq", valeur: filtres.priorite });
  }
  if (filtres.categorie) {
    conditions.push({ colonne: "categorie_id", operateur: "eq", valeur: filtres.categorie });
  }
  if (filtres.canal) {
    conditions.push({ colonne: "canal", operateur: "eq", valeur: filtres.canal });
  }
  if (filtres.responsable === RESPONSABLE_AUCUN) {
    conditions.push({ colonne: "responsable_id", operateur: "est_vide" });
  } else if (filtres.responsable === RESPONSABLE_MOI) {
    conditions.push(
      membreId
        ? { colonne: "responsable_id", operateur: "eq", valeur: membreId }
        : { colonne: "id", operateur: "in", valeurs: [] },
    );
  } else if (filtres.responsable) {
    conditions.push({ colonne: "responsable_id", operateur: "eq", valeur: filtres.responsable });
  }
  return conditions;
}

/** Choix d'une liste « Catégorie » ou « Responsable » de la barre de filtres. */
export type OptionFiltre = { id: string; nom: string; desactive: boolean };

// Journal (story 5.1) ----------------------------------------------------------
// Filtre par type et page dans l'adresse (`?type=compte&page=2`), 50 lignes
// par page. Un type inconnu est ignoré ; la page redirige alors vers la forme
// canonique, comme la liste des demandes.

export const TAILLE_PAGE_JOURNAL = 50;

/** Lit `?type=` : un des types du journal, sinon undefined (« Tous »). */
export function lireTypeJournal(valeur: ValeurParametre): TypeJournal | undefined {
  return parmi(TYPES_JOURNAL, valeur);
}

/** Paramètres canoniques du journal : `type` s'il y en a un, puis `page` au-delà de 1. */
export function parametresJournal(type: TypeJournal | undefined, page: number = 1): Record<string, string> {
  const parametres: Record<string, string> = {};
  if (type) parametres.type = type;
  if (page > 1) parametres.page = String(Math.trunc(page));
  return parametres;
}

/** Adresse du journal avec ce type et cette page (page 1 sans `page`). */
export function adresseJournal(chemin: string, type: TypeJournal | undefined, page: number = 1): string {
  const texte = new URLSearchParams(parametresJournal(type, page)).toString();
  return texte ? `${chemin}?${texte}` : chemin;
}

/** Vrai si les paramètres reçus sont exactement la forme canonique du journal. */
export function estAdresseJournalCanonique(
  parametres: ParametresAdresse,
  type: TypeJournal | undefined,
  page: number,
): boolean {
  const attendus = parametresJournal(type, page);
  const recus = Object.entries(parametres).filter(([, valeur]) => valeur !== undefined);
  if (recus.length !== Object.keys(attendus).length) return false;
  return recus.every(([cle, valeur]) => typeof valeur === "string" && attendus[cle] === valeur);
}
