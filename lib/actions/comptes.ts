"use server";

import * as Sentry from "@sentry/nextjs";
import { cookies, headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { after } from "next/server";
import { messageErreur } from "@/lib/erreurs";
import {
  ACCUEIL_EQUIPE,
  adresseDeRetour,
  lireSaisieConnexion,
  verifierConnexion,
  type EtatConnexion,
} from "@/lib/schemas/connexion";
import {
  lireParcours,
  lireSaisieDemandeLien,
  lireSaisieMotDePasse,
  lireTypeLien,
  MESSAGES_MOT_DE_PASSE,
  schemaLien,
  verifierDemandeLien,
  verifierMotDePasse,
  type EtatConfirmation,
  type EtatDemandeLien,
  type EtatMotDePasse,
  type TypeLien,
} from "@/lib/schemas/mot-de-passe";
import { lireAdresseIp } from "@/lib/server/adresse-ip";
import { appeler, type ClientRpc } from "@/lib/server/appeler";
import {
  envoyerLienMotDePasse,
  estAdresseAutorisee,
  lireAdressesAutorisees,
} from "@/lib/server/emails";
import { empreinteEmail, empreinteIp } from "@/lib/server/empreintes";
import { adresseDuSite, lienMotDePasse } from "@/lib/server/liens";
import { creerClientService } from "@/lib/server/supabase-service";
import { estPanneAuth, invitationDuClient, profilDuClient } from "@/lib/session";
import { sessionParLien } from "@/lib/supabase/proxy";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Actions serveur sur les comptes (AD-1, AD-7). Story 1.4 : connexion et
// déconnexion. Story 4.1 : lien d'invitation et premier mot de passe.
// Story 4.3 : mot de passe oublié (demande d'un lien, nouveau mot de passe).
// Aucun client Supabase dans le navigateur : la session est
// posée en cookies par le client serveur.
// Story 1.9 : blocage après 5 échecs de suite en 15 minutes pour la même
// empreinte d'email ou d'IP (AD-21), compté par la base
// (`commencer_connexion` avant Auth, `terminer_connexion` après). La limite
// de 8 h est appliquée par proxy.ts.

function refus(etat: EtatConnexion): EtatConnexion {
  return {
    erreurs: {},
    erreurGenerale: { type: "refus", message: messageErreur("CONNEXION_REFUSEE") },
    tentative: etat.tentative + 1,
  };
}

function blocage(etat: EtatConnexion): EtatConnexion {
  return {
    erreurs: {},
    erreurGenerale: { type: "refus", message: messageErreur("CONNEXION_BLOQUEE") },
    tentative: etat.tentative + 1,
  };
}

function erreurServeur(etat: EtatConnexion): EtatConnexion {
  return {
    erreurs: {},
    erreurGenerale: { type: "serveur", message: messageErreur("ERREUR_INATTENDUE") },
    tentative: etat.tentative + 1,
  };
}

// Réponses de Supabase Auth qui veulent dire « ces identifiants ne donnent
// pas accès » : elles reçoivent toutes le même message, qui ne révèle jamais
// si l'email existe.
const CODES_REFUS = new Set(["invalid_credentials", "email_not_confirmed", "user_banned"]);

/**
 * Ferme la session de cet appareil. Si Supabase Auth ne répond pas, les
 * cookies de session sont tout de même effacés.
 */
async function fermerSession(client: Awaited<ReturnType<typeof creerClientServeur>>) {
  let echec = false;
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    echec = Boolean(error);
  } catch {
    echec = true;
  }
  if (echec) {
    console.error("[comptes] échec de signOut : cookies de session effacés");
    await effacerCookiesSession();
  }
}

async function effacerCookiesSession() {
  const magasin = await cookies();
  for (const { name } of magasin.getAll()) {
    if (name.startsWith("sb-")) magasin.delete(name);
  }
}

/**
 * Empreintes HMAC de l'email et de l'IP (AD-14), ou null si elles ne peuvent
 * pas être calculées (secret absent en production, en-tête Netlify absent).
 * Ni l'email ni l'IP ne sont jamais tracés ; seules les causes le sont.
 */
