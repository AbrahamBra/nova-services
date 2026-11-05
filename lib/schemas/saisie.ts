import { z } from "zod";
import type { Canal } from "@/lib/domaine";
import { MESSAGES_ERREUR } from "@/lib/erreurs";
import {
  LONGUEURS_MAX,
  MESSAGES_DEPOT,
  longueur,
  texteFacultatif,
  texteObligatoire,
} from "@/lib/schemas/depot";

// Schéma unique de la saisie interne « Saisir une demande » (story 2.6,
// AD-8) : utilisé à l'écran (components/formulaire-saisie.tsx) et dans
// l'action serveur `saisir` (lib/actions/demandes.ts). Mêmes longueurs et
// mêmes règles que le formulaire public (lib/schemas/depot.ts), avec ces
// différences : canal Téléphone ou Email obligatoire, email facultatif mais
// au moins un email ou un téléphone, pas de consentement ni de champ piège.
// La base revérifie tout (`saisir_demande`, migration 0020).

/** Canaux de la saisie interne (jamais « formulaire »). */
export const CANAUX_SAISIE = ["telephone", "email"] as const satisfies readonly Canal[];
export type CanalSaisie = (typeof CANAUX_SAISIE)[number];

/** Champs du formulaire, dans l'ordre de l'écran (ordre du focus en erreur). */
export const CHAMPS_SAISIE = [
  "canal",
  "nom",
  "email",
  "telephone",
  "societe",
  "categorie_id",
  "objet",
  "description",
] as const;
export type ChampSaisie = (typeof CHAMPS_SAISIE)[number];

export type ErreursSaisie = Partial<Record<ChampSaisie, string>>;

// Textes : EXPERIENCE.md §3. Le membre saisit pour le demandeur : pas de
// « votre » pour les champs qui le concernent.
export const MESSAGES_SAISIE = {
  canal: "Choisissez le canal.",
  nomVide: "Indiquez le nom et prénom du demandeur.",
  nomLong: MESSAGES_DEPOT.nomLong,
  emailInvalide: MESSAGES_DEPOT.emailInvalide,
  // Même texte que le refus de la base (COORDONNEES_REQUISES).
  coordonnees: MESSAGES_ERREUR.COORDONNEES_REQUISES,
  telephoneLong: MESSAGES_DEPOT.telephoneLong,
  societeLong: MESSAGES_DEPOT.societeLong,
  categorie: MESSAGES_DEPOT.categorie,
  objetVide: "Indiquez l'objet de la demande.",
  objetLong: MESSAGES_DEPOT.objetLong,
  descriptionVide: "Décrivez la demande.",
  descriptionLong: MESSAGES_DEPOT.descriptionLong,
} as const;

/** Rappel affiché à la place de la case de consentement. */
export const RAPPEL_DONNEES = "Pensez à informer le demandeur de l'usage de ses données.";

function estVide(valeur: unknown): boolean {
  return valeur === null || (typeof valeur === "string" && valeur.trim() === "");
}

export const schemaSaisie = z
  .object({
    // Clé anti-doublon créée à l'affichage du formulaire (AD-26).
    cle_envoi: z.uuid(),
    canal: z.enum(CANAUX_SAISIE, { error: MESSAGES_SAISIE.canal }),
    nom: texteObligatoire(LONGUEURS_MAX.nom, MESSAGES_SAISIE.nomVide, MESSAGES_SAISIE.nomLong),
    // Facultatif ; espaces retirés et minuscules (AD-31) ; vide → null.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine(
        (valeur) =>
          valeur === "" ||
          (longueur(valeur) <= LONGUEURS_MAX.email && z.regexes.email.test(valeur)),
        MESSAGES_SAISIE.emailInvalide,
      )
      .transform((valeur) => (valeur === "" ? null : valeur)),
    telephone: texteFacultatif(LONGUEURS_MAX.telephone, MESSAGES_SAISIE.telephoneLong),
    societe: texteFacultatif(LONGUEURS_MAX.societe, MESSAGES_SAISIE.societeLong),
    categorie_id: z.uuid({ error: MESSAGES_SAISIE.categorie }),
    objet: texteObligatoire(LONGUEURS_MAX.objet, MESSAGES_SAISIE.objetVide, MESSAGES_SAISIE.objetLong),
    description: texteObligatoire(
      LONGUEURS_MAX.description,
      MESSAGES_SAISIE.descriptionVide,
      MESSAGES_SAISIE.descriptionLong,
    ),
  })
  // Au moins un email ou un téléphone, message sous le champ Email. Vérifié
  // aussi quand d'autres champs sont en erreur (`when`, tous les messages
  // d'un coup) : la valeur peut alors être la saisie brute.
  .refine(
    (valeur: unknown) => {
      if (typeof valeur !== "object" || valeur === null) return true;
      const v = valeur as Record<string, unknown>;
      return !(estVide(v.email) && estVide(v.telephone));
    },
    { path: ["email"], message: MESSAGES_SAISIE.coordonnees, when: () => true },
  );

