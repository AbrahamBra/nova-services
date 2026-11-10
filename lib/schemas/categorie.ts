import { z } from "zod";
import { formaterNombre } from "@/lib/format";

// Schéma unique de la fenêtre « Ajouter une catégorie » / « Renommer »
// (story 5.2, AD-8) : utilisé à l'écran (components/nova/categories/) et dans
// les actions serveur (lib/actions/categories.ts). La base revérifie tout
// (`ajouter_categorie`, `renommer_categorie`, migration 0031), y compris le
// nom unique sans majuscules ni accents.

/** Longueur maximale d'un nom de catégorie (contrainte de la table). */
export const NOM_CATEGORIE_MAX = 80;

/** Textes de la page Catégories (erreurs sous le champ, toasts). */
export const MESSAGES_CATEGORIE = {
  nomRequis: "Indiquez le nom de la catégorie.",
  nomTropLong: `Le nom ne doit pas dépasser ${NOM_CATEGORIE_MAX} caractères.`,
  /** NOM_CATEGORIE_PRIS quand la catégorie existante est désactivée. */
  nomDesactive: "Une catégorie désactivée porte déjà ce nom : réactivez-la.",
  ajoutee: "Catégorie ajoutée.",
  renommee: "Catégorie renommée.",
  desactivee: "Catégorie désactivée.",
  reactivee: "Catégorie réactivée.",
} as const;

// Espaces retirés aux extrémités ; longueur en caractères, comme
// `char_length` en base.
export const schemaNomCategorie = z
  .string({ error: MESSAGES_CATEGORIE.nomRequis })
  .trim()
  .min(1, MESSAGES_CATEGORIE.nomRequis)
  // Au moins une lettre ou un chiffre : « - » ou « ' » seuls deviendraient
  // un nom vide une fois normalisé (prive.normaliser).
  .refine((valeur) => /[\p{L}\p{N}]/u.test(valeur), MESSAGES_CATEGORIE.nomRequis)
  .refine((valeur) => [...valeur].length <= NOM_CATEGORIE_MAX, MESSAGES_CATEGORIE.nomTropLong);

/** Identifiant d'une catégorie (renommer, désactiver, réactiver). */
export const schemaIdCategorie = z.uuid();

export type VerificationNom = { ok: true; nom: string } | { ok: false; erreur: string };

/** Valide le nom saisi ; en cas d'erreur, le message à afficher sous le champ. */
export function verifierNomCategorie(saisie: unknown): VerificationNom {
  const resultat = schemaNomCategorie.safeParse(saisie);
  if (resultat.success) return { ok: true, nom: resultat.data };
  return { ok: false, erreur: resultat.error.issues[0]?.message ?? MESSAGES_CATEGORIE.nomRequis };
}

/**
 * Texte de la fenêtre « Désactiver » : sans le nombre si aucune demande ne
 * l'utilise, au singulier pour une seule.
 */
export function texteDesactivationCategorie(nom: string, demandes: number): string {
  const debut = `« ${nom} » ne sera plus proposée dans le formulaire ni dans le choix de catégorie.`;
  if (demandes <= 0) return debut;
  if (demandes === 1) return `${debut} La demande qui l'utilise la garde.`;
  return `${debut} Les ${formaterNombre(demandes)} demandes qui l'utilisent la gardent.`;
}
