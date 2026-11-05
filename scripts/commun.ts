// Outils communs aux scripts de comptes (premier-admin.ts, comptes-de-test.ts).
// Lancés par Node avec la condition « react-server » (voir package.json),
// pour réutiliser lib/server/supabase-service.ts, seul endroit qui lit la clé
// secrète (AD-9).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { creerClientService } from "../lib/server/supabase-service.ts";
import { chargerEnvironnement } from "./charger-environnement.mjs";

/**
 * Charge l'environnement du script (scripts/charger-environnement.mjs) :
 * .env.local pour le projet de développement, ou, avec --production et
 * seulement si `productionPermise`, .env.scripts-production.local pour la
 * production (story 3.1). Arrête le script au moindre doute.
 */
export function preparerEnvironnement(
  nomScript: string,
  { productionPermise = false }: { productionPermise?: boolean } = {},
): "developpement" | "production" {
  return chargerEnvironnement(nomScript, { productionPermise });
}

export function clientService(): SupabaseClient {
  return creerClientService();
}

/** Client avec la clé publiable (publique), sans session conservée. */
export function clientPubliable(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !cle) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquant dans le fichier d'environnement.");
  }
  return createClient(url, cle, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export const FORMAT_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Code d'erreur prévu (AD-20) d'un appel rpc, ou null. */
export function codeErreur(erreur: { code?: string; message?: string } | null): string | null {
  if (!erreur) return null;
  return erreur.code === "P0001" ? (erreur.message ?? "").trim() : `inattendu (${erreur.code ?? "?"})`;
}

/** Cherche un compte Auth par email (pages de 1 000 comptes). */
export async function trouverCompteAuth(
  client: SupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  for (let page = 1; page < 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Liste des comptes Auth impossible : ${error.code ?? error.status}`);
    const trouve = data.users.find((u) => u.email?.toLowerCase() === email);
    if (trouve) return { id: trouve.id };
    if (data.users.length < 1000) return null;
  }
  return null;
}
