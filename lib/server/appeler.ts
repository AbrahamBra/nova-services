import "server-only";
import * as Sentry from "@sentry/nextjs";
import {
  estCodeErreur,
  messageErreur,
  type CodeErreur,
} from "@/lib/erreurs";

// Forme unique du résultat des actions serveur (AD-7).
export type Resultat<T> =
  | { ok: true; donnees: T }
  | { ok: false; code: CodeErreur; message: string };

// Ce dont appeler() a besoin d'un client Supabase : sa méthode rpc().
// Un client serveur (session) ou service (clé secrète) convient.
type ErreurPostgrest = { code?: string; message?: string } | null;
export type ClientRpc = {
  rpc: (
    fonction: string,
    parametres?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: ErreurPostgrest }>;
};

// Code PostgreSQL des erreurs prévues : RAISE EXCEPTION USING ERRCODE = 'P0001'.
const ERRCODE_PREVUE = "P0001";

function echec(code: CodeErreur): { ok: false; code: CodeErreur; message: string } {
  return { ok: false, code, message: messageErreur(code) };
}

/** Trace une erreur imprévue dans la console et dans Sentry (sans effet sans DSN). */
function signaler(message: string): void {
  console.error(message);
  try {
    Sentry.captureMessage(message, "error");
  } catch {
    // Le suivi des erreurs ne doit jamais faire échouer appeler().
  }
}

/**
 * Appelle une fonction SQL et traduit sa réponse (AD-7, AD-20).
 * - succès : { ok: true, donnees }
 * - erreur prévue (P0001 + code connu de lib/erreurs.ts) : { ok: false, code, message }
 * - tout le reste : ERREUR_INATTENDUE. Aucune exception ne remonte.
 */
export async function appeler<T>(
  client: ClientRpc,
  fonction: string,
  parametres?: Record<string, unknown>,
): Promise<Resultat<T>> {
  try {
    const { data, error } = await client.rpc(fonction, parametres);
    if (error) {
      const code = error.message?.trim();
      if (error.code === ERRCODE_PREVUE && estCodeErreur(code)) {
        return echec(code);
      }
      // Erreur imprévue : console et Sentry reçoivent le nom de la fonction
      // et le code Postgres seulement, jamais les paramètres ni le message
      // (AD-14).
      signaler(`[appeler] erreur inattendue : fonction=${fonction} code=${error.code ?? "inconnu"}`);
      return echec("ERREUR_INATTENDUE");
    }
    return { ok: true, donnees: data as T };
  } catch {
    signaler(`[appeler] exception : fonction=${fonction} code=aucun`);
    return echec("ERREUR_INATTENDUE");
  }
}
