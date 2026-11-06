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

// --- Lien d'invitation ou de réinitialisation (/auth/confirmer) ------------

/** Types de lien acceptés par /auth/confirmer : invitation (4.1), réinitialisation (4.3). */
export const TYPES_LIEN = ["invite", "recovery"] as const;
export type TypeLien = (typeof TYPES_LIEN)[number];

/** Jeton haché de Supabase : lettres, chiffres, « _ » et « - » ; longueur bornée. */
export const schemaLien = z.object({
  token_hash: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  type: z.enum(TYPES_LIEN),
});

/** Type de lien lu dans une valeur quelconque (pour choisir le message), sinon null. */
export function lireTypeLien(valeur: unknown): TypeLien | null {
  return (TYPES_LIEN as readonly unknown[]).includes(valeur) ? (valeur as TypeLien) : null;
}

export type EtatConfirmation = {
  erreur: string | null;
  /** Vrai si le lien est refusé (invalide, expiré, déjà utilisé) : « Continuer » disparaît. */
  lienRefuse?: boolean;
  tentative: number;
};
export const ETAT_CONFIRMATION_INITIAL: EtatConfirmation = { erreur: null, tentative: 0 };

/**
 * Parcours de la page /nouveau-mot-de-passe : premier mot de passe d'un
 * invité (4.1) ou nouveau mot de passe après un lien de réinitialisation
 * (4.3). Envoyé par le formulaire seulement pour choisir le message « lien
 * plus valable » : jamais pour décider d'un droit.
 */
export const PARCOURS_MOT_DE_PASSE = ["invitation", "reinitialisation"] as const;
export type ParcoursMotDePasse = (typeof PARCOURS_MOT_DE_PASSE)[number];

export function lireParcours(valeur: unknown): ParcoursMotDePasse {
  return valeur === "reinitialisation" ? "reinitialisation" : "invitation";
}

// --- Mot de passe oublié (/mot-de-passe-oublie, story 4.3) -----------------

/** Page publique de la demande d'un lien. */
export const PAGE_MOT_DE_PASSE_OUBLIE = "/mot-de-passe-oublie";

/** Message unique, que l'adresse corresponde à un compte ou non. */
export const MESSAGE_DEMANDE_LIEN =
  "Si un compte actif correspond à cette adresse, un email avec un lien valable 24 h vient de lui être envoyé. Sans email, demandez un lien à votre administrateur.";

export const MESSAGES_DEMANDE_LIEN = {
  emailVide: "Indiquez votre adresse email.",
  emailInvalide: "Cette adresse email ne semble pas valide.",
} as const;

const LONGUEUR_MAX_EMAIL = 254;

export const schemaDemandeLien = z.object({
  // Espaces retirés et minuscules (AD-31).
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, MESSAGES_DEMANDE_LIEN.emailVide)
    .refine(
      (valeur) =>
        valeur === "" || (valeur.length <= LONGUEUR_MAX_EMAIL && z.regexes.email.test(valeur)),
      MESSAGES_DEMANDE_LIEN.emailInvalide,
    ),
});

export type ErreursDemandeLien = { email?: string };

export function lireSaisieDemandeLien(formulaire: FormData): { email: string } {
  const valeur = formulaire.get("email");
  return { email: typeof valeur === "string" ? valeur : "" };
}

export type VerificationDemandeLien =
  | { ok: true; donnees: { email: string } }
  | { ok: false; erreurs: ErreursDemandeLien };

export function verifierDemandeLien(saisie: unknown): VerificationDemandeLien {
  const resultat = schemaDemandeLien.safeParse(saisie);
  if (resultat.success) return { ok: true, donnees: resultat.data };
  const probleme = resultat.error.issues.find((p) => p.path[0] === "email");
  return { ok: false, erreurs: { email: probleme?.message ?? MESSAGES_DEMANDE_LIEN.emailInvalide } };
}

/** État renvoyé par l'action `demanderLienMotDePasse` au formulaire (useActionState). */
export type EtatDemandeLien = {
  erreurs: ErreursDemandeLien;
  /** Vrai après une demande acceptée : le message unique est affiché. */
  envoyee: boolean;
  /**
   * Vrai seulement quand la demande n'a pas atteint le serveur (réseau,
   * côté navigateur) : erreur générique avec « Réessayer ». Toute réponse du
   * serveur donne le message unique.
   */
  echecEnvoi?: boolean;
  tentative: number;
};

export const ETAT_DEMANDE_LIEN_INITIAL: EtatDemandeLien = {
  erreurs: {},
  envoyee: false,
  tentative: 0,
};
