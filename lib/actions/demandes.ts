"use server";

import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { messageErreur } from "@/lib/erreurs";
import { lireAdresseIp } from "@/lib/server/adresse-ip";
import { appeler, type ClientRpc } from "@/lib/server/appeler";
import { envoyerConfirmation } from "@/lib/server/emails";
import { empreinteIp } from "@/lib/server/empreintes";
import { creerClientService } from "@/lib/server/supabase-service";
import {
  champPiegeRempli,
  lireSaisieDepot,
  verifierDepot,
  type EtatDepot,
} from "@/lib/schemas/depot";

// Actions serveur sur les demandes (AD-7). Story 1.3 : dépôt public ;
// story 1.7 : email de confirmation ; story 1.8 : champ piège et limite
// d'envois (5 en 10 minutes par empreinte d'IP, vérifiée par la base).

type ReponseDepot = { reference: string; jeton: string };

/** Données de l'email renvoyées par `deposer_demande` (migrations 0009, 0010). */
type DonneesEmailDepot = {
  id: string;
  objet: string;
  cree_le: string;
  nom_affiche: string;
  email_contact: string;
  nouvelle: boolean;
  etat_email: string;
};

function lireDonneesEmail(valeur: unknown): DonneesEmailDepot | null {
  if (typeof valeur !== "object" || valeur === null) return null;
  const v = valeur as Record<string, unknown>;
  if (
    typeof v.id === "string" &&
    typeof v.objet === "string" &&
    typeof v.cree_le === "string" &&
    typeof v.nom_affiche === "string" &&
    typeof v.email_contact === "string" &&
    typeof v.nouvelle === "boolean" &&
    typeof v.etat_email === "string"
  ) {
    return {
      id: v.id,
      objet: v.objet,
      cree_le: v.cree_le,
      nom_affiche: v.nom_affiche,
      email_contact: v.email_contact,
      nouvelle: v.nouvelle,
      etat_email: v.etat_email,
    };
  }
  return null;
}

/** Note le résultat de l'email ; un refus (déjà noté…) est seulement tracé. */
async function noterResultatEmail(
  client: ClientRpc,
  demandeId: string,
  etat: string,
  code: string | null,
): Promise<void> {
  const notation = await appeler<unknown>(client, "noter_resultat_email", {
    p_demande_id: demandeId,
    p_etat: etat,
    p_code_erreur: code,
  });
  if (!notation.ok) {
    console.error(`[deposer] résultat de l'email non noté : code=${notation.code}`);
  }
}

/**
 * Envoie l'email de confirmation puis note le résultat sur la demande
 * (AD-13). Ne lève jamais d'exception et ne change jamais l'issue du dépôt :
 * un échec est seulement noté (et inscrit au journal par la base).
 * Traces : codes seulement, jamais l'adresse (AD-14).
 */
async function envoyerEmailConfirmation(
  client: ClientRpc,
  destinataire: string,
  reference: string,
  donnees: DonneesEmailDepot,
): Promise<void> {
  try {
    const { etat, code } = await envoyerConfirmation(destinataire, {
      demandeId: donnees.id,
      reference,
      objet: donnees.objet,
      creeLe: donnees.cree_le,
      nomAffiche: donnees.nom_affiche,
      emailContact: donnees.email_contact,
    });
    if (etat === "echec") {
      console.error(`[deposer] email de confirmation non envoyé : code=${code ?? "inconnu"}`);
      // Envoi simultané avec la même clé d'idempotence (double clic) : l'autre
      // appel envoie l'email et note le résultat.
      if (code === "concurrent_idempotent_requests") return;
    }
    await noterResultatEmail(client, donnees.id, etat, code);
  } catch {
    console.error("[deposer] exception pendant l'envoi de l'email de confirmation");
  }
}

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
 * Empreinte HMAC de l'IP du visiteur (AD-14), ou null si elle ne peut pas
 * être calculée (secret absent en production, en-tête Netlify absent).
 * L'IP n'est jamais tracée ; seules les causes le sont.
 */
