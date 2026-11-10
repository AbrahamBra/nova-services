import "server-only";
import { messageErreur } from "@/lib/erreurs";
import { lireReponseExpirees, type Expirees } from "@/lib/schemas/donnees";
import { appeler, signaler, type ClientRpc, type Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Nombre de demandes expirées (story 5.5) : lu avec la session de
// l'administrateur par `compter_expirees()` (la base refuse toute autre
// personne : DROIT_INSUFFISANT), au chargement de la page Données
// personnelles et après un refus EXPIREES_CHANGEES.

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

/** Appelle `compter_expirees()` avec un client porteur de la session. */
export async function lireExpireesAvec(client: ClientRpc): Promise<Resultat<Expirees>> {
  const resultat = await appeler<unknown>(client, "compter_expirees");
  if (!resultat.ok) return resultat;
  const expirees = lireReponseExpirees(resultat.donnees);
  if (expirees === null) {
    signaler("[expirees] réponse inattendue de compter_expirees");
    return ECHEC;
  }
  return { ok: true, donnees: expirees };
}

/** Nombre de demandes expirées, lu avec la session de la personne connectée. */
export async function lireExpirees(): Promise<Resultat<Expirees>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    signaler("[expirees] client serveur indisponible");
    return ECHEC;
  }
  return lireExpireesAvec(client);
}
