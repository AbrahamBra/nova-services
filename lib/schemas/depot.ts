import { z } from "zod";
import { MESSAGES_ERREUR } from "@/lib/erreurs";
import { formaterNombre } from "@/lib/format";

// Schéma unique du formulaire public « Déposer une demande » (AD-8) :
// utilisé à l'écran (components/formulaire-depot.tsx) et dans l'action
// serveur `deposer` (lib/actions/demandes.ts). Les mêmes longueurs sont des
// contraintes de la base (migration 20261103000003).

export const LONGUEURS_MAX = {
  nom: 150,
  email: 254,
  telephone: 30,
  societe: 150,
  objet: 150,
  description: 5000,
} as const;

/**
 * Nombre de caractères, compté comme `char_length` en base : un emoji vaut 1
 * (points de code Unicode, et non unités UTF-16 comme `String.length`).
 */
export function longueur(texte: string): number {
  return Array.from(texte).length;
}

/** Champs du formulaire, dans l'ordre de l'écran (ordre du focus en erreur). */
export const CHAMPS_DEPOT = [
  "nom",
  "email",
  "telephone",
  "societe",
  "categorie_id",
  "objet",
  "description",
  "consentement",
] as const;
export type ChampDepot = (typeof CHAMPS_DEPOT)[number];

export type ErreursDepot = Partial<Record<ChampDepot, string>>;

// Textes : EXPERIENCE.md §3 (vouvoiement, phrases courtes, sans « ! »).
export const MESSAGES_DEPOT = {
  nomVide: "Indiquez votre nom et prénom.",
  nomLong: `Le nom ne doit pas dépasser ${LONGUEURS_MAX.nom} caractères.`,
  emailVide: "Indiquez votre adresse email.",
  emailInvalide: "Cette adresse email ne semble pas valide.",
  telephoneLong: `Le téléphone ne doit pas dépasser ${LONGUEURS_MAX.telephone} caractères.`,
  societeLong: `La société ne doit pas dépasser ${LONGUEURS_MAX.societe} caractères.`,
  // Même texte que le refus de la base (une seule formulation par champ).
  categorie: MESSAGES_ERREUR.CATEGORIE_INVALIDE,
  objetVide: "Indiquez l'objet de votre demande.",
  objetLong: `L'objet ne doit pas dépasser ${LONGUEURS_MAX.objet} caractères.`,
  descriptionVide: "Décrivez votre demande.",
  descriptionLong: `La description ne doit pas dépasser ${formaterNombre(LONGUEURS_MAX.description)} caractères.`,
  consentement: MESSAGES_ERREUR.CONSENTEMENT_REQUIS,
  // Caractère nul (U+0000), refusé par PostgreSQL.
  caractereInterdit: "Ce texte contient un caractère non autorisé.",
} as const;

const CARACTERE_NUL = String.fromCharCode(0);
const sansCaractereNul = (valeur: string) => !valeur.includes(CARACTERE_NUL);

function texteObligatoire(max: number, vide: string, long: string) {
  return z
    .string()
    .trim()
    .min(1, vide)
    .refine((valeur) => longueur(valeur) <= max, long)
    .refine(sansCaractereNul, MESSAGES_DEPOT.caractereInterdit);
}

function texteFacultatif(max: number, long: string) {
  return z
    .string()
    .trim()
    .refine((valeur) => longueur(valeur) <= max, long)
    .refine(sansCaractereNul, MESSAGES_DEPOT.caractereInterdit)
    .transform((valeur) => (valeur === "" ? null : valeur));
}

