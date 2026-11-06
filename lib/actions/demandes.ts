"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import { lireAdresseIp } from "@/lib/server/adresse-ip";
import { appeler, type ClientRpc, type ResultatAction } from "@/lib/server/appeler";
import { envoyerConfirmation } from "@/lib/server/emails";
import { empreinteIp } from "@/lib/server/empreintes";
import { creerClientService } from "@/lib/server/supabase-service";
import {
  champPiegeRempli,
  lireSaisieDepot,
  longueur,
  verifierDepot,
  type EtatDepot,
} from "@/lib/schemas/depot";
import {
  LONGUEUR_MAX_NOTE,
  MESSAGES_NOTE,
  MESSAGES_CLASSEMENT,
  schemaIdentifiantCategorie,
  schemaIdentifiantDemande,
  schemaIdentifiantMembre,
  schemaPrioriteDemande,
  schemaStatutDemande,
  verifierRaisonClassement,
  verifierTexteNote,
} from "@/lib/schemas/traitement";
import {
  lireSaisie,
  verifierSaisie,
  type EtatSaisie,
} from "@/lib/schemas/saisie";
import { PRIORITES, STATUTS, type Priorite, type Statut } from "@/lib/domaine";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { lireCompteurMenu } from "@/lib/tableau-de-bord";

// Actions serveur sur les demandes (AD-7). Story 1.3 : dépôt public ;
// story 1.7 : email de confirmation ; story 1.8 : champ piège et limite
// d'envois (5 en 10 minutes par empreinte d'IP, vérifiée par la base) ;
// story 2.1 : prise en charge (traitement, avec la session du membre) ;
// story 2.2 : notes internes ; story 2.3 : changement de statut et
// classement sans suite ; story 2.4 : priorité et catégorie ; story 2.6 :
// saisie interne d'une demande reçue par téléphone ou par email ; story 2.7 :
// libérer ou attribuer une demande.

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
  origine = "deposer",
): Promise<void> {
  const notation = await appeler<unknown>(client, "noter_resultat_email", {
    p_demande_id: demandeId,
    p_etat: etat,
    p_code_erreur: code,
  });
  if (!notation.ok) {
    console.error(`[${origine}] résultat de l'email non noté : code=${notation.code}`);
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
  origine = "deposer",
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
      console.error(`[${origine}] email de confirmation non envoyé : code=${code ?? "inconnu"}`);
      // Envoi simultané avec la même clé d'idempotence (double clic) : l'autre
      // appel envoie l'email et note le résultat.
      if (code === "concurrent_idempotent_requests") return;
    }
    await noterResultatEmail(client, donnees.id, etat, code, origine);
  } catch {
    console.error(`[${origine}] exception pendant l'envoi de l'email de confirmation`);
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

// --- Traitement des demandes (epic 2) ---------------------------------------
// Avec la SESSION du membre connecté, jamais la clé secrète : la fonction SQL
// vérifie elle-même le droit (membre actif) et la règle (AD-4, AD-15).

/** Résultat d'une prise en charge renvoyé à l'écran (AD-7), sans `detail`. */
export type ResultatPriseEnCharge = ResultatAction<{ responsableId: string }>;

function refusTraitement(code: CodeErreur, message = messageErreur(code)) {
  return { ok: false as const, code, message };
}

/**
 * Prise en charge d'une demande Nouvelle par le membre connecté
 * (`prendre_en_charge`). Réussite ou refus « attendu » (déjà prise,
 * introuvable, passage interdit, droit insuffisant) : le détail est
 * rafraîchi pour montrer le vrai état (un membre désactivé est renvoyé à la
 * connexion par la mise en page). Erreur inattendue : rien ne change à l'écran.
 */
export async function prendreEnCharge(demandeId: unknown): Promise<ResultatPriseEnCharge> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[prendreEnCharge] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "prendre_en_charge", {
    p_demande_id: identifiant.data,
  });

  if (!resultat.ok) {
    switch (resultat.code) {
      case "DEJA_PRISE": {
        const nom = resultat.detail?.responsable;
        refresh();
        return typeof nom === "string" && nom.trim() !== ""
          ? refusTraitement("DEJA_PRISE", `Déjà prise en charge par ${nom.trim()}.`)
          : refusTraitement("DEJA_PRISE");
      }
      case "DEMANDE_INTROUVABLE":
      case "PASSAGE_INTERDIT":
      case "DROIT_INSUFFISANT":
        refresh();
        return refusTraitement(resultat.code);
      default:
        // Jamais le détail technique vers le navigateur.
        return refusTraitement(resultat.code);
    }
  }

  const donnees = resultat.donnees as Record<string, unknown> | null;
  if (typeof donnees?.responsable_id !== "string") {
    console.error("[prendreEnCharge] réponse inattendue de prendre_en_charge");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return { ok: true, donnees: { responsableId: donnees.responsable_id } };
}

