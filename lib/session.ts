import "server-only";
import { cache } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { ROLES, type Role } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { appeler, type ClientRpc, type Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Profil du membre connecté, lu à chaque requête dans `membres` via
// `mon_profil()` (AD-3) : jamais dans les métadonnées Auth.
// `null` : pas de session, ou compte qui n'est pas un membre actif.

export type Profil = {
  nom: string;
  role: Role;
  /** Premier mot du nom, pour « Bonjour [prénom] ». */
  prenom: string;
  estAdmin: boolean;
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

export function prenomDe(nom: string): string {
  return nom.trim().split(/\s+/)[0] ?? "";
}

/** Valide la réponse de `mon_profil()` : membre actif, ou null. */
export function lireReponseProfil(valeur: unknown): Profil | null | undefined {
  if (valeur === null) return null;
  if (typeof valeur !== "object") return undefined;
  const v = valeur as Record<string, unknown>;
  if (
    typeof v.nom !== "string" ||
    typeof v.role !== "string" ||
    !(ROLES as readonly string[]).includes(v.role) ||
    v.etat !== "actif"
  ) {
    return undefined;
  }
  const role = v.role as Role;
  return { nom: v.nom, role, prenom: prenomDe(v.nom), estAdmin: role === "administrateur" };
}

/** Appelle `mon_profil()` avec un client porteur de la session. */
export async function profilDuClient(client: ClientRpc): Promise<Resultat<Profil | null>> {
  const resultat = await appeler<unknown>(client, "mon_profil");
  if (!resultat.ok) return resultat;
  const profil = lireReponseProfil(resultat.donnees);
  if (profil === undefined) {
    console.error("[session] réponse inattendue de mon_profil");
    return ECHEC;
  }
  return { ok: true, donnees: profil };
}

/**
 * Profil du membre connecté, une seule lecture par requête (mises en page et
 * pages de l'espace équipe).
 */
export const lireProfil = cache(async (): Promise<Resultat<Profil | null>> => {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[session] client serveur indisponible");
    return ECHEC;
  }

  // Session vérifiée (signature du jeton) avant d'interroger la base.
  // Seule une session absente ou invalide donne « pas de profil » ; une
  // panne passagère (réseau, Auth indisponible) est une erreur, pour ne pas
  // renvoyer un membre connecté vers la page de connexion.
  try {
    const { data, error } = await client.auth.getClaims();
    if (error) {
      if (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500) {
        console.error(`[session] getClaims indisponible : statut=${error.status ?? "aucun"}`);
        return ECHEC;
      }
      return { ok: true, donnees: null };
    }
    if (!data?.claims) return { ok: true, donnees: null };
  } catch {
    console.error("[session] exception pendant getClaims");
    return ECHEC;
  }

  return profilDuClient(client);
});