export const schemaDepot = z.object({
  // Clé anti-doublon créée à l'affichage du formulaire (AD-26).
  cle_envoi: z.uuid(),
  nom: texteObligatoire(LONGUEURS_MAX.nom, MESSAGES_DEPOT.nomVide, MESSAGES_DEPOT.nomLong),
  // Espaces retirés et minuscules (AD-31).
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, MESSAGES_DEPOT.emailVide)
    .refine(
      (valeur) =>
        valeur === "" ||
        (longueur(valeur) <= LONGUEURS_MAX.email && z.regexes.email.test(valeur)),
      MESSAGES_DEPOT.emailInvalide,
    ),
  telephone: texteFacultatif(LONGUEURS_MAX.telephone, MESSAGES_DEPOT.telephoneLong),
  societe: texteFacultatif(LONGUEURS_MAX.societe, MESSAGES_DEPOT.societeLong),
  categorie_id: z.uuid({ error: MESSAGES_DEPOT.categorie }),
  objet: texteObligatoire(LONGUEURS_MAX.objet, MESSAGES_DEPOT.objetVide, MESSAGES_DEPOT.objetLong),
  description: texteObligatoire(
    LONGUEURS_MAX.description,
    MESSAGES_DEPOT.descriptionVide,
    MESSAGES_DEPOT.descriptionLong,
  ),
  consentement: z.literal(true, { error: MESSAGES_DEPOT.consentement }),
});

/** Saisie brute, telle que lue dans le formulaire (case non cochée : false). */
export type SaisieDepot = Omit<z.input<typeof schemaDepot>, "consentement"> & {
  consentement: boolean;
};
/** Données validées et nettoyées, prêtes pour `deposer_demande`. */
export type DonneesDepot = z.output<typeof schemaDepot>;

/**
 * Champ piège (story 1.8) : invisible pour les humains, hors du parcours
 * clavier et ignoré par les lecteurs d'écran ; les robots le remplissent.
 * Hors du schéma Zod : l'action `deposer` le vérifie avant tout le reste.
 */
export const CHAMP_PIEGE = "site_web";

/** Vrai si le champ piège contient quelque chose (même des espaces). */
export function champPiegeRempli(formulaire: FormData): boolean {
  const valeur = formulaire.get(CHAMP_PIEGE);
  return valeur !== null && (typeof valeur !== "string" || valeur !== "");
}

/** Lit la saisie dans le FormData du formulaire (écran et action). */
export function lireSaisieDepot(formulaire: FormData): SaisieDepot {
  const texte = (nom: string) => {
    const valeur = formulaire.get(nom);
    return typeof valeur === "string" ? valeur : "";
  };
  return {
    cle_envoi: texte("cle_envoi"),
    nom: texte("nom"),
    email: texte("email"),
    telephone: texte("telephone"),
    societe: texte("societe"),
    categorie_id: texte("categorie_id"),
    objet: texte("objet"),
    description: texte("description"),
    // Case cochée : la valeur « oui » est envoyée ; sinon, rien.
    consentement: formulaire.get("consentement") === "oui",
  };
}

export type VerificationDepot =
  | { ok: true; donnees: DonneesDepot }
  | { ok: false; erreurs: ErreursDepot; cleInvalide: boolean };

/** Valide la saisie ; en cas d'erreur, un message par champ (le premier trouvé). */
export function verifierDepot(saisie: unknown): VerificationDepot {
  const resultat = schemaDepot.safeParse(saisie);
  if (resultat.success) return { ok: true, donnees: resultat.data };

  const erreurs: ErreursDepot = {};
  let cleInvalide = false;
  for (const probleme of resultat.error.issues) {
    const champ = probleme.path[0];
    if (champ === "cle_envoi") {
      cleInvalide = true;
    } else if (
      typeof champ === "string" &&
      (CHAMPS_DEPOT as readonly string[]).includes(champ) &&
      !erreurs[champ as ChampDepot]
    ) {
      erreurs[champ as ChampDepot] = probleme.message;
    }
  }
  return { ok: false, erreurs, cleInvalide };
}

/** Premier champ en erreur, dans l'ordre de l'écran. */
export function premierChampEnErreur(erreurs: ErreursDepot): ChampDepot | null {
  return CHAMPS_DEPOT.find((champ) => erreurs[champ]) ?? null;
}

/** État renvoyé par l'action `deposer` au formulaire (useActionState). */
export type EtatDepot = {
  /** Erreurs affichées sous les champs. */
  erreurs: ErreursDepot;
  /** Erreur générale, en bandeau (« Le serveur ne répond pas… »). */
  erreurGenerale: string | null;
  /** Numéro de la réponse : chaque réponse en erreur replace le focus. */
  tentative: number;
};

export const ETAT_DEPOT_INITIAL: EtatDepot = {
  erreurs: {},
  erreurGenerale: null,
  tentative: 0,
};
