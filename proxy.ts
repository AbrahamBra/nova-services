import type { NextRequest } from "next/server";
import { mettreAJourSession } from "@/lib/supabase/proxy";

// Proxy de Next.js 16 (ex-« middleware ») : rafraîchit la session et garde
// l'espace équipe (AD-28). Voir lib/supabase/proxy.ts.
export async function proxy(requete: NextRequest) {
  return mettreAJourSession(requete);
}

export const config = {
  // Seules les pages qui utilisent la session : l'espace équipe (y compris
  // `/equipe`) et la connexion. Les pages publiques (formulaire,
  // confirmation) ne lisent jamais la session.
  matcher: ["/equipe/:path*", "/connexion"],
};
