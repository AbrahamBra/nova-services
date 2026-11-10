import "server-only";
import { messageErreur } from "@/lib/erreurs";
import { appeler, type ClientRpc, type Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Catégories de la page Catégories (story 5.2) : lues avec la session de
// l'administrateur par `lister_categories_admin()` (la base refuse toute
// autre personne : DROIT_INSUFFISANT), dans l'ordre des formulaires
// (`ordre`, puis `nom`), avec le nombre de demandes qui les utilisent.

export type CategorieAdmin = {
  id: string;
  nom: string;
  actif: boolean;
  ordre: number;
  /** Nombre de demandes de cette catégorie, toutes demandes confondues. */
  demandes: number;
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

function entierPositifOuNul(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 0;
}

/**
 * Valide la réponse de `lister_categories_admin()` ; null si elle n'a pas la
 * forme attendue. L'ordre de la base (`ordre, nom`) est conservé.
 */
export function lireReponseCategories(valeur: unknown): CategorieAdmin[] | null {
  if (!Array.isArray(valeur)) return null;
  const categories: CategorieAdmin[] = [];
  for (const element of valeur) {
    if (typeof element !== "object" || element === null) return null;
    const v = element as Record<string, unknown>;
    if (
      typeof v.id !== "string" ||
      typeof v.nom !== "string" ||
      typeof v.actif !== "boolean" ||
      typeof v.ordre !== "number" ||
      !Number.isInteger(v.ordre) ||
      !entierPositifOuNul(v.demandes)
    ) {
      return null;
    }
    categories.push({ id: v.id, nom: v.nom, actif: v.actif, ordre: v.ordre, demandes: v.demandes });
  }
  return categories;
}

/** Appelle `lister_categories_admin()` avec un client porteur de la session. */
export async function lireCategoriesAdminAvec(client: ClientRpc): Promise<Resultat<CategorieAdmin[]>> {
  const resultat = await appeler<unknown>(client, "lister_categories_admin");
  if (!resultat.ok) return resultat;
  const categories = lireReponseCategories(resultat.donnees);
  if (categories === null) {
    console.error("[categories] réponse inattendue de lister_categories_admin");
    return ECHEC;
  }
  return { ok: true, donnees: categories };
}

/** Catégories de la page Catégories, lues avec la session de la personne connectée. */
export async function lireCategoriesAdmin(): Promise<Resultat<CategorieAdmin[]>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[categories] client serveur indisponible");
    return ECHEC;
  }
  return lireCategoriesAdminAvec(client);
}
