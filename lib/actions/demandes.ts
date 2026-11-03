"use server";

import { redirect, RedirectType } from "next/navigation";
import { messageErreur } from "@/lib/erreurs";
import { appeler } from "@/lib/server/appeler";
import { creerClientService } from "@/lib/server/supabase-service";
import {
  lireSaisieDepot,
  verifierDepot,
  type EtatDepot,
} from "@/lib/schemas/depot";

// Actions serveur sur les demandes (AD-7). Story 1.3 : dépôt public.
// À venir : champ piège et limite d'envois (story 1.8), email de
// confirmation (story 1.7).

type ReponseDepot = { reference: string; jeton: string };

function estReponseDepot(valeur: unknown): valeur is ReponseDepot {
  if (typeof valeur !== "object" || valeur === null) return false;
  const v = valeur as Record<string, unknown>;
  return (
    typeof v.reference === "string" &&
    /^NOVA-\d{4}-\d{4,}$/.test(v.reference) &&
    typeof v.jeton === "string" &&
    /^[0-9a-f]{64}$/.test(v.jeton)
  );
}

function erreurGenerale(etat: EtatDepot, message: string): EtatDepot {
  return { erreurs: {}, erreurGenerale: message, tentative: etat.tentative + 1 };
}

/**
 * Dépôt public : Zod → `deposer_demande` (clé secrète) → page de
 * confirmation. En cas d'erreur, renvoie les messages à afficher ; la saisie
 * reste dans le formulaire.
 */
export async function deposer(etat: EtatDepot, formulaire: FormData): Promise<EtatDepot> {
  const verification = verifierDepot(lireSaisieDepot(formulaire));
  if (!verification.ok) {
    // Clé falsifiée : les messages sous les champs ne la corrigeraient pas.
    if (verification.cleInvalide) {
      return erreurGenerale(etat, messageErreur("DONNEES_INVALIDES"));
    }
    return { erreurs: verification.erreurs, erreurGenerale: null, tentative: etat.tentative + 1 };
  }

  const d = verification.donnees;

  let client;
  try {
    client = creerClientService();
  } catch {
    console.error("[deposer] client service indisponible");
    return erreurGenerale(etat, messageErreur("ERREUR_INATTENDUE"));
  }

  const resultat = await appeler<unknown>(client, "deposer_demande", {
    p_cle_envoi: d.cle_envoi,
    p_nom: d.nom,
    p_email: d.email,
    p_telephone: d.telephone,
    p_societe: d.societe,
    p_categorie_id: d.categorie_id,
    p_objet: d.objet,
    p_description: d.description,
    p_consentement: d.consentement,
  });

  if (!resultat.ok) {
    switch (resultat.code) {
      case "CATEGORIE_INVALIDE":
        return {
          erreurs: { categorie_id: resultat.message },
          erreurGenerale: null,
          tentative: etat.tentative + 1,
        };
      case "CONSENTEMENT_REQUIS":
        return {
          erreurs: { consentement: resultat.message },
          erreurGenerale: null,
          tentative: etat.tentative + 1,
        };
      default:
        return erreurGenerale(etat, resultat.message);
    }
  }

  if (!estReponseDepot(resultat.donnees)) {
    console.error("[deposer] réponse inattendue de deposer_demande");
    return erreurGenerale(etat, messageErreur("ERREUR_INATTENDUE"));
  }

  // Remplace l'adresse du formulaire dans l'historique du navigateur : un
  // retour arrière ne réaffiche pas le formulaire rempli avec la même clé.
  redirect(`/confirmation/${resultat.donnees.jeton}`, RedirectType.replace);
}