/** Saisie brute, telle que lue dans le formulaire. */
export type EntreeSaisie = z.input<typeof schemaSaisie>;
/** Données validées et nettoyées, prêtes pour `saisir_demande`. */
export type DonneesSaisie = z.output<typeof schemaSaisie>;

/** Lit la saisie dans le FormData du formulaire (écran et action). */
export function lireSaisie(formulaire: FormData): Record<keyof EntreeSaisie, string> {
  const texte = (nom: string) => {
    const valeur = formulaire.get(nom);
    return typeof valeur === "string" ? valeur : "";
  };
  return {
    cle_envoi: texte("cle_envoi"),
    canal: texte("canal"),
    nom: texte("nom"),
    email: texte("email"),
    telephone: texte("telephone"),
    societe: texte("societe"),
    categorie_id: texte("categorie_id"),
    objet: texte("objet"),
    description: texte("description"),
  };
}

export type VerificationSaisie =
  | { ok: true; donnees: DonneesSaisie }
  | { ok: false; erreurs: ErreursSaisie; cleInvalide: boolean };

/** Valide la saisie ; en cas d'erreur, un message par champ (le premier trouvé). */
export function verifierSaisie(saisie: unknown): VerificationSaisie {
  const resultat = schemaSaisie.safeParse(saisie);
  if (resultat.success) return { ok: true, donnees: resultat.data };

  const erreurs: ErreursSaisie = {};
  let cleInvalide = false;
  for (const probleme of resultat.error.issues) {
    const champ = probleme.path[0];
    if (champ === "cle_envoi") {
      cleInvalide = true;
    } else if (
      typeof champ === "string" &&
      (CHAMPS_SAISIE as readonly string[]).includes(champ) &&
      !erreurs[champ as ChampSaisie]
    ) {
      erreurs[champ as ChampSaisie] = probleme.message;
    }
  }
  return { ok: false, erreurs, cleInvalide };
}

/** Premier champ en erreur, dans l'ordre de l'écran. */
export function premierChampSaisieEnErreur(erreurs: ErreursSaisie): ChampSaisie | null {
  return CHAMPS_SAISIE.find((champ) => erreurs[champ]) ?? null;
}

/** État renvoyé par l'action `saisir` au formulaire (useActionState). */
export type EtatSaisie = {
  /** Erreurs affichées sous les champs. */
  erreurs: ErreursSaisie;
  /** Erreur générale, en bandeau. */
  erreurGenerale: string | null;
  /** Numéro de la réponse : chaque réponse replace le focus ou ouvre le détail. */
  tentative: number;
  /** Référence de la demande enregistrée (réussite), sinon null. */
  reference: string | null;
};

export const ETAT_SAISIE_INITIAL: EtatSaisie = {
  erreurs: {},
  erreurGenerale: null,
  tentative: 0,
  reference: null,
};

/** Message du toast après l'enregistrement. */
export function messageSaisieEnregistree(reference: string): string {
  return `Demande ${reference} enregistrée.`;
}
