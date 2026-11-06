import { z } from "zod";
import { LIBELLES_ROLE, ROLES, type Role } from "@/lib/domaine";

// Schéma unique de la fenêtre « Inviter un membre » (story 4.1, AD-8) :
// utilisé à l'écran (components/nova/comptes/inviter-membre.tsx) et dans
// l'action serveur `inviter` (lib/actions/admin.ts). La base revérifie tout
// (`creer_membre`, migration 0024).

/** Champs de la fenêtre, dans l'ordre de l'écran (ordre du focus en erreur). */
export const CHAMPS_INVITATION = ["nom", "email", "role"] as const;
export type ChampInvitation = (typeof CHAMPS_INVITATION)[number];
export type ErreursInvitation = Partial<Record<ChampInvitation, string>>;

/** Rôle proposé par défaut. */
export const ROLE_PAR_DEFAUT: Role = "collaborateur";

export const LONGUEUR_MAX_NOM = 150;
const LONGUEUR_MAX_EMAIL = 254;

// Textes : EXPERIENCE.md §3 (vouvoiement, phrases courtes, sans « ! »).
export const MESSAGES_INVITATION = {
  nomVide: "Indiquez le nom et prénom du membre.",
  nomLong: `Le nom ne doit pas dépasser ${LONGUEUR_MAX_NOM} caractères.`,
  emailVide: "Indiquez l'adresse email du membre.",
  emailInvalide: "Cette adresse email ne semble pas valide.",
  role: "Choisissez un rôle.",
} as const;

export const schemaInvitation = z.object({
  nom: z
    .string()
    .trim()
    .min(1, MESSAGES_INVITATION.nomVide)
    .refine((valeur) => [...valeur].length <= LONGUEUR_MAX_NOM, MESSAGES_INVITATION.nomLong),
  // Espaces retirés et minuscules (AD-31).
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, MESSAGES_INVITATION.emailVide)
    .refine(
      (valeur) =>
        valeur === "" || (valeur.length <= LONGUEUR_MAX_EMAIL && z.regexes.email.test(valeur)),
      MESSAGES_INVITATION.emailInvalide,
    ),
  role: z.enum(ROLES, { error: MESSAGES_INVITATION.role }),
});

export type SaisieInvitation = z.input<typeof schemaInvitation>;
export type DonneesInvitation = z.output<typeof schemaInvitation>;

/** Lit la saisie dans le FormData de la fenêtre (écran et action). */
export function lireSaisieInvitation(formulaire: FormData): Record<ChampInvitation, string> {
  const texte = (nom: string) => {
    const valeur = formulaire.get(nom);
    return typeof valeur === "string" ? valeur : "";
  };
  return { nom: texte("nom"), email: texte("email"), role: texte("role") };
}

export type VerificationInvitation =
  | { ok: true; donnees: DonneesInvitation }
  | { ok: false; erreurs: ErreursInvitation };

/** Valide la saisie ; en cas d'erreur, un message par champ (le premier trouvé). */
export function verifierInvitation(saisie: unknown): VerificationInvitation {
  const resultat = schemaInvitation.safeParse(saisie);
  if (resultat.success) return { ok: true, donnees: resultat.data };
  const erreurs: ErreursInvitation = {};
  for (const probleme of resultat.error.issues) {
    const champ = probleme.path[0];
    if (
      typeof champ === "string" &&
      (CHAMPS_INVITATION as readonly string[]).includes(champ) &&
      !erreurs[champ as ChampInvitation]
    ) {
      erreurs[champ as ChampInvitation] = probleme.message;
    }
  }
  return { ok: false, erreurs };
}

/** Premier champ en erreur, dans l'ordre de l'écran. */
export function premierChampInvitationEnErreur(erreurs: ErreursInvitation): ChampInvitation | null {
  return CHAMPS_INVITATION.find((champ) => erreurs[champ]) ?? null;
}

/** Invitation créée : de quoi afficher la fenêtre du lien. */
export type InvitationCreee = { nom: string; lien: string };

/** État renvoyé par l'action `inviter` à la fenêtre (useActionState). */
export type EtatInvitation = {
  erreurs: ErreursInvitation;
  /** Erreur générale, en bandeau dans la fenêtre. */
  erreurGenerale: string | null;
  /** Numéro de la réponse : chaque réponse replace le focus. */
  tentative: number;
  /** Invitation créée (réussite), sinon null. */
  invitation: InvitationCreee | null;
};

export const ETAT_INVITATION_INITIAL: EtatInvitation = {
  erreurs: {},
  erreurGenerale: null,
  tentative: 0,
  invitation: null,
};

/** Libellés de la liste « Rôle », dans l'ordre de ROLES. */
export const OPTIONS_ROLE = ROLES.map((role) => ({ valeur: role, libelle: LIBELLES_ROLE[role] }));

/** Rappel de la fenêtre du lien (mode démonstration). */
export const RAPPEL_VALIDITE_LIEN = "Ce lien est valable 24 h.";
