import "server-only";
import { messageErreur } from "@/lib/erreurs";
import { DUREE_MAX_MOIS, DUREE_MIN_MOIS } from "@/lib/schemas/parametres";
import { appeler, type ClientRpc, type Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Paramètres généraux de la page Paramètres (story 5.3) : lus avec la session
// de l'administrateur par `lire_parametres_admin()` (la base refuse toute
// autre personne : DROIT_INSUFFISANT), pour préremplir le formulaire.

export type ParametresAdmin = {
  nomAffiche: string;
  emailContact: string;
  dureeConservationMois: number;
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

/** Valide la réponse de `lire_parametres_admin()` ; null si elle n'a pas la forme attendue. */
export function lireReponseParametres(valeur: unknown): ParametresAdmin | null {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return null;
  const v = valeur as Record<string, unknown>;
  if (
    typeof v.nom_affiche !== "string" ||
    typeof v.email_contact !== "string" ||
    typeof v.duree_conservation_mois !== "number" ||
    !Number.isInteger(v.duree_conservation_mois) ||
    v.duree_conservation_mois < DUREE_MIN_MOIS ||
    v.duree_conservation_mois > DUREE_MAX_MOIS
  ) {
    return null;
  }
  return {
    nomAffiche: v.nom_affiche,
    emailContact: v.email_contact,
    dureeConservationMois: v.duree_conservation_mois,
  };
}

/** Appelle `lire_parametres_admin()` avec un client porteur de la session. */
export async function lireParametresAdminAvec(client: ClientRpc): Promise<Resultat<ParametresAdmin>> {
  const resultat = await appeler<unknown>(client, "lire_parametres_admin");
  if (!resultat.ok) return resultat;
  const parametres = lireReponseParametres(resultat.donnees);
  if (parametres === null) {
    console.error("[parametres] réponse inattendue de lire_parametres_admin");
    return ECHEC;
  }
  return { ok: true, donnees: parametres };
}

/** Paramètres de la page Paramètres, lus avec la session de la personne connectée. */
export async function lireParametresAdmin(): Promise<Resultat<ParametresAdmin>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[parametres] client serveur indisponible");
    return ECHEC;
  }
  return lireParametresAdminAvec(client);
}