async function empreintesDeConnexion(
  email: string,
  contexte = "connexion",
): Promise<{ email: string; ip: string } | null> {
  try {
    const ip = lireAdresseIp(await headers());
    if (ip === null) {
      console.error(`[${contexte}] adresse IP introuvable dans les en-têtes`);
      return null;
    }
    const empreinteDeLIp = empreinteIp(ip);
    const empreinteDeLEmail = empreinteEmail(email);
    if (empreinteDeLIp === null || empreinteDeLEmail === null) return null;
    return { email: empreinteDeLEmail, ip: empreinteDeLIp };
  } catch (erreur) {
    const nom = erreur instanceof Error ? erreur.name : typeof erreur;
    console.error(`[${contexte}] exception pendant le calcul des empreintes : ${nom}`);
    return null;
  }
}

/** Identifiant renvoyé par `commencer_connexion` (bigint, reçu en nombre ou en texte). */
function lireIdentifiantTentative(valeur: unknown): number | string | null {
  if (typeof valeur === "number" && Number.isSafeInteger(valeur) && valeur > 0) return valeur;
  if (typeof valeur === "string" && /^[1-9][0-9]{0,18}$/.test(valeur)) return valeur;
  return null;
}

/**
 * Note le résultat de la tentative : `true` réussie, `false` échec, `null`
 * erreur serveur (la tentative est supprimée et ne compte pas). Renvoie
 * `note` (faux si la base a refusé ou n'a pas répondu, tracé avec le code
 * seulement) et `bloquee` (la prochaine tentative serait refusée).
 */
async function terminerTentative(
  service: ClientRpc,
  id: number | string,
  reussie: boolean | null,
): Promise<{ note: boolean; bloquee: boolean }> {
  const resultat = await appeler<unknown>(service, "terminer_connexion", {
    p_id: id,
    p_reussie: reussie,
  });
  if (!resultat.ok) {
    console.error(`[connexion] résultat de la tentative non noté : code=${resultat.code}`);
    return { note: false, bloquee: false };
  }
  const donnees = resultat.donnees as { bloquee?: unknown } | null;
  return { note: true, bloquee: donnees?.bloquee === true };
}

/**
 * Connexion par email et mot de passe : Zod → empreintes →
 * `commencer_connexion` (clé secrète ; refus si bloqué) → `signInWithPassword`
 * (clé publiable, cookies) → `mon_profil()` → `terminer_connexion`. Un compte
 * qui n'est pas un membre actif est déconnecté aussitôt, avec le même message
 * qu'un mauvais mot de passe, et compte comme un échec. Une erreur serveur
 * (Auth ou `mon_profil`) ne compte pas. Au 5ᵉ échec de suite
 * et pendant le blocage : « Trop de tentatives… ». Ensuite : l'adresse
 * demandée si elle commence par `/equipe`.
 */