/** Résultat d'un ajout de note renvoyé à l'écran (AD-7), sans `detail`. */
export type ResultatAjoutNote = ResultatAction<{ noteId: string }>;

/**
 * Note interne du membre connecté sur une demande (`ajouter_note`), quel que
 * soit son statut. Texte vérifié avec le même schéma que l'écran (AD-8) :
 * un texte refusé ne va pas jusqu'à la base. Réussite ou refus « attendu »
 * (introuvable, droit insuffisant) : le détail est rafraîchi. Texte refusé
 * par la base (`DONNEES_INVALIDES`) : message du champ (vide ou trop long),
 * affiché sous la zone. Erreur inattendue : rien ne change à l'écran.
 */
export async function ajouterNote(demandeId: unknown, texte: unknown): Promise<ResultatAjoutNote> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");
  const note = verifierTexteNote(texte);
  if (!note.ok) return refusTraitement("DONNEES_INVALIDES", note.message);

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[ajouterNote] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "ajouter_note", {
    p_demande_id: identifiant.data,
    p_texte: note.texte,
  });

  if (!resultat.ok) {
    switch (resultat.code) {
      case "DEMANDE_INTROUVABLE":
      case "DROIT_INSUFFISANT":
        refresh();
        return refusTraitement(resultat.code);
      case "DONNEES_INVALIDES":
        // Message du champ, affiché sous la zone (pas de toast).
        return refusTraitement(
          "DONNEES_INVALIDES",
          longueur(note.texte) > LONGUEUR_MAX_NOTE ? MESSAGES_NOTE.long : MESSAGES_NOTE.vide,
        );
      default:
        // Jamais le détail technique vers le navigateur.
        return refusTraitement(resultat.code);
    }
  }

  const donnees = resultat.donnees as Record<string, unknown> | null;
  const noteId = donnees?.id;
  if (typeof noteId !== "number" && typeof noteId !== "string") {
    console.error("[ajouterNote] réponse inattendue de ajouter_note");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return { ok: true, donnees: { noteId: String(noteId) } };
}

/** État de la demande après un changement de statut (story 2.3). */
export type EtatApresStatut = {
  statut: Statut;
  responsableId: string | null;
  /** La demande avait-elle un responsable avant le changement ? */
  avaitResponsable: boolean;
};

/** Résultat d'un changement de statut renvoyé à l'écran (AD-7), sans `detail`. */
export type ResultatChangementStatut = ResultatAction<EtatApresStatut>;

function lireEtatApresStatut(donnees: unknown): EtatApresStatut | null {
  if (typeof donnees !== "object" || donnees === null) return null;
  const v = donnees as Record<string, unknown>;
  if (!(STATUTS as readonly unknown[]).includes(v.statut)) return null;
  if (v.responsable_id !== null && typeof v.responsable_id !== "string") return null;
  if (typeof v.avait_responsable !== "boolean") return null;
  return {
    statut: v.statut as Statut,
    responsableId: v.responsable_id,
    avaitResponsable: v.avait_responsable,
  };
}

