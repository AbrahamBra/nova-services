import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { adresseDeRetour } from "@/lib/schemas/connexion";

// Logique de proxy.ts (AD-21, AD-28) :
//   - rafraîchit la session Supabase à chaque requête (getClaims), pour que
//     les pages serveur, qui ne peuvent pas écrire de cookies, reçoivent un
//     jeton valide ;
//   - renvoie toute adresse `/equipe/*` sans session vers
//     `/connexion?retour=…` ;
//   - ferme les sessions ouvertes depuis plus de 8 h (story 1.9, AD-21).
//     L'heure de connexion est l'horodatage le plus récent du claim `amr`
//     (méthode `password` ou lien), qui ne change pas quand le jeton est rafraîchi (vérifié sur
//     nova-dev : `iat` change, `amr[].timestamp` non). Horodatage
//     introuvable : session traitée comme expirée.
// Le rôle et l'état du membre ne sont pas lus ici : les mises en page de
// l'espace équipe les vérifient dans `membres` (AD-3).

/** En-tête interne : adresse demandée, pour la mise en page de l'espace équipe. */
export const ENTETE_CHEMIN = "x-nova-chemin";

/** Paramètre de /connexion qui affiche « Votre session a expiré… ». */
export const PARAMETRE_EXPIREE = "expiree";

/** Durée maximale d'une session : 8 h après la connexion (AD-21). */
export const DUREE_MAX_SESSION_MS = 8 * 60 * 60 * 1000;

/**
 * Heure de connexion (en millisecondes) lue dans les claims : horodatage le
 * plus récent parmi toutes les entrées du claim `amr` (mot de passe, mais
 * aussi lien d'invitation ou de réinitialisation, epic 4). null si
 * introuvable (claim absent, au format texte, horodatage invalide).
 */
export function heureDeConnexion(claims: unknown): number | null {
  if (typeof claims !== "object" || claims === null) return null;
  const amr = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return null;
  let heure: number | null = null;
  for (const entree of amr) {
    if (typeof entree !== "object" || entree === null) continue;
    const { timestamp } = entree as { timestamp?: unknown };
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) continue;
    const ms = timestamp * 1000;
    if (heure === null || ms > heure) heure = ms;
  }
  return heure;
}

/** Vrai si la session doit être fermée : plus de 8 h, ou heure introuvable. */
export function sessionExpiree(claims: unknown, maintenant: number = Date.now()): boolean {
  const heure = heureDeConnexion(claims);
  return heure === null || maintenant - heure > DUREE_MAX_SESSION_MS;
}

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
  let claims: unknown = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    connecte = !error && Boolean(data?.claims);
    claims = connecte ? data?.claims : null;
  } catch {
    connecte = false;
  }

  // Limite de 8 h (AD-21) : session fermée (signOut, cookies effacés), puis
  // retour à la connexion avec le message d'expiration. Un appel d'action
  // serveur n'est pas redirigé, mais arrive sans session.
  if (connecte && sessionExpiree(claims)) {
    const nomsSession = requete.cookies
      .getAll()
      .map(({ name }) => name)
      .filter((nom) => nom.startsWith("sb-"));
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) console.error(`[proxy] échec de signOut : statut=${error.status ?? "aucun"}`);
    } catch {
      console.error("[proxy] exception pendant signOut");
    }
    // Dans tous les cas (même si Auth ne répond pas) : cookies de session
    // retirés de la requête (la page ou l'action ne voit plus de session) et
    // effacés dans le navigateur.
    for (const nom of nomsSession) requete.cookies.delete(nom);
    const cookiesPoses = reponse.cookies.getAll();
    reponse = NextResponse.next({ request: requete });
    for (const cookie of cookiesPoses) reponse.cookies.set(cookie);
    for (const nom of nomsSession) reponse.cookies.set(nom, "", { path: "/", maxAge: 0 });
    reponse.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
    if (actionServeur) return reponse;
    const dejaSurConnexion =
      requete.nextUrl.pathname === "/connexion" &&
      requete.nextUrl.searchParams.has(PARAMETRE_EXPIREE);
    const redirection = dejaSurConnexion ? reponse : redirectionExpiree(requete);
    if (redirection !== reponse) {
      for (const cookie of reponse.cookies.getAll()) redirection.cookies.set(cookie);
      redirection.headers.set("Cache-Control", reponse.headers.get("Cache-Control") ?? "no-store");
    }
    return redirection;
  }

  if (equipe && !connecte && !actionServeur) {
    const redirection = redirectionConnexion(requete);
    // Garde les cookies éventuellement effacés (session expirée).
    for (const cookie of reponse.cookies.getAll()) redirection.cookies.set(cookie);
    return redirection;
  }

  return reponse;
}

function redirectionExpiree(requete: NextRequest): NextResponse {
  const cible = requete.nextUrl.clone();
  cible.pathname = "/connexion";
  cible.search = "";
  cible.searchParams.set(PARAMETRE_EXPIREE, "1");
  if (estAdresseEquipe(requete.nextUrl.pathname)) {
    cible.searchParams.set("retour", requete.nextUrl.pathname + requete.nextUrl.search);
  } else {
    // Déjà sur /connexion : l'adresse de retour existante est gardée si elle
    // est valide (mêmes règles que la page, AD-28).
    const retour = requete.nextUrl.searchParams.get("retour");
    if (retour !== null && adresseDeRetour(retour) === retour) {
      cible.searchParams.set("retour", retour);
    }
  }
  return NextResponse.redirect(cible);
}

function redirectionConnexion(requete: NextRequest): NextResponse {
  const cible = requete.nextUrl.clone();
  cible.pathname = "/connexion";
  cible.search = "";
  cible.searchParams.set("retour", requete.nextUrl.pathname + requete.nextUrl.search);
  return NextResponse.redirect(cible);
}
