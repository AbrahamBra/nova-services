import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { messageErreur } from "@/lib/erreurs";
import type { Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Catégories de la liste « Catégorie » du détail (story 2.4), lues avec la
// SESSION de la personne connectée (RLS : membres actifs seulement ; colonnes
// `id`, `nom`, `actif`, `ordre`, migration 0017) : les catégories actives,
// dans l'ordre des formulaires, et la catégorie actuelle de la demande avec
// son vrai état (`actif`), même désactivée (règle 9).

export type CategorieListe = { id: string; nom: string };

export type CategoriesDetail = {
  /** Catégories actives, dans l'ordre des formulaires (`ordre`, puis `nom`). */
  actives: CategorieListe[];
  /** Catégorie actuelle de la demande, ou null si elle n'a pas été lue. */
  actuelle: (CategorieListe & { actif: boolean }) | null;
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lit les catégories actives et la catégorie actuelle avec un client porteur de la session. */
export async function lireCategoriesAvec(
  client: SupabaseClient,
  categorieId: string,
): Promise<Resultat<CategoriesDetail>> {
  // Identifiant venu de la base ; vérifié quand même avant d'entrer dans le filtre.
  if (!FORMAT_UUID.test(categorieId)) return ECHEC;
  try {
    const { data, error } = await client
      .from("categories")
      .select("id, nom, actif")
      .or(`actif.eq.true,id.eq.${categorieId}`)
      .order("ordre", { ascending: true })
      .order("nom", { ascending: true });
    if (error || !Array.isArray(data)) {
      console.error(`[categories] lecture impossible : code=${error?.code ?? "aucun"}`);
      return ECHEC;
    }
    const lignes = (data as unknown[]).filter(
      (l): l is { id: string; nom: string; actif: boolean } => {
        const v = l as Record<string, unknown> | null;
        return (
          typeof v?.id === "string" && typeof v.nom === "string" && typeof v.actif === "boolean"
        );
      },
    );
    const actuelle = lignes.find((l) => l.id === categorieId) ?? null;
    return {
      ok: true,
      donnees: {
        actives: lignes.filter((l) => l.actif).map(({ id, nom }) => ({ id, nom })),
        actuelle,
      },
    };
  } catch {
    console.error("[categories] exception pendant la lecture");
    return ECHEC;
  }
}

/** Catégories du détail pour la personne connectée. */
export async function lireCategoriesActives(
  categorieId: string,
): Promise<Resultat<CategoriesDetail>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[categories] client serveur indisponible");
    return ECHEC;
  }
  return lireCategoriesAvec(client, categorieId);
}

/**
 * Catégories actives de la saisie interne (story 2.6), dans l'ordre des
 * formulaires, lues avec la session de la personne connectée.
 */
export async function lireCategoriesSaisie(): Promise<Resultat<CategorieListe[]>> {
  try {
    const client = await creerClientServeur();
    const { data, error } = await client
      .from("categories")
      .select("id, nom")
      .eq("actif", true)
      .order("ordre", { ascending: true })
      .order("nom", { ascending: true });
    if (error || !Array.isArray(data)) {
      console.error(`[categories] lecture impossible : code=${error?.code ?? "aucun"}`);
      return ECHEC;
    }
    const lignes = (data as unknown[]).filter((l): l is CategorieListe => {
      const v = l as Record<string, unknown> | null;
      return typeof v?.id === "string" && typeof v.nom === "string";
    });
    return { ok: true, donnees: lignes.map(({ id, nom }) => ({ id, nom })) };
  } catch {
    console.error("[categories] exception pendant la lecture");
    return ECHEC;
  }
}
