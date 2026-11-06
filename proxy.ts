import type { NextRequest } from "next/server";
import { mettreAJourSession } from "@/lib/supabase/proxy";

// Proxy de Next.js 16 (ex-« middleware ») : rafraîchit la session et garde
// l'espace équipe (AD-28). Voir lib/supabase/proxy.ts.
export async function proxy(requete: NextRequest) {
  return mettreAJourSession(requete);
}

export const config = {
  // Seules les pages qui utilisent la session : l'espace équipe (y compris
  // `/equipe`), la connexion et, story 4.1, le lien d'invitation
  // (`/auth/confirmer`, qui pose la session de l'invité) et le choix du mot de
  // passe. Les pages publiques (formulaire, confirmation) ne lisent jamais la
  // session.
  matcher: ["/equipe/:path*", "/connexion", "/auth/confirmer", "/nouveau-mot-de-passe"],
};
