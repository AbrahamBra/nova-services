import { z } from "zod";
import { formaterNombre } from "@/lib/format";
import { longueur } from "@/lib/schemas/depot";

// Saisies des actions de traitement des demandes (epic 2). La base revérifie
// tout. Story 2.1 : identifiant de la demande à prendre en charge.
// Story 2.2 : texte d'une note interne, schéma unique pour l'écran et
// l'action `ajouterNote` (AD-8) ; même limite que la base (ajouter_note).

/** Identifiant d'une demande (uuid). */
export const schemaIdentifiantDemande = z.guid();

/** Longueur maximale d'une note, comptée comme `char_length` en base. */
export const LONGUEUR_MAX_NOTE = 2000;

export const MESSAGES_NOTE = {
  vide: "Écrivez le texte de la note.",
  long: `La note ne doit pas dépasser ${formaterNombre(LONGUEUR_MAX_NOTE)} caractères.`,
  // Caractère nul (U+0000), refusé par PostgreSQL.
  caractereInterdit: "Ce texte contient un caractère non autorisé.",
} as const;

const CARACTERE_NUL = String.fromCharCode(0);

/**
 * Au moins un caractère qui n'est pas un espace, espaces Unicode compris
 * (U+00A0, U+200B, U+3000, U+FEFF…) : même classe que la migration 0015.
 */
const CARACTERE_VISIBLE =
  /[^\s\u0085\u00a0\u1680\u180e\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/;

/** Texte d'une note : espaces de début et de fin retirés, 1 à 2 000 caractères. */
export const schemaTexteNote = z
  .string(MESSAGES_NOTE.vide)
  .trim()
  .min(1, MESSAGES_NOTE.vide)
  .refine((valeur) => CARACTERE_VISIBLE.test(valeur), MESSAGES_NOTE.vide)
  .refine((valeur) => longueur(valeur) <= LONGUEUR_MAX_NOTE, MESSAGES_NOTE.long)
  .refine((valeur) => !valeur.includes(CARACTERE_NUL), MESSAGES_NOTE.caractereInterdit);

export type VerificationNote = { ok: true; texte: string } | { ok: false; message: string };

/** Vérifie le texte d'une note (écran et action) ; renvoie le texte nettoyé ou le message. */
export function verifierTexteNote(saisie: unknown): VerificationNote {
  const resultat = schemaTexteNote.safeParse(saisie);
  if (resultat.success) return { ok: true, texte: resultat.data };
  return { ok: false, message: resultat.error.issues[0]?.message ?? MESSAGES_NOTE.vide };
}
