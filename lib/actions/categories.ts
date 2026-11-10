"use server";

import { revalidatePath } from "next/cache";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import {
  MESSAGES_CATEGORIE,
  schemaIdCategorie,
  verifierNomCategorie,
} from "@/lib/schemas/categorie";
import { appeler, signaler, type Resultat, type ResultatAction } from "@/lib/server/appeler";
import { lireProfil } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Actions serveur de la page Catégories (story 5.2, règle 9) : ajouter,
// renommer, désactiver, réactiver. Le rôle d'administrateur est revérifié par
// chaque action (jamais seulement par l'écran), puis par la base. Après un
// changement, la page Catégories et le formulaire public (`/`) sont
// rafraîchis : une catégorie ajoutée y apparaît aussitôt.

const CHEMIN_CATEGORIES = "/equipe/admin/categories";
const CHEMIN_FORMULAIRE = "/";

/**
 * Résultat de « Ajouter » / « Renommer » : erreur sous le champ Nom quand le
 * nom est refusé. `modifie` : faux quand le nom était déjà celui-là (rien
 * n'a changé, aucun toast).
 */
export type ResultatNomCategorie =
  | { ok: true; donnees: { id: string; nom: string; modifie: boolean } }
  | { ok: false; code: CodeErreur; message: string; erreurNom?: string };

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

function rafraichir(): void {
  revalidatePath(CHEMIN_CATEGORIES);
  revalidatePath(CHEMIN_FORMULAIRE);
}

/**
 * Identifiant bien formé mais inconnu de la base (catégorie supprimée
 * entre-temps) : traité comme ETAT_CATEGORIE_INVALIDE, pour que la liste
 * soit rafraîchie (comme `sansMembre`, story 4.4).
 */
function sansCategorie(code: CodeErreur): CodeErreur {
  return code === "DONNEES_INVALIDES" ? "ETAT_CATEGORIE_INVALIDE" : code;
}

/** Refus de la base : DROIT_INSUFFISANT (plus administrateur) affiché comme ACCES_REFUSE. */
function refusBase(code: CodeErreur) {
  // Catégorie déjà changée par un autre administrateur : la liste est
  // rafraîchie pour montrer son vrai état et ses vrais boutons.
  if (code === "ETAT_CATEGORIE_INVALIDE") revalidatePath(CHEMIN_CATEGORIES);
  return refus(code === "DROIT_INSUFFISANT" ? "ACCES_REFUSE" : code);
}

/**
 * Refus d'un nom par la base : NOM_CATEGORIE_PRIS (sous le champ, avec
 * « réactivez-la » si la catégorie existante est désactivée) ou
 * DONNEES_INVALIDES (sous le champ, à l'ajout ; au renommage, l'identifiant
 * déjà validé est inconnu : bandeau et liste rafraîchie) ; les autres refus
 * en bandeau.
 */
function refusNom(
  resultat: Extract<Resultat<unknown>, { ok: false }>,
  renommage = false,
): ResultatNomCategorie {
  if (resultat.code === "NOM_CATEGORIE_PRIS") {
    const erreurNom =
      resultat.detail?.desactivee === true
        ? MESSAGES_CATEGORIE.nomDesactive
        : messageErreur("NOM_CATEGORIE_PRIS");
    return { ...refus("NOM_CATEGORIE_PRIS"), erreurNom };
  }
  if (resultat.code === "DONNEES_INVALIDES" && !renommage) {
    return { ...refus("DONNEES_INVALIDES"), erreurNom: messageErreur("DONNEES_INVALIDES") };
  }
  return refusBase(sansCategorie(resultat.code));
}

/**
 * Ajoute une catégorie (story 5.2) : profil administrateur revérifié → Zod
 * (schéma partagé avec la fenêtre) → `ajouter_categorie` avec la SESSION de
 * l'administrateur (nom unique sans majuscules ni accents, journal).
 */
export async function ajouterCategorie(nomSaisi: unknown): Promise<ResultatNomCategorie> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const verification = verifierNomCategorie(nomSaisi);
  if (!verification.ok) return { ...refus("DONNEES_INVALIDES"), erreurNom: verification.erreur };
  const nom = verification.nom;

  const client = await clientSession("ajouterCategorie");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "ajouter_categorie", { p_nom: nom });
  if (!resultat.ok) return refusNom(resultat);
  const id = (resultat.donnees as { id?: unknown } | null)?.id;
  if (typeof id !== "string") {
    signaler("[ajouterCategorie] réponse inattendue de ajouter_categorie : id absent");
    rafraichir();
    return refus("ERREUR_INATTENDUE");
  }

  rafraichir();
  return { ok: true, donnees: { id, nom, modifie: true } };
}

/**
 * Renomme une catégorie (story 5.2) : profil administrateur revérifié → Zod →
 * `renommer_categorie` avec la session. Le nouveau nom est lu en direct
 * partout (liste, détail, filtres, anciennes demandes).
 */
export async function renommerCategorie(
  categorieId: unknown,
  nomSaisi: unknown,
): Promise<ResultatNomCategorie> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const identifiant = schemaIdCategorie.safeParse(categorieId);
  if (!identifiant.success) return refus("DONNEES_INVALIDES");
  const verification = verifierNomCategorie(nomSaisi);
  if (!verification.ok) return { ...refus("DONNEES_INVALIDES"), erreurNom: verification.erreur };
  const nom = verification.nom;

  const client = await clientSession("renommerCategorie");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "renommer_categorie", {
    p_id: identifiant.data,
    p_nom: nom,
  });
  if (!resultat.ok) return refusNom(resultat, true);
  // Nom identique : rien n'a changé (la base n'écrit rien).
  const modifie = (resultat.donnees as { modifie?: unknown } | null)?.modifie !== false;

  if (modifie) rafraichir();
  return { ok: true, donnees: { id: identifiant.data, nom, modifie } };
}

/**
 * Désactive une catégorie (story 5.2) : profil administrateur revérifié →
 * `desactiver_categorie` avec la session (jamais la dernière active :
 * DERNIERE_CATEGORIE). Les demandes qui l'utilisent la gardent.
 */
export async function desactiverCategorie(categorieId: unknown): Promise<ResultatAction<null>> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const identifiant = schemaIdCategorie.safeParse(categorieId);
  if (!identifiant.success) return refus("DONNEES_INVALIDES");

  const client = await clientSession("desactiverCategorie");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "desactiver_categorie", { p_id: identifiant.data });
  if (!resultat.ok) return refusBase(sansCategorie(resultat.code));

  rafraichir();
  return { ok: true, donnees: null };
}

/** Réactive une catégorie désactivée (story 5.2) : de nouveau proposée. */
export async function reactiverCategorie(categorieId: unknown): Promise<ResultatAction<null>> {
  const admin = await verifierAdmin();
  if (!admin.ok) return refus(admin.code);

  const identifiant = schemaIdCategorie.safeParse(categorieId);
  if (!identifiant.success) return refus("DONNEES_INVALIDES");

  const client = await clientSession("reactiverCategorie");
  if (!client) return refus("ERREUR_INATTENDUE");

  const resultat = await appeler<unknown>(client, "activer_categorie", { p_id: identifiant.data });
  if (!resultat.ok) return refusBase(sansCategorie(resultat.code));

  rafraichir();
  return { ok: true, donnees: null };
}
