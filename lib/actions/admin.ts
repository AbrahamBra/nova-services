"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import type { Role } from "@/lib/domaine";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import {
  schemaIdCompte,
  verifierModification,
  type ErreursModification,
} from "@/lib/schemas/compte";
import {
  lireSaisieInvitation,
  verifierInvitation,
  type EtatInvitation,
} from "@/lib/schemas/invitation";
import { appeler, type ResultatAction } from "@/lib/server/appeler";
import { adresseDuSite, creeParCetAppel, lienInvitation } from "@/lib/server/liens";
import { creerClientService } from "@/lib/server/supabase-service";
import { lireProfil } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Actions serveur d'administration des comptes (epic 4, AD-1, AD-7).
// Story 4.1 : invitation d'un nouveau membre. Story 4.2 : modifier,
// désactiver, réactiver un compte. Le rôle d'administrateur est revérifié
// par chaque action (jamais seulement par l'écran), puis par la base.

/** Durée du blocage Auth d'un compte désactivé (environ 100 ans). */
const DUREE_BLOCAGE = "876000h";

/** Page de la liste des comptes, rafraîchie après chaque action. */
const CHEMIN_COMPTES = "/equipe/admin/comptes";

function bandeau(etat: EtatInvitation, code: CodeErreur): EtatInvitation {
  return {
    erreurs: {},
    erreurGenerale: messageErreur(code),
    tentative: etat.tentative + 1,
    invitation: null,
  };
}

