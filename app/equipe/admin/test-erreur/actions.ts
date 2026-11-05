"use server";

import { messageErreur } from "@/lib/erreurs";
import type { Resultat } from "@/lib/server/appeler";
import { lireProfil } from "@/lib/session";

// Page de test du suivi des erreurs (story 3.3, OPS-1). Un fichier
// « use server » n'exporte que des fonctions asynchrones.

const MESSAGE_ERREUR_TEST = "Erreur de test Sentry (volontaire)";

/**
 * Lève volontairement une erreur, capturée automatiquement par Sentry
 * (`onRequestError` dans instrumentation.ts). Le rôle est revérifié ici
 * (AD-1) : appelée par un non-administrateur, l'action refuse sans lever
 * d'erreur, donc sans rien envoyer.
 */
export async function provoquerErreurTest(): Promise<Resultat<never>> {
  const profil = await lireProfil();
  if (!profil.ok) return profil;
  if (profil.donnees === null || !profil.donnees.estAdmin) {
    return { ok: false, code: "ACCES_REFUSE", message: messageErreur("ACCES_REFUSE") };
  }
  throw new Error(MESSAGE_ERREUR_TEST);
}