/** Refus « attendus » d'un changement de statut : le détail est rafraîchi. */
function refusStatut(code: CodeErreur) {
  switch (code) {
    case "DEMANDE_INTROUVABLE":
    case "PASSAGE_INTERDIT":
    case "DROIT_INSUFFISANT":
      refresh();
      return refusTraitement(code);
    default:
      // Jamais le détail technique vers le navigateur.
      return refusTraitement(code);
  }
}

/**
 * Changement de statut (`changer_statut`) : « Marquer comme traitée »
 * (En cours → Traitée) ou « Rouvrir » (Traitée → En cours, ou Nouvelle si
 * le responsable n'est plus actif). Renvoie le statut réel obtenu. Réussite
 * ou refus attendu : le détail est rafraîchi. Statut demandé hors liste :
 * `PASSAGE_INTERDIT` sans appel à la base.
 */
export async function changerStatut(
  demandeId: unknown,
  statut: unknown,
): Promise<ResultatChangementStatut> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");
  const demande = schemaStatutDemande.safeParse(statut);
  if (!demande.success) return refusTraitement("PASSAGE_INTERDIT");

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[changerStatut] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "changer_statut", {
    p_demande_id: identifiant.data,
    p_statut: demande.data,
  });
  if (!resultat.ok) return refusStatut(resultat.code);

  const etat = lireEtatApresStatut(resultat.donnees);
  if (!etat) {
    console.error("[changerStatut] réponse inattendue de changer_statut");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return { ok: true, donnees: etat };
}

/**
 * Classement sans suite d'une demande Nouvelle (`classer_sans_suite`), avec
 * la raison, qui devient une note interne. Raison vérifiée avec le même
 * schéma que l'écran (AD-8) : refusée sans appel à la base, message du champ.
 * Réussite ou refus attendu : le détail est rafraîchi.
 */
export async function classerSansSuite(
  demandeId: unknown,
  raison: unknown,
): Promise<ResultatChangementStatut> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");
  const note = verifierRaisonClassement(raison);
  if (!note.ok) return refusTraitement("DONNEES_INVALIDES", note.message);

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[classerSansSuite] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "classer_sans_suite", {
    p_demande_id: identifiant.data,
    p_note: note.texte,
  });
  if (!resultat.ok) {
    if (resultat.code === "DONNEES_INVALIDES") {
      // Message du champ, affiché sous la zone (pas de toast).
      return refusTraitement(
        "DONNEES_INVALIDES",
        longueur(note.texte) > LONGUEUR_MAX_NOTE ? MESSAGES_CLASSEMENT.long : MESSAGES_CLASSEMENT.vide,
      );
    }
    return refusStatut(resultat.code);
  }

  const etat = lireEtatApresStatut(resultat.donnees);
  if (!etat) {
    console.error("[classerSansSuite] réponse inattendue de classer_sans_suite");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return { ok: true, donnees: etat };
}

// --- Priorité et catégorie (story 2.4) ----------------------------------------

/** Résultat d'un changement de priorité renvoyé à l'écran (AD-7), sans `detail`. */
export type ResultatChangementPriorite = ResultatAction<{ priorite: Priorite; modifiee: boolean }>;

/** Résultat d'un changement de catégorie renvoyé à l'écran (AD-7), sans `detail`. */
export type ResultatChangementCategorie = ResultatAction<{ categorieId: string; modifiee: boolean }>;

/**
 * Refus « attendus » d'un changement de priorité ou de catégorie : le détail
 * est rafraîchi (la liste reprend la vraie valeur). Erreur inattendue : rien
 * ne change à l'écran.
 */
function refusChangement(code: CodeErreur) {
  switch (code) {
    case "DEMANDE_INTROUVABLE":
    case "DROIT_INSUFFISANT":
    case "DONNEES_INVALIDES":
    case "CATEGORIE_INVALIDE":
      refresh();
      return refusTraitement(code);
    default:
      // Jamais le détail technique vers le navigateur.
      return refusTraitement(code);
  }
}