function emailPris(etat: EtatInvitation): EtatInvitation {
  return {
    erreurs: { email: messageErreur("EMAIL_DEJA_UTILISE") },
    erreurGenerale: null,
    tentative: etat.tentative + 1,
    invitation: null,
  };
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

// Réponses de l'API d'administration Auth qui veulent dire « adresse déjà
// enregistrée dans Auth ».
const CODES_EMAIL_EXISTANT = new Set(["email_exists", "user_already_exists"]);

/**
 * Invite un nouveau membre (FR-8, story 4.1) : profil administrateur
 * revérifié (sinon ACCES_REFUSE) → Zod (schéma partagé avec la fenêtre) →
 * adresse du site (NEXT_PUBLIC_SITE_URL, jamais l'en-tête Host) →
 * `generateLink({ type: "invite" })` (crée le compte Auth, n'envoie aucun
 * email) → `creer_membre(..., 'invite', auteur)` (ligne `membres` et
 * journal). Si `creer_membre` échoue, le compte Auth est supprimé (AD-17).
 * Renvoie le lien d'invitation à copier (mode démonstration).
 */
export async function inviter(etat: EtatInvitation, formulaire: FormData): Promise<EtatInvitation> {
  const profil = await lireProfil();
  if (!profil.ok) return bandeau(etat, "ERREUR_INATTENDUE");
  if (profil.donnees === null || !profil.donnees.estAdmin) return bandeau(etat, "ACCES_REFUSE");
  const auteurId = profil.donnees.id;

  const verification = verifierInvitation(lireSaisieInvitation(formulaire));
  if (!verification.ok) {
    return {
      erreurs: verification.erreurs,
      erreurGenerale: null,
      tentative: etat.tentative + 1,
      invitation: null,
    };
  }
  const { nom, email, role } = verification.donnees;

  // Avant toute création : sans adresse du site, aucun lien juste possible.
  const site = adresseDuSite();
  if (site === null) {
    console.error("[inviter] NEXT_PUBLIC_SITE_URL absente ou invalide : invitation refusée");
    return bandeau(etat, "ADRESSE_SITE_MANQUANTE");
  }

  let service;
  try {
    service = creerClientService();
  } catch {
    console.error("[inviter] client service indisponible");
    return bandeau(etat, "ERREUR_INATTENDUE");
  }

  // 1. Adresse libre, dans `membres` ET dans Auth, avant toute création.
  // Indispensable : sur un compte Auth existant non confirmé (invitation en
  // attente), `generateLink` ne renvoie pas d'erreur mais CE compte, avec un
  // nouveau jeton (vérifié sur nova-dev, story 4.1).
  const libre = await appeler<unknown>(service, "verifier_email_libre", { p_email: email });
  if (!libre.ok) {
    if (libre.code === "COMPTE_DESACTIVE") {
      // Story 4.2 : adresse d'un compte désactivé ; l'écran propose
      // « Réactiver ce compte » (identifiant donné par la base).
      const id = libre.detail?.id;
      if (typeof id !== "string" || !schemaIdCompte.safeParse(id).success) return emailPris(etat);
      return {
        erreurs: { email: messageErreur("COMPTE_DESACTIVE") },
        erreurGenerale: null,
        tentative: etat.tentative + 1,
        invitation: null,
        compteDesactive: { id },
      };
    }
    return libre.code === "EMAIL_DEJA_UTILISE" ? emailPris(etat) : bandeau(etat, libre.code);
  }

  // 2. Compte Auth et jeton d'invitation (aucun email envoyé par Supabase).
  const debut = Date.now();
  let utilisateurId: string;
  let jeton: string;
  try {
    const { data, error } = await service.auth.admin.generateLink({ type: "invite", email });
    if (error) {
      // Sans code (anciennes réponses d'Auth) : statut 422.
      if ((error.code && CODES_EMAIL_EXISTANT.has(error.code)) || (!error.code && error.status === 422)) {
        return emailPris(etat);
      }
      signaler(
        `[inviter] erreur Auth : code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
      return bandeau(etat, "ERREUR_INATTENDUE");
    }
    const id = data?.user?.id;
    const hache = data?.properties?.hashed_token;
    if (typeof id !== "string" || id === "") {
      signaler("[inviter] réponse inattendue de generateLink : aucun compte");
      return bandeau(etat, "ERREUR_INATTENDUE");
    }
    if (!creeParCetAppel(data.user.created_at, debut)) {
      // Compte qui existait déjà (créé entre la vérification et cet appel) :
      // jamais supprimé, jamais de lien remis.
      signaler(`[inviter] generateLink a renvoyé un compte existant : id=${id}`);
      return emailPris(etat);
    }
    if (typeof hache !== "string" || hache === "") {
      // Compte créé par cet appel, mais sans jeton : supprimé.
      await supprimerCompteAuth(service, id);
      signaler("[inviter] réponse inattendue de generateLink : aucun jeton");
      return bandeau(etat, "ERREUR_INATTENDUE");
    }
    utilisateurId = id;
    jeton = hache;
  } catch {
    signaler("[inviter] exception pendant generateLink");
    return bandeau(etat, "ERREUR_INATTENDUE");
  }

  // 3. Ligne `membres` (état `invite`) et journal, au nom de l'administrateur.
  const creation = await appeler<unknown>(service, "creer_membre", {
    p_id: utilisateurId,
    p_nom: nom,
    p_email: email,
    p_role: role,
    p_etat: "invite",
    p_auteur_id: auteurId,
  });
  if (!creation.ok) {
    switch (creation.code) {
      case "MEMBRE_EXISTANT":
      case "EMAIL_DEJA_UTILISE":
        // Le compte Auth appartient déjà à un membre (invitation simultanée
        // de la même adresse) : il n'est jamais supprimé.
        return emailPris(etat);
      case "DROIT_INSUFFISANT":
        // L'auteur n'est plus administrateur actif entre-temps.
        await supprimerCompteAuth(service, utilisateurId);
        return bandeau(etat, "ACCES_REFUSE");
      default:
        // Retour arrière (AD-17) : pas de compte Auth sans membre.
        await supprimerCompteAuth(service, utilisateurId);
        return bandeau(etat, creation.code);
    }
  }

  revalidatePath(CHEMIN_COMPTES);
  return {
    erreurs: {},
    erreurGenerale: null,
    tentative: etat.tentative + 1,
    invitation: { nom, lien: lienInvitation(site, jeton) },
  };
}

/** Supprime le compte Auth créé PAR CET APPEL ; un échec est signalé à Sentry (AD-17). */
async function supprimerCompteAuth(
  service: ReturnType<typeof creerClientService>,
  id: string,
): Promise<void> {
  try {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error && error.status !== 404) {
      signaler(
        `[inviter] compte Auth orphelin non supprimé : id=${id} code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
    }
  } catch {
    signaler(`[inviter] compte Auth orphelin non supprimé : id=${id} code=exception`);
  }
}

// --- Story 4.2 : modifier, désactiver, réactiver ---------------------------

/** Résultat de « Modifier » : erreurs sous les champs quand la base refuse la saisie. */
export type ResultatModification =
  | { ok: true; donnees: { nom: string; role: Role } }
  | { ok: false; code: CodeErreur; message: string; erreurs?: ErreursModification };

function refus(code: CodeErreur): { ok: false; code: CodeErreur; message: string } {
  return { ok: false, code, message: messageErreur(code) };
}

/** Profil administrateur revérifié ; sinon le code du refus. */
async function verifierAdmin(): Promise<{ ok: true; id: string } | { ok: false; code: CodeErreur }> {
  const profil = await lireProfil();
  if (!profil.ok) return { ok: false, code: "ERREUR_INATTENDUE" };
  if (profil.donnees === null || !profil.donnees.estAdmin) return { ok: false, code: "ACCES_REFUSE" };
  return { ok: true, id: profil.donnees.id };
}

/** Client porteur de la session de l'administrateur (auth.uid() en base). */
async function clientSession(action: string) {
  try {
    return await creerClientServeur();
  } catch {
    console.error(`[${action}] client serveur indisponible`);
    return null;
  }
}

/** Refus de la base : DROIT_INSUFFISANT (plus administrateur) affiché comme ACCES_REFUSE. */
function refusBase(code: CodeErreur) {
  // Compte déjà changé par un autre administrateur : la liste est rafraîchie
  // pour montrer son vrai état et ses vrais boutons.
  if (code === "ETAT_COMPTE_INVALIDE") revalidatePath(CHEMIN_COMPTES);
  return refus(code === "DROIT_INSUFFISANT" ? "ACCES_REFUSE" : code);
}

/**
 * Modifie le nom et le rôle d'un membre (story 4.2) : profil administrateur
 * revérifié → Zod (schéma partagé avec la fenêtre) → `modifier_membre` avec
 * la SESSION de l'administrateur (la base refuse son propre rôle et le
 * dernier administrateur actif). Le nouveau rôle s'applique au prochain
 * chargement de page du membre (droits relus à chaque requête, AD-3).
 */
export async function modifierMembre(saisie: unknown): Promise<ResultatModification> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const verification = verifierModification(saisie);
  if (!verification.ok) {
    if (verification.idInvalide) return refus("DONNEES_INVALIDES");
    return { ...refus("DONNEES_INVALIDES"), erreurs: verification.erreurs };
  }
  const { id, nom, role } = verification.donnees;

  const client = await clientSession("modifierMembre");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "modifier_membre", {
    p_id: id,
    p_nom: nom,
    p_role: role,
  });
  if (!resultat.ok) {
    if (resultat.code === "PROPRE_COMPTE" || resultat.code === "DERNIER_ADMIN") {
      // Le rôle choisi est refusé : message sous le champ Rôle.
      return { ...refus(resultat.code), erreurs: { role: messageErreur(resultat.code) } };
    }
    return refusBase(resultat.code);
  }

  revalidatePath(CHEMIN_COMPTES);
  return { ok: true, donnees: { nom, role } };
}

