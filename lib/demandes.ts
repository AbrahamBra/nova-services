import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CANAUX, PRIORITES, STATUTS, type Canal, type Priorite, type Statut } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { TAILLE_PAGE, TRI_PAR_DEFAUT, bornerPage, intervalle } from "@/lib/filtres";
import type { Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Lecture paginée de la liste des demandes (story 1.5, AD-25) : vue
// `demandes_liste`, lue avec la SESSION de la personne connectée (jamais la
// clé secrète). RLS et droits par colonne font le tri : un compte qui n'est
// pas membre actif ne lit aucune ligne.

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
  /** Nombre total de demandes visibles. */
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

async function lirePage(client: SupabaseClient, page: number): Promise<Reponse> {
  const { de, a } = intervalle(page, TAILLE_PAGE);
  const { data, count, error } = await client
    .from("demandes_liste")
    .select(COLONNES, { count: "exact" })
    .order(TRI_PAR_DEFAUT.colonne, { ascending: TRI_PAR_DEFAUT.croissant })
    .order("id", { ascending: false })
    .range(de, a);
  return { data, count, error };
}

async function compter(client: SupabaseClient): Promise<number | null> {
  const { count, error } = await client
    .from("demandes_liste")
    .select("id", { count: "exact", head: true });
  return error ? null : count;
}

/**
 * Lit une page de la liste avec un client porteur de la session. Une page
 * au-delà de la fin est ramenée à la dernière page.
 */
export async function lireDemandesAvec(
  client: SupabaseClient,
  pageDemandee: number,
): Promise<Resultat<PageDemandes>> {
  try {
    let page = Math.max(1, Math.trunc(pageDemandee));
    let reponse = await lirePage(client, page);

    const horsBornes =
      reponse.error?.code === HORS_BORNES ||
      (!reponse.error && page > 1 && (reponse.data?.length ?? 0) === 0);
    if (horsBornes) {
      const total = reponse.error ? await compter(client) : reponse.count;
      if (total === null) {
        console.error("[demandes] comptage impossible");
        return ECHEC;
      }
      page = bornerPage(page, total, TAILLE_PAGE);
      reponse = await lirePage(client, page);
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
      donnees: { lignes, total: reponse.count, page, taillePage: TAILLE_PAGE },
    };
  } catch {
    console.error("[demandes] exception pendant la lecture");
    return ECHEC;
  }
}

/** Page de la liste pour la personne connectée (pages de l'espace équipe). */
export async function lireDemandes(page: number): Promise<Resultat<PageDemandes>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[demandes] client serveur indisponible");
    return ECHEC;
  }
  return lireDemandesAvec(client, page);
}
