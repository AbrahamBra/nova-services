import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CANAUX, PRIORITES, STATUTS, type Canal, type Priorite, type Statut } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import {
  RESPONSABLE_MOI,
  TAILLE_PAGE,
  TRI_PAR_DEFAUT,
  bornerPage,
  conditionsDesFiltres,
  intervalle,
  type Condition,
  type Filtres,
} from "@/lib/filtres";
import type { Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Lecture paginée de la liste des demandes (story 1.5, AD-25) : vue
// `demandes_liste`, lue avec la SESSION de la personne connectée (jamais la
// clé secrète). RLS et droits par colonne font le tri : un compte qui n'est
// pas membre actif ne lit aucune ligne.
// Story 2.5 : filtres de l'adresse traduits par lib/filtres.ts ; avec une
// recherche texte, les lignes viennent de `rechercher_demandes(q)` : la vue
// elle-même (RLS appliquée), restreinte aux identifiants trouvés par
// `ids_demandes_recherche` (migration 0019) ; filtres, tri, comptage et
// pagination s'appliquent à la vue, comme sans recherche.
// Le total et la pagination portent sur la liste filtrée.

export type LigneDemande = {
  id: string;
  reference: string;
  creeLe: string;
  nom: string;
  societe: string | null;
  objet: string;
  categorie: string;
  canal: Canal;
  statut: Statut;
  priorite: Priorite;
  responsable: string | null;
};

export type PageDemandes = {
  lignes: LigneDemande[];
  /** Nombre total de demandes visibles (avec les filtres). */
  total: number;
  /** Page réellement affichée (ramenée à la dernière page si hors bornes). */
  page: number;
  taillePage: number;
};

const COLONNES =
  "id, reference, cree_le, nom, societe, objet, categorie_nom, canal, statut, priorite, responsable_nom";

// Erreur PostgREST « Requested range not satisfiable » : page au-delà de la fin.
const HORS_BORNES = "PGRST103";

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

function texte(v: unknown): v is string {
  return typeof v === "string";
}

function texteOuNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function inclus<T extends string>(liste: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (liste as readonly string[]).includes(v);
}

/** Premier champ invalide d'une ligne de la vue, ou null si elle est valide. */
function champInvalide(v: Record<string, unknown>): string | null {
  if (!texte(v.id)) return "id";
  if (!texte(v.reference)) return "reference";
  if (!texte(v.cree_le) || Number.isNaN(Date.parse(v.cree_le))) return "cree_le";
  if (!texte(v.nom)) return "nom";
  if (!texteOuNull(v.societe)) return "societe";
  if (!texte(v.objet)) return "objet";
  if (!texte(v.categorie_nom)) return "categorie_nom";
  if (!inclus(CANAUX, v.canal)) return "canal";
  if (!inclus(STATUTS, v.statut)) return "statut";
  if (!inclus(PRIORITES, v.priorite)) return "priorite";
  if (!texteOuNull(v.responsable_nom)) return "responsable_nom";
  return null;
}

/**
 * Valide une ligne de la vue. Une ligne invalide est écartée (`null`) et
 * signalée au journal par sa référence et le nom du champ seulement, jamais
 * par une donnée personnelle : les autres lignes restent affichées.
 */
export function lireLigne(valeur: unknown): LigneDemande | null {
  if (typeof valeur !== "object" || valeur === null) {
    console.error("[demandes] ligne écartée : forme inattendue");
    return null;
  }
  const v = valeur as Record<string, unknown>;
  const champ = champInvalide(v);
  if (champ !== null) {
    const reference = texte(v.reference) ? v.reference : "inconnue";
    console.error(`[demandes] ligne écartée : reference=${reference} champ=${champ}`);
    return null;
  }
  return {
    id: v.id as string,
    reference: v.reference as string,
    creeLe: v.cree_le as string,
    nom: v.nom as string,
    societe: v.societe as string | null,
    objet: v.objet as string,
    categorie: v.categorie_nom as string,
    canal: v.canal as Canal,
    statut: v.statut as Statut,
    priorite: v.priorite as Priorite,
    responsable: v.responsable_nom as string | null,
  };
}

type Reponse = {
  data: unknown[] | null;
  count: number | null;
  error: { code?: string } | null;
};

/**
 * Requête filtrée (vue, ou recherche texte), sans tri ni pagination. En
 * `comptage` (story 2.8 : tableau de bord, compteur du menu), mêmes filtres
 * et mêmes conditions, sans aucune ligne renvoyée (`head`).
 */
function requeteFiltree(
  client: SupabaseClient,
  filtres: Filtres,
  conditions: Condition[],
  comptage = false,
) {
  const colonnes: string = comptage ? "id" : COLONNES;
  let requete = filtres.q
    ? client
        .rpc("rechercher_demandes", { p_texte: filtres.q }, { count: "exact", head: comptage })
        .select(colonnes)
    : client.from("demandes_liste").select(colonnes, { count: "exact", head: comptage });
  for (const condition of conditions) {
    if (condition.operateur === "eq") requete = requete.eq(condition.colonne, condition.valeur);
    else if (condition.operateur === "in") requete = requete.in(condition.colonne, condition.valeurs);
    else requete = requete.is(condition.colonne, null);
  }
  return requete;
}

async function lirePage(
  client: SupabaseClient,
  page: number,
  filtres: Filtres,
  conditions: Condition[],
  taillePage: number,
): Promise<Reponse> {
  const { de, a } = intervalle(page, taillePage);
  const { data, count, error } = await requeteFiltree(client, filtres, conditions)
    .order(TRI_PAR_DEFAUT.colonne, { ascending: TRI_PAR_DEFAUT.croissant })
    .order("id", { ascending: false })
    .range(de, a);
  // Toujours un tableau (vue ou fonction « setof ») ; vérifié par lireDemandesAvec.
  return { data: data as unknown[] | null, count, error };
}

async function compter(
  client: SupabaseClient,
  filtres: Filtres,
  conditions: Condition[],
): Promise<number | null> {
  const { count, error } = await requeteFiltree(client, filtres, conditions).range(0, 0);
  return error ? null : count;
}

/** Identifiant du membre connecté (« Mes demandes »), ou null. */
async function membreConnecte(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getClaims();
  const sub = data?.claims?.sub;
  return !error && typeof sub === "string" && sub !== "" ? sub : null;
}

/**
 * Conditions des filtres (lib/filtres.ts) ; pour « Mes demandes », avec le
 * membre connecté. `null` si ce membre est introuvable.
 */
async function conditionsPour(
  client: SupabaseClient,
  filtres: Filtres,
): Promise<Condition[] | null> {
  const membreId =
    filtres.responsable === RESPONSABLE_MOI ? await membreConnecte(client) : null;
  if (filtres.responsable === RESPONSABLE_MOI && membreId === null) {
    console.error("[demandes] membre connecté introuvable pour « Mes demandes »");
    return null;
  }
  return conditionsDesFiltres(filtres, membreId);
}

/**
 * Lit une page de la liste filtrée avec un client porteur de la session. Une
 * page au-delà de la fin est ramenée à la dernière page. `taillePage` : 25
 * pour la liste ; le tableau de bord (story 2.8) lit les 5 premières lignes.
 */
export async function lireDemandesAvec(
  client: SupabaseClient,
  pageDemandee: number,
  filtres: Filtres = {},
  taillePage: number = TAILLE_PAGE,
): Promise<Resultat<PageDemandes>> {
  try {
    const conditions = await conditionsPour(client, filtres);
    if (conditions === null) return ECHEC;

    let page = Math.max(1, Math.trunc(pageDemandee));
    let reponse = await lirePage(client, page, filtres, conditions, taillePage);

    const horsBornes =
      reponse.error?.code === HORS_BORNES ||
      (!reponse.error && page > 1 && (reponse.data?.length ?? 0) === 0);
    if (horsBornes) {
      const total = reponse.error ? await compter(client, filtres, conditions) : reponse.count;
      if (total === null) {
        console.error("[demandes] comptage impossible");
        return ECHEC;
      }
      page = bornerPage(page, total, taillePage);
      reponse = await lirePage(client, page, filtres, conditions, taillePage);
    }

    if (reponse.error || !Array.isArray(reponse.data) || reponse.count === null) {
      console.error(`[demandes] lecture impossible : code=${reponse.error?.code ?? "aucun"}`);
      return ECHEC;
    }

    // Une ligne mal formée est écartée (et journalisée), les autres restent.
    const lignes = reponse.data
      .map(lireLigne)
      .filter((ligne): ligne is LigneDemande => ligne !== null);

    return {
      ok: true,
      donnees: { lignes, total: reponse.count, page, taillePage },
    };
  } catch {
    console.error("[demandes] exception pendant la lecture");
    return ECHEC;
  }
}

/** Page de la liste filtrée pour la personne connectée (pages de l'espace équipe). */
export async function lireDemandes(
  page: number,
  filtres: Filtres = {},
  taillePage: number = TAILLE_PAGE,
): Promise<Resultat<PageDemandes>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[demandes] client serveur indisponible");
    return ECHEC;
  }
  return lireDemandesAvec(client, page, filtres, taillePage);
}

/**
 * Nombre de demandes de la liste filtrée (story 2.8 : chiffres du tableau de
 * bord et compteur du menu), avec un client porteur de la session. Mêmes
 * conditions que la liste (`conditionsDesFiltres`, AD-25) : le chiffre est
 * exactement le total de la liste ouverte avec ces filtres.
 */
export async function compterDemandesAvec(
  client: SupabaseClient,
  filtres: Filtres = {},
): Promise<Resultat<number>> {
  try {
    const conditions = await conditionsPour(client, filtres);
    if (conditions === null) return ECHEC;
    const { count, error } = await requeteFiltree(client, filtres, conditions, true);
    if (error || typeof count !== "number") {
      console.error(`[demandes] comptage impossible : code=${error?.code ?? "aucun"}`);
      return ECHEC;
    }
    return { ok: true, donnees: count };
  } catch {
    console.error("[demandes] exception pendant le comptage");
    return ECHEC;
  }
}