/**
 * Désactive un membre actif (story 4.2, règle 7) : profil administrateur
 * revérifié → `desactiver_membre` avec la session (refus immédiat partout,
 * demandes En cours remises en Nouvelle) PUIS blocage dans Auth (défense en
 * plus). Un échec du blocage est signalé à Sentry sans annuler : la base
 * refuse déjà tout à ce compte (`mon_profil` nul, connexion refusée).
 */
export async function desactiverMembre(
  membreId: unknown,
): Promise<ResultatAction<{ demandesRemises: number }>> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const identifiant = schemaIdCompte.safeParse(membreId);
  if (!identifiant.success) return refus("DONNEES_INVALIDES");
  const id = identifiant.data;

  const client = await clientSession("desactiverMembre");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "desactiver_membre", { p_id: id });
  if (!resultat.ok) return refusBase(resultat.code);
  const remises = (resultat.donnees as { demandes_remises?: unknown } | null)?.demandes_remises;
  const demandesRemises = typeof remises === "number" ? remises : 0;

  await bloquerAuth(id, "desactiverMembre");

  revalidatePath(CHEMIN_COMPTES);
  return { ok: true, donnees: { demandesRemises } };
}

/** Blocage Auth d'un compte désactivé ; un échec est signalé, jamais remonté. */
async function bloquerAuth(id: string, action: string): Promise<void> {
  try {
    const service = creerClientService();
    const { error } = await service.auth.admin.updateUserById(id, { ban_duration: DUREE_BLOCAGE });
    if (error) {
      signaler(
        `[${action}] blocage Auth impossible : id=${id} code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
    }
  } catch {
    signaler(`[${action}] blocage Auth impossible : id=${id} code=exception`);
  }
}

/**
 * Réactive un membre désactivé (story 4.2) : profil administrateur
 * revérifié → déblocage dans Auth PUIS `reactiver_membre` avec la session.
 * Si le déblocage échoue, rien ne change. Si la base refuse ensuite, le
 * blocage Auth est remis (le compte reste de toute façon refusé à la
 * connexion : il n'est pas actif en base).
 */
export async function reactiverMembre(membreId: unknown): Promise<ResultatAction<null>> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const identifiant = schemaIdCompte.safeParse(membreId);
  if (!identifiant.success) return refus("DONNEES_INVALIDES");
  const id = identifiant.data;

  const client = await clientSession("reactiverMembre");
  if (!client) return refus("ERREUR_INATTENDUE");

  try {
    const service = creerClientService();
    const { error } = await service.auth.admin.updateUserById(id, { ban_duration: "none" });
    if (error) {
      signaler(
        `[reactiverMembre] déblocage Auth impossible : id=${id} code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
      return refus("ERREUR_INATTENDUE");
    }
  } catch {
    signaler(`[reactiverMembre] déblocage Auth impossible : id=${id} code=exception`);
    return refus("ERREUR_INATTENDUE");
  }

  const resultat = await appeler<unknown>(client, "reactiver_membre", { p_id: id });
  if (!resultat.ok) {
    // La base n'a pas réactivé : le blocage Auth est remis (échec signalé).
    // Sauf ETAT_COMPTE_INVALIDE : le compte n'est alors PAS désactivé (déjà
    // réactivé par un autre administrateur, ou invité) ; le bloquer
    // empêcherait un compte actif de se connecter.
    if (resultat.code !== "ETAT_COMPTE_INVALIDE") await bloquerAuth(id, "reactiverMembre");
    return refusBase(resultat.code);
  }

  revalidatePath(CHEMIN_COMPTES);
  return { ok: true, donnees: null };
}