/** Lit `modifiee` et la valeur renvoyée par la fonction SQL, ou null. */
function lireChangement(donnees: unknown, cle: string): { valeur: unknown; modifiee: boolean } | null {
  if (typeof donnees !== "object" || donnees === null) return null;
  const v = donnees as Record<string, unknown>;
  if (typeof v.modifiee !== "boolean") return null;
  return { valeur: v[cle], modifiee: v.modifiee };
}

/**
 * Priorité d'une demande (`changer_priorite`), quel que soit son statut
 * (règle 3). Priorité hors liste : `DONNEES_INVALIDES` sans appel à la base.
 * Même valeur qu'avant : succès sans modification (`modifiee: false`).
 * Réussite ou refus attendu : le détail est rafraîchi.
 */
export async function changerPriorite(
  demandeId: unknown,
  priorite: unknown,
): Promise<ResultatChangementPriorite> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");
  const demande = schemaPrioriteDemande.safeParse(priorite);
  if (!demande.success) return refusTraitement("DONNEES_INVALIDES");

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[changerPriorite] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "changer_priorite", {
    p_demande_id: identifiant.data,
    p_priorite: demande.data,
  });
  if (!resultat.ok) return refusChangement(resultat.code);

  const changement = lireChangement(resultat.donnees, "priorite");
  if (!changement || !(PRIORITES as readonly unknown[]).includes(changement.valeur)) {
    console.error("[changerPriorite] réponse inattendue de changer_priorite");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return {
    ok: true,
    donnees: { priorite: changement.valeur as Priorite, modifiee: changement.modifiee },
  };
}

/**
 * Catégorie d'une demande (`changer_categorie`), quel que soit son statut :
 * seulement une catégorie active (la base le vérifie). Identifiant mal formé :
 * `CATEGORIE_INVALIDE` sans appel à la base. Même valeur qu'avant : succès
 * sans modification. Réussite ou refus attendu : le détail est rafraîchi.
 */
export async function changerCategorie(
  demandeId: unknown,
  categorieId: unknown,
): Promise<ResultatChangementCategorie> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");
  const categorie = schemaIdentifiantCategorie.safeParse(categorieId);
  if (!categorie.success) return refusTraitement("CATEGORIE_INVALIDE");

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[changerCategorie] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "changer_categorie", {
    p_demande_id: identifiant.data,
    p_categorie_id: categorie.data,
  });
  if (!resultat.ok) return refusChangement(resultat.code);

  const changement = lireChangement(resultat.donnees, "categorie_id");
  if (!changement || typeof changement.valeur !== "string") {
    console.error("[changerCategorie] réponse inattendue de changer_categorie");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return { ok: true, donnees: { categorieId: changement.valeur, modifiee: changement.modifiee } };
}

// --- Libérer et attribuer (story 2.7) ----------------------------------------

/** Résultat d'une libération renvoyé à l'écran (AD-7), sans `detail`. */
export type ResultatLiberation = ResultatAction<{ statut: Statut }>;

/** Résultat d'une attribution renvoyé à l'écran (AD-7), sans `detail`. */
export type ResultatAttribution = ResultatAction<{ responsableId: string }>;

/**
 * Refus « attendus » d'une libération ou d'une attribution : l'action n'est
 * plus possible (ou plus permise), le détail est rafraîchi pour montrer le
 * vrai état. Erreur inattendue : rien ne change à l'écran.
 */
function refusResponsable(code: CodeErreur) {
  switch (code) {
    case "DEMANDE_INTROUVABLE":
    case "PASSAGE_INTERDIT":
    case "DROIT_INSUFFISANT":
    case "MEMBRE_INVALIDE":
      refresh();
      return refusTraitement(code);
    default:
      // Jamais le détail technique vers le navigateur.
      return refusTraitement(code);
  }
}

