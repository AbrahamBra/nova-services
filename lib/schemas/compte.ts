import { z } from "zod";
import { ROLES } from "@/lib/domaine";
import { MESSAGES_INVITATION, schemaInvitation } from "@/lib/schemas/invitation";

// Schéma unique de la fenêtre « Modifier » d'un compte (story 4.2, AD-8) :
// utilisé à l'écran (components/nova/comptes/actions-compte.tsx) et dans
// l'action serveur `modifierMembre` (lib/actions/admin.ts). Mêmes règles
// que l'invitation pour le nom et le rôle. La base revérifie tout
// (`modifier_membre`, migration 0026).

/** Champs de la fenêtre, dans l'ordre de l'écran (ordre du focus en erreur). */
export const CHAMPS_MODIFICATION = ["nom", "role"] as const;
export type ChampModification = (typeof CHAMPS_MODIFICATION)[number];
export type ErreursModification = Partial<Record<ChampModification, string>>;

export const schemaModification = z.object({
  id: z.uuid(),
  nom: schemaInvitation.shape.nom,
  role: z.enum(ROLES, { error: MESSAGES_INVITATION.role }),
});

export type DonneesModification = z.output<typeof schemaModification>;

export type VerificationModification =
  | { ok: true; donnees: DonneesModification }
  | { ok: false; erreurs: ErreursModification; idInvalide: boolean };

/** Valide la saisie ; en cas d'erreur, un message par champ (le premier trouvé). */
export function verifierModification(saisie: unknown): VerificationModification {
  const resultat = schemaModification.safeParse(saisie);
  if (resultat.success) return { ok: true, donnees: resultat.data };
  const erreurs: ErreursModification = {};
  let idInvalide = false;
  for (const probleme of resultat.error.issues) {
    const champ = probleme.path[0];
    if (champ === "id") idInvalide = true;
    if (
      typeof champ === "string" &&
      (CHAMPS_MODIFICATION as readonly string[]).includes(champ) &&
      !erreurs[champ as ChampModification]
    ) {
      erreurs[champ as ChampModification] = probleme.message;
    }
  }
  return { ok: false, erreurs, idInvalide };
}

/** Premier champ en erreur, dans l'ordre de l'écran. */
export function premierChampModificationEnErreur(
  erreurs: ErreursModification,
): ChampModification | null {
  return CHAMPS_MODIFICATION.find((champ) => erreurs[champ]) ?? null;
}

/** Identifiant d'un compte (désactiver, réactiver). */
export const schemaIdCompte = z.uuid();

/** Textes de réussite (toasts, EXPERIENCE.md §4). */
export const MESSAGES_COMPTE = {
  modifie: "Compte modifié.",
  desactive: "Compte désactivé.",
  reactive: "Compte réactivé.",
  invitationAnnulee: "Invitation annulée.",
} as const;

/** Texte de la fenêtre « Annuler l'invitation » (story 4.4). */
export function texteAnnulationInvitation(nom: string): string {
  return `L'invitation de ${nom} sera annulée et son compte disparaîtra de la liste.`;
}

/** Texte de la fenêtre « Désactiver » (EXPERIENCE.md §9.7). */
export function texteDesactivation(nom: string, demandesEnCours: number): string[] {
  const lignes = [`${nom} ne pourra plus se connecter.`];
  if (demandesEnCours === 1) {
    lignes.push("Sa demande en cours reviendra en Nouvelle, sans responsable.");
  } else if (demandesEnCours > 1) {
    lignes.push(`Ses ${demandesEnCours} demandes en cours reviendront en Nouvelle, sans responsable.`);
  }
  return lignes;
}
