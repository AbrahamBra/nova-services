"use server";

import { cookies, headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { messageErreur } from "@/lib/erreurs";
import {
  ACCUEIL_EQUIPE,
  adresseDeRetour,
  lireSaisieConnexion,
  verifierConnexion,
  type EtatConnexion,
} from "@/lib/schemas/connexion";
import {
  lireSaisieMotDePasse,
  MESSAGES_MOT_DE_PASSE,
  schemaLien,
  verifierMotDePasse,
  type EtatConfirmation,
  type EtatMotDePasse,
} from "@/lib/schemas/mot-de-passe";
import { lireAdresseIp } from "@/lib/server/adresse-ip";
import { appeler, type ClientRpc } from "@/lib/server/appeler";
import { empreinteEmail, empreinteIp } from "@/lib/server/empreintes";
import { creerClientService } from "@/lib/server/supabase-service";
import { estPanneAuth, invitationDuClient, profilDuClient } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Actions serveur sur les comptes (AD-1, AD-7). Story 1.4 : connexion et
// déconnexion. Story 4.1 : lien d'invitation et premier mot de passe.
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
): Promise<{ email: string; ip: string } | null> {
  try {
    const ip = lireAdresseIp(await headers());
    if (ip === null) {
      console.error("[connexion] adresse IP introuvable dans les en-têtes");
      return null;
    }
    const empreinteDeLIp = empreinteIp(ip);
    const empreinteDeLEmail = empreinteEmail(email);
    if (empreinteDeLIp === null || empreinteDeLEmail === null) return null;
    return { email: empreinteDeLEmail, ip: empreinteDeLIp };
  } catch (erreur) {
    const nom = erreur instanceof Error ? erreur.name : typeof erreur;
    console.error(`[connexion] exception pendant le calcul des empreintes : ${nom}`);
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

// --- Invitation : lien et premier mot de passe (story 4.1) -------------------

/** Page du choix du mot de passe, après le lien. */
const PAGE_MOT_DE_PASSE = "/nouveau-mot-de-passe";

/**
 * Bouton « Continuer » de /auth/confirmer : vérifie le lien côté serveur
 * (`verifyOtp`, client porteur de session : la session de l'invité est posée
 * en cookies), puis mène à /nouveau-mot-de-passe. La page elle-même ne touche
 * jamais au lien (l'aperçu d'une messagerie ne le consomme pas).
 * Lien invalide, expiré ou déjà utilisé : « Ce lien n'est plus valable… ».
 */
export async function confirmerLien(
  etat: EtatConfirmation,
  formulaire: FormData,
): Promise<EtatConfirmation> {
  const lienInvalide = { erreur: messageErreur("LIEN_INVALIDE"), tentative: etat.tentative + 1 };
  const lien = schemaLien.safeParse({
    token_hash: formulaire.get("token_hash"),
    type: formulaire.get("type"),
  });
  if (!lien.success) return lienInvalide;

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[confirmerLien] client serveur indisponible");
    return { erreur: messageErreur("ERREUR_INATTENDUE"), tentative: etat.tentative + 1 };
  }

  try {
    const { error } = await client.auth.verifyOtp({
      token_hash: lien.data.token_hash,
      type: lien.data.type,
    });
    if (error) {
      if (estPanneAuth(error)) {
        console.error(`[confirmerLien] Auth indisponible : statut=${error.status ?? "aucun"}`);
        return { erreur: messageErreur("ERREUR_INATTENDUE"), tentative: etat.tentative + 1 };
      }
      // Jeton inconnu, expiré ou déjà utilisé (le code seul est tracé).
      console.warn(`[confirmerLien] lien refusé : code=${error.code ?? "inconnu"}`);
      return lienInvalide;
    }
  } catch {
    console.error("[confirmerLien] exception pendant verifyOtp");
    return { erreur: messageErreur("ERREUR_INATTENDUE"), tentative: etat.tentative + 1 };
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
 * Premier mot de passe d'un membre invité (FR-8, story 4.1) : Zod (8
 * caractères minimum, confirmation identique) → session de l'invité
 * (`mon_invitation()`) → `auth.updateUser({ password })` (Supabase revérifie
 * la longueur) → `activer_mon_compte()` (`invite` → `actif`) → `/equipe`.
 * Sans session d'invitation : « Ce lien n'est plus valable… ». Déjà activé
 * (second envoi) : directement `/equipe`.
 */
export async function choisirMotDePasse(
  etat: EtatMotDePasse,
  formulaire: FormData,
): Promise<EtatMotDePasse> {
  const suivant = etat.tentative + 1;
  const lienPlusValable: EtatMotDePasse = {
    erreurs: {},
    erreurGenerale: { type: "lien", message: messageErreur("LIEN_INVALIDE") },
    tentative: suivant,
  };
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

  try {
    const { data, error } = await client.auth.getClaims();
    if (error) {
      if (estPanneAuth(error)) return serveur;
      return lienPlusValable;
    }
    if (!data?.claims) return lienPlusValable;
  } catch {
    console.error("[choisirMotDePasse] exception pendant getClaims");
    return serveur;
  }

  const invitation = await invitationDuClient(client);
  if (invitation === undefined) return serveur;
  if (invitation === null) {
    // Déjà activé (second envoi, ou retour arrière) : l'espace équipe.
    const profil = await profilDuClient(client);
    if (profil.ok && profil.donnees !== null) redirect(ACCUEIL_EQUIPE, RedirectType.replace);
    return profil.ok ? lienPlusValable : serveur;
  }

  try {
    const { error } = await client.auth.updateUser({ password: mot_de_passe });
    // `same_password` : mot de passe déjà posé par un premier envoi dont
    // l'activation a échoué ; on reprend à l'activation.
    if (error && error.code !== "same_password") {
      if (error.code === "weak_password") {
        return {
          erreurs: { mot_de_passe: MESSAGES_MOT_DE_PASSE.refuse },
          erreurGenerale: null,
          tentative: suivant,
        };
      }
      if ((error.code && CODES_SESSION_PERDUE.has(error.code)) || error.status === 401) {
        return lienPlusValable;
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

  const activation = await appeler<unknown>(client, "activer_mon_compte");
  if (!activation.ok) {
    return activation.code === "DROIT_INSUFFISANT" ? lienPlusValable : serveur;
  }

  redirect(ACCUEIL_EQUIPE, RedirectType.replace);
}