/**
 * Libération d'une demande En cours (`liberer`) par son responsable ou un
 * administrateur : elle revient en Nouvelle, sans responsable. Déjà libérée
 * (double clic) : réussite sans changement. Réussite ou refus attendu : le
 * détail est rafraîchi.
 */
export async function liberer(demandeId: unknown): Promise<ResultatLiberation> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[liberer] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "liberer", { p_demande_id: identifiant.data });
  if (!resultat.ok) return refusResponsable(resultat.code);

  const donnees = resultat.donnees as Record<string, unknown> | null;
  if (donnees?.statut !== "nouvelle" || donnees.responsable_id !== null) {
    console.error("[liberer] réponse inattendue de liberer");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return { ok: true, donnees: { statut: "nouvelle" } };
}

/**
 * Attribution d'une demande Nouvelle ou En cours à un membre actif
 * (`attribuer`), réservée à un administrateur (la base le vérifie).
 * Identifiant du membre mal formé : `MEMBRE_INVALIDE` sans appel à la base.
 * Cible déjà responsable : réussite sans changement. Réussite ou refus
 * attendu : le détail est rafraîchi.
 */
export async function attribuer(
  demandeId: unknown,
  membreId: unknown,
): Promise<ResultatAttribution> {
  const identifiant = schemaIdentifiantDemande.safeParse(demandeId);
  if (!identifiant.success) return refusTraitement("DEMANDE_INTROUVABLE");
  const membre = schemaIdentifiantMembre.safeParse(membreId);
  if (!membre.success) return refusTraitement("MEMBRE_INVALIDE");

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[attribuer] client serveur indisponible");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "attribuer", {
    p_demande_id: identifiant.data,
    p_membre_id: membre.data,
  });
  if (!resultat.ok) return refusResponsable(resultat.code);

  const donnees = resultat.donnees as Record<string, unknown> | null;
  if (donnees?.statut !== "en_cours" || typeof donnees.responsable_id !== "string") {
    console.error("[attribuer] réponse inattendue de attribuer");
    return refusTraitement("ERREUR_INATTENDUE");
  }

  refresh();
  return { ok: true, donnees: { responsableId: donnees.responsable_id } };
}

// --- Saisie interne (story 2.6) ----------------------------------------------

function erreurSaisie(etat: EtatSaisie, message: string): EtatSaisie {
  return { erreurs: {}, erreurGenerale: message, tentative: etat.tentative + 1, reference: null };
}

const FORMAT_REFERENCE = /^NOVA-\d{4}-\d{4,}$/;

/**
 * Saisie interne d'une demande reçue par téléphone ou par email (FR-25) :
 * Zod (schéma partagé avec l'écran, AD-8) → `saisir_demande` avec la SESSION
 * du membre (la base vérifie qu'il est actif, AD-4) → si un email est
 * renseigné, email de confirmation puis `noter_resultat_email` (clé secrète,
 * comme `deposer` : fonction réservée à service_role), mode démonstration
 * compris (AD-13). Renvoie la référence ; l'écran affiche le toast et ouvre
 * le détail. Erreurs : messages sous les champs, ou bandeau ; la saisie
 * reste dans le formulaire. L'email ne fait jamais échouer la saisie.
 * Pas de limite d'envois (réservé aux membres connectés).
 */