export async function connexion(etat: EtatConnexion, formulaire: FormData): Promise<EtatConnexion> {
  const verification = verifierConnexion(lireSaisieConnexion(formulaire));
  if (!verification.ok) {
    return { erreurs: verification.erreurs, erreurGenerale: null, tentative: etat.tentative + 1 };
  }
  const { email, mot_de_passe } = verification.donnees;
  const retour = adresseDeRetour(formulaire.get("retour"));

  const empreintes = await empreintesDeConnexion(email);
  if (empreintes === null) return erreurServeur(etat);

  let client;
  let service;
  try {
    client = await creerClientServeur();
    service = creerClientService();
  } catch {
    console.error("[connexion] client serveur indisponible");
    return erreurServeur(etat);
  }

  // Avant Auth : la base refuse si 5 échecs de suite sont déjà comptés pour
  // cet email ou cette IP, sinon enregistre la tentative (échec par défaut).
  const debut = await appeler<unknown>(service, "commencer_connexion", {
    p_empreinte_email: empreintes.email,
    p_empreinte_ip: empreintes.ip,
  });
  if (!debut.ok) {
    if (debut.code === "CONNEXION_BLOQUEE") {
      console.warn("[connexion] tentative refusée : blocage en cours");
      return blocage(etat);
    }
    return erreurServeur(etat);
  }
  const tentative = lireIdentifiantTentative(debut.donnees);
  if (tentative === null) {
    console.error("[connexion] réponse inattendue de commencer_connexion");
    return erreurServeur(etat);
  }

  /** Échec noté ; « Trop de tentatives » s'il vient d'atteindre le blocage. */
  const echec = async (): Promise<EtatConnexion> => {
    const { bloquee } = await terminerTentative(service, tentative, false);
    if (bloquee) {
      console.warn("[connexion] blocage atteint");
      return blocage(etat);
    }
    return refus(etat);
  };

  /** Erreur serveur : la tentative ne compte pas (une panne ne bloque personne). */
  const panne = async (): Promise<EtatConnexion> => {
    await terminerTentative(service, tentative, null);
    return erreurServeur(etat);
  };

  try {
    const { error } = await client.auth.signInWithPassword({ email, password: mot_de_passe });
    if (error) {
      // Refus sans code (anciennes réponses d'Auth) : statut 400.
      if ((error.code && CODES_REFUS.has(error.code)) || (!error.code && error.status === 400)) {
        return echec();
      }
      // Trace minimale : jamais l'email ni le mot de passe (AD-14).
      console.error(
        `[connexion] erreur Auth : code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
      return panne();
    }
  } catch {
    console.error("[connexion] exception pendant signInWithPassword");
    return panne();
  }

  // Le rôle et l'état viennent de `membres`, jamais des métadonnées Auth (AD-3).
  const profil = await profilDuClient(client);
  if (!profil.ok || profil.donnees === null) {
    // Compte Auth sans membre actif (invité, désactivé, inconnu) ou erreur :
    // la session tout juste ouverte est fermée, et la tentative compte comme
    // un échec.
    await fermerSession(client);
    return profil.ok ? echec() : panne();
  }

  const reussite = await terminerTentative(service, tentative, true);
  if (!reussite.note) {
    // La tentative reste comptée comme un échec ; la connexion est acceptée.
    console.error("[connexion] réussite non notée : la tentative reste comptée comme un échec");
  }
  redirect(retour, RedirectType.replace);
}

/** Déconnexion : ferme la session de cet appareil puis revient à la connexion. */
export async function deconnexion(): Promise<void> {
  try {
    await fermerSession(await creerClientServeur());
  } catch {
    console.error("[deconnexion] client serveur indisponible : cookies de session effacés");
    await effacerCookiesSession();
  }
  redirect("/connexion", RedirectType.replace);
}

// --- Liens : invitation (story 4.1) et mot de passe oublié (story 4.3) ------

/** Page du choix du mot de passe, après le lien. */
const PAGE_MOT_DE_PASSE = "/nouveau-mot-de-passe";

/** Message « lien plus valable » selon le type de lien. */
function messageLienInvalide(type: TypeLien | null): string {
  return messageErreur(type === "recovery" ? "LIEN_REINITIALISATION_INVALIDE" : "LIEN_INVALIDE");
}

/** Trace une erreur imprévue (console et Sentry), sans email ni nom (AD-14). */
function signaler(message: string): void {
  console.error(message);
  try {
    Sentry.captureMessage(message, "error");
  } catch {
    // Le suivi des erreurs ne doit jamais faire échouer l'action.
  }
}

/**
 * Bouton « Continuer » de /auth/confirmer : vérifie le lien côté serveur
 * (`verifyOtp`, client porteur de session : la session du membre est posée
 * en cookies), puis mène à /nouveau-mot-de-passe. La page elle-même ne touche
 * jamais au lien (l'aperçu d'une messagerie ne le consomme pas).
 * Lien invalide, expiré ou déjà utilisé : « Ce lien n'est plus valable… »
 * (invitation : « … Contactez votre administrateur. » ; réinitialisation :
 * l'écran propose « Demander un nouveau lien »).
 */
export async function confirmerLien(
  etat: EtatConfirmation,
  formulaire: FormData,
): Promise<EtatConfirmation> {
  const suivant = etat.tentative + 1;
  const lienInvalide = (type: TypeLien | null): EtatConfirmation => ({
    erreur: messageLienInvalide(type),
    lienRefuse: true,
    tentative: suivant,
  });
  const serveur: EtatConfirmation = { erreur: messageErreur("ERREUR_INATTENDUE"), tentative: suivant };

  const lien = schemaLien.safeParse({
    token_hash: formulaire.get("token_hash"),
    type: formulaire.get("type"),
  });
  if (!lien.success) return lienInvalide(lireTypeLien(formulaire.get("type")));

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[confirmerLien] client serveur indisponible");
    return serveur;
  }

  try {
    const { error } = await client.auth.verifyOtp({
      token_hash: lien.data.token_hash,
      type: lien.data.type,
    });
    if (error) {
      if (estPanneAuth(error)) {
        console.error(`[confirmerLien] Auth indisponible : statut=${error.status ?? "aucun"}`);
        return serveur;
      }
      // Jeton inconnu, expiré, remplacé ou déjà utilisé (le code seul est tracé).
      console.warn(`[confirmerLien] lien refusé : code=${error.code ?? "inconnu"}`);
      return lienInvalide(lien.data.type);
    }
  } catch {
    console.error("[confirmerLien] exception pendant verifyOtp");
    return serveur;
  }

  redirect(PAGE_MOT_DE_PASSE, RedirectType.replace);
}

// Réponses de Supabase Auth qui veulent dire « session absente ou périmée ».
const CODES_SESSION_PERDUE = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "reauthentication_needed",
  "user_not_found",
]);

/**
 * Choix du mot de passe, après un lien (FR-8, stories 4.1 et 4.3) : Zod (8
 * caractères minimum, confirmation identique) → session vérifiée →
 *   - invité (`mon_invitation()`) : `auth.updateUser({ password })` puis
 *     `activer_mon_compte()` (`invite` → `actif`) ;
 *   - membre actif dont la session vient d'un lien ouvert il y a moins
 *     d'une heure (`sessionParLien`, story 4.3) : `auth.updateUser`, puis
 *     fermeture des autres sessions du compte ;
 * puis `/equipe`. Session ouverte par mot de passe, lien trop ancien, compte
 * désactivé ou sans session : « Ce lien n'est plus valable… » (variante du
 * parcours affiché) ; le mot de passe ne change jamais sans lien.
 */
export async function choisirMotDePasse(
  etat: EtatMotDePasse,
  formulaire: FormData,
): Promise<EtatMotDePasse> {
  const suivant = etat.tentative + 1;
  // Le parcours affiché (invitation ou réinitialisation) ne sert qu'à
  // choisir le message ; les droits sont lus dans la session et en base.
  const parcours = lireParcours(formulaire.get("parcours"));
  const lienPlusValable = (type: TypeLien): EtatMotDePasse => ({
    erreurs: {},
    erreurGenerale: { type: "lien", message: messageLienInvalide(type) },
    tentative: suivant,
  });
  const lienAffiche = lienPlusValable(parcours === "reinitialisation" ? "recovery" : "invite");
  const serveur: EtatMotDePasse = {
    erreurs: {},
    erreurGenerale: { type: "serveur", message: messageErreur("ERREUR_INATTENDUE") },
    tentative: suivant,
  };

  const verification = verifierMotDePasse(lireSaisieMotDePasse(formulaire));
  if (!verification.ok) {
    return { erreurs: verification.erreurs, erreurGenerale: null, tentative: suivant };
  }
  const { mot_de_passe } = verification.donnees;

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[choisirMotDePasse] client serveur indisponible");
    return serveur;
  }

  let claims: unknown;
  try {
    const { data, error } = await client.auth.getClaims();
    if (error) {
      if (estPanneAuth(error)) return serveur;
      return lienAffiche;
    }
    if (!data?.claims) return lienAffiche;
    claims = data.claims;
  } catch {
    console.error("[choisirMotDePasse] exception pendant getClaims");
    return serveur;
  }

  const invitation = await invitationDuClient(client);
  if (invitation === undefined) return serveur;

  if (invitation === null) {
    // Pas (ou plus) invité : réinitialisation, réservée à un membre actif
    // dont la session vient d'un lien.
    // Message selon le parcours affiché : invitation, « … Contactez votre
    // administrateur. » ; réinitialisation, « Demander un nouveau lien ».
    const profil = await profilDuClient(client);
    if (!profil.ok) return serveur;
    if (profil.donnees === null || !sessionParLien(claims)) return lienAffiche;
  }

  try {
    const { error } = await client.auth.updateUser({ password: mot_de_passe });
    // `same_password` : mot de passe déjà posé (premier envoi dont
    // l'activation a échoué, ou second envoi) ; on reprend à la suite.
    if (error && error.code !== "same_password") {
      if (error.code === "weak_password") {
        return {
          erreurs: { mot_de_passe: MESSAGES_MOT_DE_PASSE.refuse },
          erreurGenerale: null,
          tentative: suivant,
        };
      }
      if ((error.code && CODES_SESSION_PERDUE.has(error.code)) || error.status === 401) {
        return lienAffiche;
      }
      console.error(
        `[choisirMotDePasse] erreur Auth : code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
      return serveur;
    }
  } catch {
    console.error("[choisirMotDePasse] exception pendant updateUser");
    return serveur;
  }

  if (invitation !== null) {
    const activation = await appeler<unknown>(client, "activer_mon_compte");
    if (!activation.ok) {
      return activation.code === "DROIT_INSUFFISANT" ? lienPlusValable("invite") : serveur;
    }
  } else {
    // Réinitialisation : les autres sessions du compte sont fermées (un
    // appareil resté connecté avec l'ancien mot de passe). Un échec est
    // signalé sans empêcher l'arrivée sur l'espace équipe.
    try {
      const { error } = await client.auth.signOut({ scope: "others" });
      if (error) {
        signaler(
          `[choisirMotDePasse] autres sessions non fermées : code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
        );
      }
    } catch {
      signaler("[choisirMotDePasse] autres sessions non fermées : code=exception");
    }
  }

  redirect(ACCUEIL_EQUIPE, RedirectType.replace);
}

// --- Mot de passe oublié : demande d'un lien (story 4.3) ---------------------

/**
 * « Recevoir un lien » de /mot-de-passe-oublie : Zod → empreintes HMAC de
 * l'email et de l'IP → réponse immédiate, toujours le même message. Le
 * traitement (limite, génération du lien, email) se fait APRÈS la réponse
 * (`after`) : le temps de réponse ne dépend jamais de l'existence du compte,
 * et aucune erreur n'est jamais montrée (même message dans tous les cas).
 */
export async function demanderLienMotDePasse(
  etat: EtatDemandeLien,
  formulaire: FormData,
): Promise<EtatDemandeLien> {
  const suivant = etat.tentative + 1;
  const verification = verifierDemandeLien(lireSaisieDemandeLien(formulaire));
  if (!verification.ok) {
    return { erreurs: verification.erreurs, envoyee: false, tentative: suivant };
  }
  const { email } = verification.donnees;

  const empreintes = await empreintesDeConnexion(email, "demanderLienMotDePasse");
  if (empreintes !== null) {
    after(() => traiterDemandeLien(email, empreintes));
  } else {
    // Sans empreinte (en-tête IP ou secret HMAC absent), aucune demande ne
    // peut aboutir : signalé, pour qu'une panne générale ne passe pas
    // inaperçue. Le visiteur lit le même message.
    signaler("[demanderLienMotDePasse] empreintes impossibles : demande abandonnée");
  }

  return { erreurs: {}, envoyee: true, tentative: suivant };
}

/**
 * Traitement d'une demande, après la réponse : `demander_reinitialisation`
 * (limite ; vrai seulement pour un membre actif) → adresse dans
 * EMAILS_AUTORISES (sinon rien : mode démonstration, l'ancien lien du membre
 * reste valable) → `generateLink({ type: "recovery" })` (Supabase n'envoie
 * rien) → email par Resend. Jamais d'exception ; un échec est signalé sans
 * email ni nom (AD-14).
 */
async function traiterDemandeLien(
  email: string,
  empreintes: { email: string; ip: string },
): Promise<void> {
  try {
    const service = creerClientService();
    const demande = await appeler<unknown>(service, "demander_reinitialisation", {
      p_empreinte_email: empreintes.email,
      p_empreinte_ip: empreintes.ip,
      p_email: email,
    });
    if (!demande.ok) {
      signaler(`[demanderLienMotDePasse] demande non enregistrée : code=${demande.code}`);
      return;
    }
    if ((demande.donnees as { envoyer?: unknown } | null)?.envoyer !== true) return;

    // Hors liste : aucun lien généré, aucun envoi (mode démonstration).
    if (!estAdresseAutorisee(email, lireAdressesAutorisees(process.env.EMAILS_AUTORISES))) return;

    const site = adresseDuSite();
    if (site === null) {
      signaler("[demanderLienMotDePasse] NEXT_PUBLIC_SITE_URL absente ou invalide : aucun lien");
      return;
    }

    const { data, error } = await service.auth.admin.generateLink({ type: "recovery", email });
    if (error) {
      signaler(
        `[demanderLienMotDePasse] erreur Auth : code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
      return;
    }
    const jeton = data?.properties?.hashed_token;
    if (typeof jeton !== "string" || jeton === "") {
      signaler("[demanderLienMotDePasse] réponse inattendue de generateLink : aucun jeton");
      return;
    }

    const envoi = await envoyerLienMotDePasse(email, {
      lien: lienMotDePasse(site, jeton),
      jetonHache: jeton,
    });
    if (envoi.etat === "echec") {
      signaler(`[demanderLienMotDePasse] email non envoyé : code=${envoi.code ?? "inconnu"}`);
    }
  } catch {
    signaler("[demanderLienMotDePasse] exception pendant le traitement de la demande");
  }
}
