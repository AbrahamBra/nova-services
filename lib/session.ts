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

export type ProfilMembre = {
  nom: string;
  role: Role;
  /** Premier mot du nom, pour « Bonjour [prénom] ». */
  prenom: string;
  estAdmin: boolean;
};

/**
 * Profil de la session : avec l'identifiant du membre (story 2.7, pour savoir
 * si je suis le responsable d'une demande), tiré de la session vérifiée
 * (`sub` des claims, le même identifiant que `auth.uid()` et `membres.id`).
 */
export type Profil = ProfilMembre & { id: string };

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

export function prenomDe(nom: string): string {
  return nom.trim().split(/\s+/)[0] ?? "";
}

/** Valide la réponse de `mon_profil()` : membre actif, ou null. */
export function lireReponseProfil(valeur: unknown): ProfilMembre | null | undefined {
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
export async function profilDuClient(client: ClientRpc): Promise<Resultat<ProfilMembre | null>> {
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

  let id: unknown;
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
    id = data.claims.sub;
  } catch {
    console.error("[session] exception pendant getClaims");
    return ECHEC;
  }
  if (typeof id !== "string" || id === "") return { ok: true, donnees: null };

  const profil = await profilDuClient(client);
  if (!profil.ok) return profil;
  if (profil.donnees === null) return { ok: true, donnees: null };
  return { ok: true, donnees: { ...profil.donnees, id } };
});

/**
 * Invitation du compte connecté (story 4.1) : `mon_invitation()` donne son nom
 * s'il est encore à l'état `invite`. `null` : pas d'invitation en cours
 * (actif, désactivé, sans membre) ; `undefined` : erreur.
 */
export async function invitationDuClient(
  client: ClientRpc,
): Promise<{ nom: string; prenom: string } | null | undefined> {
  const resultat = await appeler<unknown>(client, "mon_invitation");
  if (!resultat.ok) return undefined;
  if (resultat.donnees === null) return null;
  const nom = (resultat.donnees as { nom?: unknown } | null)?.nom;
  if (typeof nom !== "string" || nom === "") {
    console.error("[session] réponse inattendue de mon_invitation");
    return undefined;
  }
  return { nom, prenom: prenomDe(nom) };
}

/**
 * Vrai si une erreur de Supabase Auth est une panne passagère (réseau,
 * limite de requêtes 429, erreur 5xx) et non un refus : à afficher comme une
 * erreur serveur, avec « Réessayer », jamais comme un lien plus valable.
 */
export function estPanneAuth(erreur: unknown): boolean {
  if (isAuthRetryableFetchError(erreur)) return true;
  const statut = (erreur as { status?: unknown } | null)?.status;
  return typeof statut === "number" && (statut === 429 || statut >= 500);
}