async function empreinteDuVisiteur(): Promise<string | null> {
  try {
    const ip = lireAdresseIp(await headers());
    if (ip === null) {
      console.error("[deposer] adresse IP introuvable dans les en-têtes");
      return null;
    }
    return empreinteIp(ip);
  } catch (erreur) {
    const nom = erreur instanceof Error ? erreur.name : typeof erreur;
    console.error(`[deposer] exception pendant le calcul de l'empreinte d'IP : ${nom}`);
    return null;
  }
}

/**
 * Dépôt public (AD-16) : champ piège → Zod → `deposer_demande` (clé secrète,
 * avec l'empreinte d'IP : la base applique la limite d'envois) → email de
 * confirmation → `noter_resultat_email` → page de confirmation. En cas
 * d'erreur du dépôt, renvoie les messages à afficher ; la saisie reste dans
 * le formulaire. L'email ne fait jamais échouer le dépôt.
 */
export async function deposer(etat: EtatDepot, formulaire: FormData): Promise<EtatDepot> {
  // Champ piège rempli : rien n'est enregistré, message neutre sans la raison.
  if (champPiegeRempli(formulaire)) {
    console.warn("[deposer] champ piège rempli");
    return erreurGenerale(etat, messageErreur("ENVOI_IMPOSSIBLE"));
  }

  const verification = verifierDepot(lireSaisieDepot(formulaire));
  if (!verification.ok) {
    // Clé falsifiée : les messages sous les champs ne la corrigeraient pas.
    if (verification.cleInvalide) {
      return erreurGenerale(etat, messageErreur("DONNEES_INVALIDES"));
    }
    return { erreurs: verification.erreurs, erreurGenerale: null, tentative: etat.tentative + 1 };
  }

  const d = verification.donnees;

  const empreinte = await empreinteDuVisiteur();
  if (empreinte === null) {
    return erreurGenerale(etat, messageErreur("ERREUR_INATTENDUE"));
  }

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
    p_empreinte_ip: empreinte,
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
      case "TROP_D_ENVOIS":
        // Bandeau, saisie conservée, pas de confirmation. Trace sans IP ni saisie.
        console.warn("[deposer] limite d'envois atteinte");
        return erreurGenerale(etat, resultat.message);
      default:
        return erreurGenerale(etat, resultat.message);
    }
  }

  if (!estReponseDepot(resultat.donnees)) {
    console.error("[deposer] réponse inattendue de deposer_demande");
    return erreurGenerale(etat, messageErreur("ERREUR_INATTENDUE"));
  }

  // Email pour une demande nouvelle, ou encore `en_attente` (premier envoi
  // coupé, notation perdue, second envoi de la même clé). La clé
  // d'idempotence de Resend évite un second email pour la même demande.
  const donneesEmail = lireDonneesEmail(resultat.donnees);
  if (donneesEmail === null) {
    console.error("[deposer] données de l'email absentes de la réponse de deposer_demande");
    const id = (resultat.donnees as Record<string, unknown>).id;
    if (typeof id === "string") {
      await noterResultatEmail(client, id, "echec", "donnees_absentes");
    }
  } else if (donneesEmail.nouvelle || donneesEmail.etat_email === "en_attente") {
    // Adresse telle que saisie (sans espaces), si elle correspond à la version normalisée.
    const saisie = String(formulaire.get("email") ?? "").trim();
    const destinataire = saisie.toLowerCase() === d.email ? saisie : d.email;
    await envoyerEmailConfirmation(client, destinataire, resultat.donnees.reference, donneesEmail);
  }

  // Remplace l'adresse du formulaire dans l'historique du navigateur : un
  // retour arrière ne réaffiche pas le formulaire rempli avec la même clé.
  redirect(`/confirmation/${resultat.donnees.jeton}`, RedirectType.replace);
}
