import "server-only";
import { createClient } from "@supabase/supabase-js";

// Client Supabase avec la clé secrète : contourne RLS.
// Seul endroit où SUPABASE_SECRET_KEY est lue (AD-9). Réservé aux actions
// serveur qui en ont besoin (dépôt public, comptes, emails).
export function creerClientService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleSecrete = process.env.SUPABASE_SECRET_KEY;
  if (!url || !cleSecrete) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY manquant dans l'environnement.",
    );
  }

  return createClient(url, cleSecrete, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
