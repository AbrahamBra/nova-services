import { z } from "zod";

// Schéma unique du formulaire « Choisir un mot de passe » (story 4.1, AD-8) :
// utilisé à l'écran (components/formulaire-mot-de-passe.tsx) et dans l'action
// serveur `choisirMotDePasse` (lib/actions/comptes.ts). Supabase Auth
// revérifie la longueur minimale (réglage du projet).

export const CHAMPS_MOT_DE_PASSE = ["mot_de_passe", "confirmation"] as const;
export type ChampMotDePasse = (typeof CHAMPS_MOT_DE_PASSE)[number];
export type ErreursMotDePasse = Partial<Record<ChampMotDePasse, string>>;

export const LONGUEUR_MIN_MOT_DE_PASSE = 8;
/** Limite de Supabase Auth (bcrypt) : 72 octets. */
export const LONGUEUR_MAX_MOT_DE_PASSE = 72;

/** Règle affichée sous le premier champ. */
export const REGLE_MOT_DE_PASSE = `${LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum`;

export const MESSAGES_MOT_DE_PASSE = {
  vide: "Choisissez un mot de passe.",
  court: `Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`,
  // Limite en octets (72) : les lettres accentuées en comptent plusieurs.
  long: "Le mot de passe est trop long.",
  confirmationVide: "Confirmez le mot de passe.",
  differents: "Les deux mots de passe ne sont pas identiques.",
  // Refus de Supabase Auth (mot de passe trop faible ou trop court).
  refuse: "Ce mot de passe n'est pas accepté. Choisissez-en un autre, plus long.",
} as const;

function octets(valeur: string): number {
  return new TextEncoder().encode(valeur).length;
}

export const schemaMotDePasse = z
  .object({
    // Jamais retouché : un espace peut faire partie du mot de passe.
    mot_de_passe: z
      .string()
      .min(1, MESSAGES_MOT_DE_PASSE.vide)
      .refine(
        (valeur) => valeur === "" || [...valeur].length >= LONGUEUR_MIN_MOT_DE_PASSE,
        MESSAGES_MOT_DE_PASSE.court,
      )
      .refine((valeur) => octets(valeur) <= LONGUEUR_MAX_MOT_DE_PASSE, MESSAGES_MOT_DE_PASSE.long),
    confirmation: z.string().min(1, MESSAGES_MOT_DE_PASSE.confirmationVide),
  })
  .refine((v) => v.confirmation === "" || v.mot_de_passe === v.confirmation, {
    path: ["confirmation"],
    message: MESSAGES_MOT_DE_PASSE.differents,
  });

export type SaisieMotDePasse = z.input<typeof schemaMotDePasse>;
export type DonneesMotDePasse = z.output<typeof schemaMotDePasse>;

export function lireSaisieMotDePasse(formulaire: FormData): SaisieMotDePasse {
  const texte = (nom: string) => {
    const valeur = formulaire.get(nom);
    return typeof valeur === "string" ? valeur : "";
  };
  return { mot_de_passe: texte("mot_de_passe"), confirmation: texte("confirmation") };
}

export type VerificationMotDePasse =
  | { ok: true; donnees: DonneesMotDePasse }
  | { ok: false; erreurs: ErreursMotDePasse };

export function verifierMotDePasse(saisie: unknown): VerificationMotDePasse {
  const resultat = schemaMotDePasse.safeParse(saisie);
  if (resultat.success) return { ok: true, donnees: resultat.data };
  const erreurs: ErreursMotDePasse = {};
  for (const probleme of resultat.error.issues) {
    const champ = probleme.path[0];
    if (
      typeof champ === "string" &&
      (CHAMPS_MOT_DE_PASSE as readonly string[]).includes(champ) &&
      !erreurs[champ as ChampMotDePasse]
    ) {
      erreurs[champ as ChampMotDePasse] = probleme.message;
    }
  }
  return { ok: false, erreurs };
}

export function premierChampMotDePasseEnErreur(erreurs: ErreursMotDePasse): ChampMotDePasse | null {
  return CHAMPS_MOT_DE_PASSE.find((champ) => erreurs[champ]) ?? null;
}

/** État renvoyé par l'action `choisirMotDePasse` au formulaire (useActionState). */
export type EtatMotDePasse = {
  erreurs: ErreursMotDePasse;
  /** Lien plus valable (session absente) ou erreur serveur, en bandeau. */
  erreurGenerale: { type: "lien" | "serveur"; message: string } | null;
  tentative: number;
};

export const ETAT_MOT_DE_PASSE_INITIAL: EtatMotDePasse = {
  erreurs: {},
  erreurGenerale: null,
  tentative: 0,
};

// --- Lien d'invitation (/auth/confirmer) -----------------------------------

/** Types de lien acceptés par /auth/confirmer (story 4.3 : `recovery`). */
export const TYPES_LIEN = ["invite"] as const;
export type TypeLien = (typeof TYPES_LIEN)[number];

/** Jeton haché de Supabase : lettres, chiffres, « _ » et « - » ; longueur bornée. */
export const schemaLien = z.object({
  token_hash: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  type: z.enum(TYPES_LIEN),
});

export type EtatConfirmation = { erreur: string | null; tentative: number };
export const ETAT_CONFIRMATION_INITIAL: EtatConfirmation = { erreur: null, tentative: 0 };
