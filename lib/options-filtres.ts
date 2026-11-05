import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { messageErreur } from "@/lib/erreurs";
import type { OptionFiltre } from "@/lib/filtres";
import type { Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Choix des listes « Catégorie » et « Responsable » de la barre de filtres
// (story 2.5, EXPERIENCE.md §9.4), lus avec la SESSION de la personne
// connectée (RLS : membres actifs seulement ; colonnes `id`, `nom`, `actif`,
// `ordre` des catégories et `id`, `nom`, `etat` des membres) :
//   - toutes les catégories, y compris les désactivées (une demande peut en
//     garder une), dans l'ordre des formulaires ;
//   - les membres actifs et désactivés, par nom (un compte invité n'a jamais
//     de demande).

export type OptionsFiltres = {
  categories: OptionFiltre[];
  membres: OptionFiltre[];
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

type Ligne = Record<string, unknown> | null;

/** Lit les choix des filtres avec un client porteur de la session. */
export async function lireOptionsFiltresAvec(
  client: SupabaseClient,
): Promise<Resultat<OptionsFiltres>> {
  try {
    const [categories, membres] = await Promise.all([
      client
        .from("categories")
        .select("id, nom, actif")
        .order("ordre", { ascending: true })
        .order("nom", { ascending: true }),
      client
        .from("membres")
        .select("id, nom, etat")
        .in("etat", ["actif", "desactive"])
        .order("nom", { ascending: true }),
    ]);
    if (categories.error || membres.error || !categories.data || !membres.data) {
      console.error(
        `[filtres] lecture des choix impossible : code=${categories.error?.code ?? membres.error?.code ?? "aucun"}`,
      );
      return ECHEC;
    }
    return {
      ok: true,
      donnees: {
        categories: (categories.data as Ligne[])
          .filter((l) => typeof l?.id === "string" && typeof l.nom === "string")
          .map((l) => ({ id: l!.id as string, nom: l!.nom as string, desactive: l!.actif === false })),
        membres: (membres.data as Ligne[])
          .filter((l) => typeof l?.id === "string" && typeof l.nom === "string")
          .map((l) => ({ id: l!.id as string, nom: l!.nom as string, desactive: l!.etat === "desactive" })),
      },
    };
  } catch {
    console.error("[filtres] exception pendant la lecture des choix");
    return ECHEC;
  }
}

/** Choix des filtres pour la personne connectée. */
export async function lireOptionsFiltres(): Promise<Resultat<OptionsFiltres>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[filtres] client serveur indisponible");
    return ECHEC;
  }
  return lireOptionsFiltresAvec(client);
}