export async function saisir(etat: EtatSaisie, formulaire: FormData): Promise<EtatSaisie> {
  const verification = verifierSaisie(lireSaisie(formulaire));
  if (!verification.ok) {
    // Clé falsifiée : les messages sous les champs ne la corrigeraient pas.
    if (verification.cleInvalide && Object.keys(verification.erreurs).length === 0) {
      return erreurSaisie(etat, messageErreur("DONNEES_INVALIDES"));
    }
    return {
      erreurs: verification.erreurs,
      erreurGenerale: null,
      tentative: etat.tentative + 1,
      reference: null,
    };
  }

  const d = verification.donnees;

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[saisir] client serveur indisponible");
    return erreurSaisie(etat, messageErreur("ERREUR_INATTENDUE"));
  }

  const resultat = await appeler<unknown>(client, "saisir_demande", {
    p_cle_envoi: d.cle_envoi,
    p_canal: d.canal,
    p_nom: d.nom,
    p_email: d.email,
    p_telephone: d.telephone,
    p_societe: d.societe,
    p_categorie_id: d.categorie_id,
    p_objet: d.objet,
    p_description: d.description,
  });

  if (!resultat.ok) {
    const sousLeChamp = (champ: "email" | "categorie_id"): EtatSaisie => ({
      erreurs: { [champ]: resultat.message },
      erreurGenerale: null,
      tentative: etat.tentative + 1,
      reference: null,
    });
    switch (resultat.code) {
      case "COORDONNEES_REQUISES":
        return sousLeChamp("email");
      case "CATEGORIE_INVALIDE":
        return sousLeChamp("categorie_id");
      case "DROIT_INSUFFISANT":
        // Comme les autres actions : la page est rafraîchie (un membre
        // désactivé est renvoyé à la connexion par la mise en page).
        refresh();
        return erreurSaisie(etat, resultat.message);
      default:
        // DONNEES_INVALIDES, ERREUR_INATTENDUE : bandeau.
        return erreurSaisie(etat, resultat.message);
    }
  }

  const reference = (resultat.donnees as Record<string, unknown> | null)?.reference;
  if (typeof reference !== "string" || !FORMAT_REFERENCE.test(reference)) {
    console.error("[saisir] réponse inattendue de saisir_demande");
    return erreurSaisie(etat, messageErreur("ERREUR_INATTENDUE"));
  }

  // Email seulement si une adresse est ENREGISTRÉE (réponse de la base, pas
  // le formulaire, qui peut avoir changé lors d'un second envoi), pour une
  // demande nouvelle ou encore `en_attente`. Sans email, la base a noté
  // `sans_email`.
  const donneesEmail = lireDonneesEmail(resultat.donnees);
  const brut = resultat.donnees as Record<string, unknown>;
  const emailEnregistre = typeof brut.email === "string" && brut.email !== "" ? brut.email : null;
  const aEnvoyer =
    donneesEmail === null ||
    (emailEnregistre !== null && (donneesEmail.nouvelle || donneesEmail.etat_email === "en_attente"));
  if (aEnvoyer) {
    let service: ClientRpc | null = null;
    try {
      service = creerClientService();
    } catch {
      // L'email reste `en_attente` ; la saisie est enregistrée.
      console.error("[saisir] client service indisponible : email non envoyé");
    }
    if (service) {
      if (donneesEmail === null) {
        console.error("[saisir] données de l'email absentes de la réponse de saisir_demande");
        if (typeof brut.id === "string") {
          await noterResultatEmail(service, brut.id, "echec", "donnees_absentes", "saisir");
        }
      } else if (emailEnregistre !== null) {
        // Adresse telle que saisie (sans espaces), si elle correspond à l'adresse enregistrée.
        const saisie = String(formulaire.get("email") ?? "").trim();
        const destinataire = saisie.toLowerCase() === emailEnregistre ? saisie : emailEnregistre;
        await envoyerEmailConfirmation(service, destinataire, reference, donneesEmail, "saisir");
      }
    }
  }

  return { erreurs: {}, erreurGenerale: null, tentative: etat.tentative + 1, reference };
}

/**
 * Compteur du menu (story 2.8) : demandes « À prendre en charge », relu par
 * le menu à chaque changement de page (la mise en page n'est pas rendue de
 * nouveau lors d'une navigation dans l'application). Lu avec la session :
 * sans membre actif, la vue ne renvoie rien. `null` en cas d'erreur (le
 * compteur est alors masqué).
 */
export async function lireCompteurDemandes(): Promise<number | null> {
  return lireCompteurMenu();
}
