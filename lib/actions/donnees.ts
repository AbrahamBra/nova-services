"use server";

import { revalidatePath } from "next/cache";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import { lireExpireesAvec } from "@/lib/expirees";
import {
  MESSAGES_DONNEES,
  lireReponseDemandesDemandeur,
  schemaIdsDemandes,
  schemaNombreExpirees,
  verifierEmailDemandeur,
  type DemandeDemandeur,
  type Expirees,
} from "@/lib/schemas/donnees";
import { appeler, signaler, type ResultatAction } from "@/lib/server/appeler";
import { lireProfil } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Actions serveur de la page Données personnelles (story 5.4, droit à
// l'effacement ; story 5.5, demandes expirées). L'email recherché arrive par
// ces actions, jamais par l'adresse de la page ; il n'est écrit ni dans la
// console, ni dans Sentry, ni dans le journal (AD-14) : seuls le nom de
// l'action ou de la fonction SQL et un code y figurent. Le rôle d'administrateur est revérifié par
// chaque action (jamais seulement par l'écran), puis par la base.

// Tout l'espace équipe : liste, recherche et détail des demandes, accueil,
// journal.
const CHEMIN_EQUIPE = "/equipe";

/** Résultat de « Rechercher » : erreur sous le champ quand l'email est refusé. */
export type ResultatRechercheDemandeur =
  | { ok: true; donnees: { email: string; demandes: DemandeDemandeur[] } }
  | { ok: false; code: CodeErreur; message: string; erreurEmail?: string };

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
  return refus(code === "DROIT_INSUFFISANT" ? "ACCES_REFUSE" : code);
}

/**
 * Recherche les demandes d'une personne par son email (story 5.4) : profil
 * administrateur revérifié → Zod (email sans espaces, en minuscules) →
 * `chercher_demandes_demandeur` avec la SESSION de l'administrateur
 * (correspondance exacte). Renvoie l'email normalisé et les demandes, de la
 * plus récente à la plus ancienne.
 */
export async function chercherDemandesDemandeur(
  emailSaisi: unknown,
): Promise<ResultatRechercheDemandeur> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const verification = verifierEmailDemandeur(emailSaisi);
  if (!verification.ok) return { ...refus("DONNEES_INVALIDES"), erreurEmail: verification.erreur };
  const email = verification.email;

  const client = await clientSession("chercherDemandesDemandeur");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "chercher_demandes_demandeur", { p_email: email });
  if (!resultat.ok) {
    // Email accepté par Zod mais refusé par la base : sous le champ aussi.
    if (resultat.code === "DONNEES_INVALIDES") {
      return { ...refus("DONNEES_INVALIDES"), erreurEmail: MESSAGES_DONNEES.emailInvalide };
    }
    return refusBase(resultat.code);
  }

  const demandes = lireReponseDemandesDemandeur(resultat.donnees);
  if (demandes === null) {
    signaler("[chercherDemandesDemandeur] réponse inattendue de chercher_demandes_demandeur");
    return refus("ERREUR_INATTENDUE");
  }
  return { ok: true, donnees: { email, demandes } };
}

/**
 * Efface toutes les demandes d'une personne (story 5.4) : profil
 * administrateur revérifié → Zod (email, identifiants vus à l'écran) →
 * `effacer_demandeur` avec la session (rien n'est effacé si la liste a
 * changé : DEMANDES_CHANGEES). Dès que la base a effacé, toutes les pages
 * de l'espace équipe sont rafraîchies ; après un refus, rien n'a changé et
 * rien n'est rafraîchi.
 */
export async function effacerDemandeur(
  emailSaisi: unknown,
  ids: unknown,
): Promise<ResultatAction<{ nombre: number }>> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const verification = verifierEmailDemandeur(emailSaisi);
  const identifiants = schemaIdsDemandes.safeParse(ids);
  if (!verification.ok || !identifiants.success) return refus("DONNEES_INVALIDES");

  const client = await clientSession("effacerDemandeur");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "effacer_demandeur", {
    p_email: verification.email,
    p_ids: identifiants.data,
  });
  if (!resultat.ok) return refusBase(resultat.code);

  const nombre = (resultat.donnees as { nombre?: unknown } | null)?.nombre;
  // La base a répondu sans erreur : l'effacement est fait, même si la
  // réponse est illisible.
  revalidatePath(CHEMIN_EQUIPE, "layout");
  if (typeof nombre !== "number" || !Number.isInteger(nombre) || nombre < 0) {
    signaler("[effacerDemandeur] réponse inattendue de effacer_demandeur");
    return refus("ERREUR_INATTENDUE");
  }
  return { ok: true, donnees: { nombre } };
}

/**
 * Résultat de « Supprimer les demandes expirées » : quand leur nombre a
 * changé (EXPIREES_CHANGEES), le nouveau nombre relu, à afficher.
 */
export type ResultatPurge =
  | { ok: true; donnees: { nombre: number } }
  | { ok: false; code: CodeErreur; message: string; expirees?: Expirees };

/**
 * Supprime les demandes expirées (story 5.5) : profil administrateur
 * revérifié → Zod (nombre affiché à l'écran) → `purger_expirees` avec la
 * session (rien n'est supprimé si leur nombre a changé : EXPIREES_CHANGEES,
 * avec le nouveau nombre relu par `compter_expirees`). Dès que la base a
 * supprimé, toutes les pages de l'espace équipe sont rafraîchies.
 */
export async function purgerExpirees(nombreAffiche: unknown): Promise<ResultatPurge> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const nombre = schemaNombreExpirees.safeParse(nombreAffiche);
  if (!nombre.success) return refus("DONNEES_INVALIDES");

  const client = await clientSession("purgerExpirees");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "purger_expirees", {
    p_nombre_attendu: nombre.data,
  });
  if (!resultat.ok) {
    if (resultat.code === "EXPIREES_CHANGEES") {
      const relu = await lireExpireesAvec(client);
      return relu.ok ? { ...refus("EXPIREES_CHANGEES"), expirees: relu.donnees } : refus("EXPIREES_CHANGEES");
    }
    return refusBase(resultat.code);
  }

  const supprimees = (resultat.donnees as { nombre?: unknown } | null)?.nombre;
  // La base a répondu sans erreur : la suppression est faite, même si la
  // réponse est illisible.
  revalidatePath(CHEMIN_EQUIPE, "layout");
  if (typeof supprimees !== "number" || !Number.isInteger(supprimees) || supprimees < 0) {
    signaler("[purgerExpirees] réponse inattendue de purger_expirees");
    return refus("ERREUR_INATTENDUE");
  }
  return { ok: true, donnees: { nombre: supprimees } };
}
