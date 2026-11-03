import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Client Supabase côté serveur, avec la clé publiable et la session de la
// personne connectée (cookies). Les lectures sont filtrées par RLS.
// Il n'existe aucun client Supabase dans le navigateur (AD-1).
export async function creerClientServeur() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clePubliable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !clePubliable) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquant dans l'environnement.",
    );
  }

  const magasinCookies = await cookies();

  return createServerClient(url, clePubliable, {
    cookies: {
      getAll() {
        return magasinCookies.getAll();
      },
      setAll(cookiesAPoser) {
        try {
          for (const { name, value, options } of cookiesAPoser) {
            magasinCookies.set(name, value, options);
          }
        } catch {
          // Appelé depuis une page serveur : l'écriture des cookies y est
          // impossible. proxy.ts (story 1.4) rafraîchit la session.
        }
      },
    },
  });
}
