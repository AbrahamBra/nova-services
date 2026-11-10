import { z } from "zod";
import { formaterDuree } from "@/lib/format";

// Schéma unique de la page « Paramètres » (story 5.3, AD-8) : utilisé à
// l'écran (components/nova/parametres/) et dans l'action serveur
// `modifierParametres` (lib/actions/parametres.ts). La base revérifie tout
// (`modifier_parametres`, migration 0032).

/** Champs du formulaire, dans l'ordre de l'écran (ordre du focus en erreur). */
export const CHAMPS_PARAMETRES = ["nom_affiche", "email_contact", "duree_conservation_mois"] as const;
export type ChampParametres = (typeof CHAMPS_PARAMETRES)[number];
export type ErreursParametres = Partial<Record<ChampParametres, string>>;

/** Longueur maximale du nom affiché (contrainte de la table `parametres`). */
export const NOM_AFFICHE_MAX = 150;
const LONGUEUR_MAX_EMAIL = 254;

/** Bornes de la durée de conservation, en mois (contrainte de la table). */
export const DUREE_MIN_MOIS = 6;
export const DUREE_MAX_MOIS = 60;

/** Durées proposées dans la liste : 6 mois, 1 an, 18 mois, 2 ans, 3 ans, 4 ans, 5 ans. */
export const DUREES_CONSERVATION = [6, 12, 18, 24, 36, 48, 60] as const;

/**
 * Options de la liste « Durée de conservation », libellées par
 * `formaterDuree`. Les durées données (enregistrée, choisie) hors de la liste
 * (appel direct de la base) y sont ajoutées à leur place, pour ne jamais être
 * remplacées en silence ni devenir impossibles à choisir de nouveau.
 */
export function optionsDuree(...actuelles: number[]): { valeur: number; libelle: string }[] {
  const durees: number[] = [...DUREES_CONSERVATION];
  for (const actuelle of actuelles) {
    if (
      Number.isInteger(actuelle) &&
      actuelle >= DUREE_MIN_MOIS &&
      actuelle <= DUREE_MAX_MOIS &&
      !durees.includes(actuelle)
    ) {
      durees.push(actuelle);
    }
  }
  durees.sort((a, b) => a - b);
  return durees.map((valeur) => ({ valeur, libelle: formaterDuree(valeur) }));
}

// Textes : EXPERIENCE.md §3 (vouvoiement, phrases courtes, sans « ! »).
export const MESSAGES_PARAMETRES = {
  nomVide: "Indiquez le nom affiché.",
  nomLong: `Le nom affiché ne doit pas dépasser ${NOM_AFFICHE_MAX} caractères.`,
  emailVide: "Indiquez l'adresse email de contact.",
  emailInvalide: "Cette adresse email ne semble pas valide.",
  duree: "Choisissez une durée de conservation.",
  enregistres: "Paramètres enregistrés.",
} as const;

export const schemaParametres = z.object({
  nom_affiche: z
    .string({ error: MESSAGES_PARAMETRES.nomVide })
    .trim()
    .min(1, MESSAGES_PARAMETRES.nomVide)
    .refine((valeur) => [...valeur].length <= NOM_AFFICHE_MAX, MESSAGES_PARAMETRES.nomLong),
  // Même schéma que les autres emails : espaces retirés et minuscules (AD-31).
  email_contact: z
    .string({ error: MESSAGES_PARAMETRES.emailVide })
    .trim()
    .toLowerCase()
    .min(1, MESSAGES_PARAMETRES.emailVide)
    .refine(
      (valeur) =>
        valeur === "" || (valeur.length <= LONGUEUR_MAX_EMAIL && z.regexes.email.test(valeur)),
      MESSAGES_PARAMETRES.emailInvalide,
    ),
  // Entier de 6 à 60 mois (la liste n'en propose que quelques-uns ; la base
  // accepte toute la plage).
  duree_conservation_mois: z.coerce
    .number({ error: MESSAGES_PARAMETRES.duree })
    .int(MESSAGES_PARAMETRES.duree)
    .min(DUREE_MIN_MOIS, MESSAGES_PARAMETRES.duree)
    .max(DUREE_MAX_MOIS, MESSAGES_PARAMETRES.duree),
});

export type SaisieParametres = Record<ChampParametres, string>;
export type DonneesParametres = z.output<typeof schemaParametres>;

export type VerificationParametres =
  | { ok: true; donnees: DonneesParametres }
  | { ok: false; erreurs: ErreursParametres };

/** Valide la saisie ; en cas d'erreur, un message par champ (le premier trouvé). */
export function verifierParametres(saisie: unknown): VerificationParametres {
  // Durée vide : « Choisissez… », jamais 0 (z.coerce changerait "" en 0).
  const avecDuree =
    typeof saisie === "object" &&
    saisie !== null &&
    (saisie as Record<string, unknown>).duree_conservation_mois === ""
      ? { ...(saisie as Record<string, unknown>), duree_conservation_mois: undefined }
      : saisie;
  const resultat = schemaParametres.safeParse(avecDuree);
  if (resultat.success) return { ok: true, donnees: resultat.data };
  const erreurs: ErreursParametres = {};
  for (const probleme of resultat.error.issues) {
    const champ = probleme.path[0];
    if (
      typeof champ === "string" &&
      (CHAMPS_PARAMETRES as readonly string[]).includes(champ) &&
      !erreurs[champ as ChampParametres]
    ) {
      erreurs[champ as ChampParametres] = probleme.message;
    }
  }
  // Saisie qui n'est pas un objet : erreur sur le premier champ.
  if (Object.keys(erreurs).length === 0) erreurs.nom_affiche = MESSAGES_PARAMETRES.nomVide;
  return { ok: false, erreurs };
}

/** Premier champ en erreur, dans l'ordre de l'écran. */
export function premierChampParametresEnErreur(erreurs: ErreursParametres): ChampParametres | null {
  return CHAMPS_PARAMETRES.find((champ) => erreurs[champ]) ?? null;
}
