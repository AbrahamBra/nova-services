"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import {
  lireSaisieInvitation,
  verifierInvitation,
  type EtatInvitation,
} from "@/lib/schemas/invitation";
import { appeler } from "@/lib/server/appeler";
import { adresseDuSite, creeParCetAppel, lienInvitation } from "@/lib/server/liens";
import { creerClientService } from "@/lib/server/supabase-service";
import { lireProfil } from "@/lib/session";

// Actions serveur d'administration des comptes (epic 4, AD-1, AD-7).
// Story 4.1 : invitation d'un nouveau membre. Le rôle d'administrateur est
// revérifié par chaque action (jamais seulement par l'écran).

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
