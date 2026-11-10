"use server";

import { revalidatePath } from "next/cache";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import { lireReponseParametres, type ParametresAdmin } from "@/lib/parametres-admin";
import { verifierParametres, type ErreursParametres } from "@/lib/schemas/parametres";
import { appeler, signaler } from "@/lib/server/appeler";
import { lireProfil } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Action serveur de la page Paramètres (story 5.3) : nom affiché, email de
// contact, durée de conservation. Le rôle d'administrateur est revérifié ici
// (jamais seulement par l'écran), puis par la base. Après un changement, la
// page Paramètres et le formulaire public (`/`) sont rafraîchis ; la page de
// confirmation est toujours dynamique et l'email lit la base à l'envoi.

const CHEMIN_PARAMETRES = "/equipe/admin/parametres";
const CHEMIN_FORMULAIRE = "/";

/**
 * Résultat de « Enregistrer les paramètres » : valeurs enregistrées
 * (normalisées par la base) et `modifie` (faux si rien n'a changé) ; en
 * erreur, un message par champ refusé (`erreurs`) ou un bandeau.
 */
export type ResultatParametres =
  | { ok: true; donnees: ParametresAdmin & { modifie: boolean } }
  | { ok: false; code: CodeErreur; message: string; erreurs?: ErreursParametres };

function refus(code: CodeErreur): { ok: false; code: CodeErreur; message: string } {
  return { ok: false, code, message: messageErreur(code) };
}

/** Profil administrateur revérifié ; sinon le code du refus. */
async function verifierAdmin(): Promise<{ ok: true } | { ok: false; code: CodeErreur }> {
  const profil = await lireProfil();
  if (!profil.ok) return { ok: false, code: "ERREUR_INATTENDUE" };
  if (profil.donnees === null || !profil.donnees.estAdmin) return { ok: false, code: "ACCES_REFUSE" };
  return { ok: true };
}

/**
 * Enregistre les paramètres (story 5.3) : profil administrateur revérifié →
 * Zod (schéma partagé avec l'écran) → `modifier_parametres` avec la SESSION
 * de l'administrateur (bornes, normalisation, journal).
 */
export async function modifierParametres(saisie: unknown): Promise<ResultatParametres> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const verification = verifierParametres(saisie);
  if (!verification.ok) return { ...refus("DONNEES_INVALIDES"), erreurs: verification.erreurs };
  const { nom_affiche, email_contact, duree_conservation_mois } = verification.donnees;

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[modifierParametres] client serveur indisponible");
    return refus("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "modifier_parametres", {
    p_nom_affiche: nom_affiche,
    p_email_contact: email_contact,
    p_duree_mois: duree_conservation_mois,
  });
  if (!resultat.ok) {
    // Plus administrateur entre-temps : affiché comme ACCES_REFUSE.
    return refus(resultat.code === "DROIT_INSUFFISANT" ? "ACCES_REFUSE" : resultat.code);
  }

  const enregistres = lireReponseParametres(resultat.donnees);
  const modifie = (resultat.donnees as { modifie?: unknown } | null)?.modifie;
  if (enregistres === null || typeof modifie !== "boolean") {
    signaler("[modifierParametres] réponse inattendue de modifier_parametres");
    revalidatePath(CHEMIN_PARAMETRES);
    revalidatePath(CHEMIN_FORMULAIRE);
    return refus("ERREUR_INATTENDUE");
  }

  if (modifie) {
    revalidatePath(CHEMIN_PARAMETRES);
    revalidatePath(CHEMIN_FORMULAIRE);
  }
  return { ok: true, donnees: { ...enregistres, modifie } };
}
