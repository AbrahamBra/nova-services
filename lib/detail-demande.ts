import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANAUX,
  ETATS_EMAIL,
  NATURE_VALEUR_HISTORIQUE,
  PRIORITES,
  STATUTS,
  TYPES_HISTORIQUE,
  type Canal,
  type EtatEmail,
  type Priorite,
  type Statut,
  type TypeHistorique,
} from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import type { Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Détail d'une demande (story 1.6, EXPERIENCE.md §9.5) : la demande, son
// historique (du plus ancien au plus récent) et les noms nécessaires à son
// affichage (membres, catégories). Lu avec la SESSION de la personne
// connectée (jamais la clé secrète) : RLS et droits par colonne font le tri.
// `jeton_confirmation` et `cle_envoi` ne sont jamais demandés.
// Story 2.2 : les notes internes (de la plus ancienne à la plus récente) et
// le nom de leurs auteurs, lues de la même façon (RLS de `notes`).
// Résultat : `donnees: null` si la référence est mal formée ou inconnue.

export type LigneHistorique = {
  id: string;
  creeLe: string;
  auteurType: "demandeur" | "membre";
  auteurId: string | null;
  type: TypeHistorique;
  ancienneValeur: string | null;
  nouvelleValeur: string | null;
};

export type NoteInterne = {
  id: string;
  creeLe: string;
  auteurId: string;
  /** Texte tel que saisi (retours à la ligne compris), jamais interprété. */
  texte: string;
};

export type DetailDemande = {
  id: string;
  reference: string;
  creeLe: string;
  canal: Canal;
  nom: string;
  email: string | null;
  telephone: string | null;
  societe: string | null;
  objet: string;
  description: string;
  categorieId: string;
  statut: Statut;
  priorite: Priorite;
  responsableId: string | null;
  etatEmail: EtatEmail;
  historique: LigneHistorique[];
  /** Lignes d'historique écartées par la validation (illisibles). */
  lignesIllisibles: number;
  notes: NoteInterne[];
  /** Notes écartées par la validation (illisibles). */
  notesIllisibles: number;
  /** Noms des membres cités (responsable, auteurs, valeurs), par identifiant. */
  nomsMembres: Record<string, string>;
  /** Noms actuels des catégories citées, par identifiant (AD-19). */
  nomsCategories: Record<string, string>;
};

/** Même règle que la contrainte CHECK de `demandes.reference`. */
export const FORMAT_REFERENCE = /^NOVA-[0-9]{4}-[0-9]{4,}$/;

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLONNES_DEMANDE =
  "id, reference, cree_le, canal, nom, email, telephone, societe, objet, description, categorie_id, statut, priorite, responsable_id, etat_email";

const COLONNES_HISTORIQUE =
  "id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le";

const COLONNES_NOTES = "id, auteur_id, texte, cree_le";

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

function date(v: unknown): v is string {
  return texte(v) && !Number.isNaN(Date.parse(v));
}

/** Premier champ invalide de la demande, ou null si elle est valide. */
function champInvalide(v: Record<string, unknown>): string | null {
  if (!texte(v.id)) return "id";
  if (!texte(v.reference)) return "reference";
  if (!date(v.cree_le)) return "cree_le";
  if (!inclus(CANAUX, v.canal)) return "canal";
  if (!texte(v.nom)) return "nom";
  if (!texteOuNull(v.email)) return "email";
  if (!texteOuNull(v.telephone)) return "telephone";
  if (!texteOuNull(v.societe)) return "societe";
  if (!texte(v.objet)) return "objet";
  if (!texte(v.description)) return "description";
  if (!texte(v.categorie_id)) return "categorie_id";
  if (!inclus(STATUTS, v.statut)) return "statut";
  if (!inclus(PRIORITES, v.priorite)) return "priorite";
  if (!texteOuNull(v.responsable_id)) return "responsable_id";
  if (!inclus(ETATS_EMAIL, v.etat_email)) return "etat_email";
  return null;
}

/**
 * Valide une ligne d'historique. Une ligne invalide est écartée (`null`) et
 * signalée au journal par son identifiant et le champ seulement.
 */
export function lireLigneHistorique(valeur: unknown): LigneHistorique | null {
  if (typeof valeur !== "object" || valeur === null) {
    console.error("[detail] ligne d'historique écartée : forme inattendue");
    return null;
  }
  const v = valeur as Record<string, unknown>;
  const id = typeof v.id === "number" || typeof v.id === "string" ? String(v.id) : null;
  let champ: string | null = null;
  if (id === null) champ = "id";
  else if (v.auteur_type !== "demandeur" && v.auteur_type !== "membre") champ = "auteur_type";
  else if (!texteOuNull(v.auteur_id)) champ = "auteur_id";
  else if (!inclus(TYPES_HISTORIQUE, v.type)) champ = "type";
  else if (!texteOuNull(v.ancienne_valeur)) champ = "ancienne_valeur";
  else if (!texteOuNull(v.nouvelle_valeur)) champ = "nouvelle_valeur";
  else if (!date(v.cree_le)) champ = "cree_le";
  if (champ !== null) {
    console.error(`[detail] ligne d'historique écartée : id=${id ?? "inconnu"} champ=${champ}`);
    return null;
  }
  return {
    id: id!,
    creeLe: v.cree_le as string,
    auteurType: v.auteur_type as "demandeur" | "membre",
    auteurId: v.auteur_id as string | null,
    type: v.type as TypeHistorique,
    ancienneValeur: v.ancienne_valeur as string | null,
    nouvelleValeur: v.nouvelle_valeur as string | null,
  };
}

/**
 * Valide une note interne. Une note invalide est écartée (`null`) et
 * signalée au journal par son identifiant et le champ seulement (jamais le texte).
 */
export function lireNote(valeur: unknown): NoteInterne | null {
  if (typeof valeur !== "object" || valeur === null) {
    console.error("[detail] note écartée : forme inattendue");
    return null;
  }
  const v = valeur as Record<string, unknown>;
  const id = typeof v.id === "number" || typeof v.id === "string" ? String(v.id) : null;
  let champ: string | null = null;
  if (id === null) champ = "id";
  else if (!texte(v.auteur_id)) champ = "auteur_id";
  else if (!texte(v.texte)) champ = "texte";
  else if (!date(v.cree_le)) champ = "cree_le";
  if (champ !== null) {
    console.error(`[detail] note écartée : id=${id ?? "inconnu"} champ=${champ}`);
    return null;
  }
  return {
    id: id!,
    creeLe: v.cree_le as string,
    auteurId: v.auteur_id as string,
    texte: v.texte as string,
  };
}

/** Identifiants de membres et de catégories cités par la demande, son historique et ses notes. */
function identifiantsCites(
  responsableId: string | null,
  categorieId: string,
  historique: LigneHistorique[],
  notes: NoteInterne[],
): { membres: string[]; categories: string[] } {
  const membres = new Set<string>();
  const categories = new Set<string>([categorieId]);
  if (responsableId) membres.add(responsableId);
  for (const note of notes) membres.add(note.auteurId);
  for (const ligne of historique) {
    if (ligne.auteurId) membres.add(ligne.auteurId);
    const nature = NATURE_VALEUR_HISTORIQUE[ligne.type];
    for (const valeur of [ligne.ancienneValeur, ligne.nouvelleValeur]) {
      if (valeur === null) continue;
      if (nature === "membre") membres.add(valeur);
      if (nature === "categorie") categories.add(valeur);
    }
  }
  const uuid = (id: string) => FORMAT_UUID.test(id);
  return { membres: [...membres].filter(uuid), categories: [...categories].filter(uuid) };
}

async function lireNoms(
  client: SupabaseClient,
  table: "membres" | "categories",
  ids: string[],
): Promise<Record<string, string> | null> {
  if (ids.length === 0) return {};
  const { data, error } = await client.from(table).select("id, nom").in("id", ids);
  if (error || !Array.isArray(data)) {
    console.error(`[detail] lecture des noms impossible : table=${table} code=${error?.code ?? "aucun"}`);
    return null;
  }
  const noms: Record<string, string> = {};
  for (const ligne of data as unknown[]) {
    const l = ligne as Record<string, unknown>;
    if (texte(l?.id) && texte(l?.nom)) noms[l.id] = l.nom;
  }
  return noms;
}

/** Lit le détail d'une demande avec un client porteur de la session. */
export async function lireDetailAvec(
  client: SupabaseClient,
  reference: string,
): Promise<Resultat<DetailDemande | null>> {
  // Référence mal formée : inutile d'interroger la base.
  if (!FORMAT_REFERENCE.test(reference)) return { ok: true, donnees: null };

  try {
    const { data: demande, error } = await client
      .from("demandes")
      .select(COLONNES_DEMANDE)
      .eq("reference", reference)
      .maybeSingle();
    if (error) {
      console.error(`[detail] lecture de la demande impossible : code=${error.code ?? "aucun"}`);
      return ECHEC;
    }
    // Inconnue, ou invisible pour ce compte (RLS) : introuvable.
    if (demande === null) return { ok: true, donnees: null };

    const d = demande as Record<string, unknown>;
    const champ = champInvalide(d);
    if (champ !== null) {
      console.error(`[detail] demande illisible : reference=${reference} champ=${champ}`);
      return ECHEC;
    }

    // Historique et notes : deux lectures indépendantes, lancées ensemble.
    const [
      { data: lignes, error: erreurHistorique },
      { data: lignesNotes, error: erreurNotes },
    ] = await Promise.all([
      // Ordre d'écriture (`id`) : deux changements simultanés s'enchaînent
      // sous le verrou, mais la transaction bloquée garde un `now()` antérieur
      // (story 2.4, migration 0017).
      client
        .from("historique")
        .select(COLONNES_HISTORIQUE)
        .eq("demande_id", d.id as string)
        .order("id", { ascending: true }),
      client
        .from("notes")
        .select(COLONNES_NOTES)
        .eq("demande_id", d.id as string)
        .order("cree_le", { ascending: true })
        .order("id", { ascending: true }),
    ]);
    if (erreurHistorique || !Array.isArray(lignes)) {
      console.error(
        `[detail] lecture de l'historique impossible : code=${erreurHistorique?.code ?? "aucun"}`,
      );
      return ECHEC;
    }
    const historique = (lignes as unknown[])
      .map(lireLigneHistorique)
      .filter((ligne): ligne is LigneHistorique => ligne !== null);
    const lignesIllisibles = lignes.length - historique.length;

    if (erreurNotes || !Array.isArray(lignesNotes)) {
      console.error(`[detail] lecture des notes impossible : code=${erreurNotes?.code ?? "aucun"}`);
      return ECHEC;
    }
    const notes = (lignesNotes as unknown[])
      .map(lireNote)
      .filter((note): note is NoteInterne => note !== null);
    const notesIllisibles = lignesNotes.length - notes.length;

    const responsableId = d.responsable_id as string | null;
    const categorieId = d.categorie_id as string;
    const ids = identifiantsCites(responsableId, categorieId, historique, notes);
    const [nomsMembres, nomsCategories] = await Promise.all([
      lireNoms(client, "membres", ids.membres),
      lireNoms(client, "categories", ids.categories),
    ]);
    if (nomsMembres === null || nomsCategories === null) return ECHEC;

    return {
      ok: true,
      donnees: {
        id: d.id as string,
        reference: d.reference as string,
        creeLe: d.cree_le as string,
        canal: d.canal as Canal,
        nom: d.nom as string,
        email: d.email as string | null,
        telephone: d.telephone as string | null,
        societe: d.societe as string | null,
        objet: d.objet as string,
        description: d.description as string,
        categorieId,
        statut: d.statut as Statut,
        priorite: d.priorite as Priorite,
        responsableId,
        etatEmail: d.etat_email as EtatEmail,
        historique,
        lignesIllisibles,
        notes,
        notesIllisibles,
        nomsMembres,
        nomsCategories,
      },
    };
  } catch {
    console.error("[detail] exception pendant la lecture");
    return ECHEC;
  }
}

/**
 * Détail d'une demande pour la personne connectée (pages de l'espace équipe).
 * Mis en commun pour une même requête (`cache`) : le titre de la page et la
 * page elle-même ne lisent la base qu'une fois.
 */
export const lireDetail = cache(async function lireDetail(
  reference: string,
): Promise<Resultat<DetailDemande | null>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[detail] client serveur indisponible");
    return ECHEC;
  }
  return lireDetailAvec(client, reference);
});
