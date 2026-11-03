import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Logique de proxy.ts (AD-21, AD-28) :
//   - rafraîchit la session Supabase à chaque requête (getClaims), pour que
//     les pages serveur, qui ne peuvent pas écrire de cookies, reçoivent un
//     jeton valide ;
//   - renvoie toute adresse `/equipe/*` sans session vers
//     `/connexion?retour=…`.
// Le rôle et l'état du membre ne sont pas lus ici : les mises en page de
// l'espace équipe les vérifient dans `membres` (AD-3).
// À venir : déconnexion après 8 h (story 1.9).

/** En-tête interne : adresse demandée, pour la mise en page de l'espace équipe. */
export const ENTETE_CHEMIN = "x-nova-chemin";

export function estAdresseEquipe(chemin: string): boolean {
  return chemin === "/equipe" || chemin.startsWith("/equipe/");
}

export async function mettreAJourSession(requete: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clePubliable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const equipe = estAdresseEquipe(requete.nextUrl.pathname);
  // Appel d'action serveur (POST avec l'en-tête next-action) : jamais
  // redirigé vers la connexion ; l'action et la mise en page revérifient.
  const actionServeur = requete.method === "POST" && requete.headers.has("next-action");

  // Adresse demandée, transmise à la mise en page (jamais celle du client).
  requete.headers.delete(ENTETE_CHEMIN);
  if (equipe) {
    requete.headers.set(ENTETE_CHEMIN, requete.nextUrl.pathname + requete.nextUrl.search);
  }

  let reponse = NextResponse.next({ request: requete });

  if (!url || !clePubliable) {
    // Configuration absente : l'espace équipe reste fermé.
    return equipe && !actionServeur ? redirectionConnexion(requete) : reponse;
  }

  const supabase = createServerClient(url, clePubliable, {
    cookies: {
      getAll() {
        return requete.cookies.getAll();
      },
      setAll(cookiesAPoser, entetes) {
        for (const { name, value } of cookiesAPoser) requete.cookies.set(name, value);
        reponse = NextResponse.next({ request: requete });
        for (const { name, value, options } of cookiesAPoser) {
          reponse.cookies.set(name, value, options);
        }
        // En-têtes anti-cache fournis par @supabase/ssr quand un cookie de
        // session est posé : une réponse ne doit jamais servir à quelqu'un d'autre.
        for (const [cle, valeur] of Object.entries(entetes ?? {})) {
          reponse.headers.set(cle, valeur);
        }
      },
    },
  });

  // Ne rien placer entre la création du client et getClaims() : c'est cet
  // appel qui rafraîchit la session.
  let connecte = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    connecte = !error && Boolean(data?.claims);
  } catch {
    connecte = false;
  }

  if (equipe && !connecte && !actionServeur) {
    const redirection = redirectionConnexion(requete);
    // Garde les cookies éventuellement effacés (session expirée).
    for (const cookie of reponse.cookies.getAll()) redirection.cookies.set(cookie);
    return redirection;
  }

  return reponse;
}

function redirectionConnexion(requete: NextRequest): NextResponse {
  const cible = requete.nextUrl.clone();
  cible.pathname = "/connexion";
  cible.search = "";
  cible.searchParams.set("retour", requete.nextUrl.pathname + requete.nextUrl.search);
  return NextResponse.redirect(cible);
}
