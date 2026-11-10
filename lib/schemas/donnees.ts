import { z } from "zod";
import { STATUTS, type Statut } from "@/lib/domaine";
import { formaterNombre } from "@/lib/format";

// Schéma et textes du bloc « Droit à l'effacement » de la page Données
// personnelles (story 5.4, AD-8) : utilisés à l'écran
// (components/nova/donnees/) et dans les actions serveur
// (lib/actions/donnees.ts). La base revérifie tout
// (`chercher_demandes_demandeur`, `effacer_demandeur`, migration 0033).
// L'email ne passe jamais par l'adresse de la page (action serveur).

const LONGUEUR_MAX_EMAIL = 254;

// Textes : EXPERIENCE.md §3 (vouvoiement, phrases courtes, sans « ! »).
export const MESSAGES_DONNEES = {
  emailVide: "Indiquez l'adresse email du demandeur.",
  emailInvalide: "Cette adresse email ne semble pas valide.",
  aucune: "Aucune demande avec cet email.",
  relancer: "L'effacement a peut-être eu lieu : relancez la recherche pour vérifier.",
} as const;

/** Même schéma que les autres emails : espaces retirés et minuscules (AD-31). */
export const schemaEmailDemandeur = z
  .string({ error: MESSAGES_DONNEES.emailVide })
  .trim()
  .toLowerCase()
  .min(1, MESSAGES_DONNEES.emailVide)
  .refine(
    (valeur) =>
      valeur === "" || (valeur.length <= LONGUEUR_MAX_EMAIL && z.regexes.email.test(valeur)),
    MESSAGES_DONNEES.emailInvalide,
  );

export type VerificationEmailDemandeur =
  | { ok: true; email: string }
  | { ok: false; erreur: string };

/** Valide l'email saisi ; en cas d'erreur, le message à afficher sous le champ. */
export function verifierEmailDemandeur(saisie: unknown): VerificationEmailDemandeur {
  const resultat = schemaEmailDemandeur.safeParse(saisie);
  if (resultat.success) return { ok: true, email: resultat.data };
  return { ok: false, erreur: resultat.error.issues[0]?.message ?? MESSAGES_DONNEES.emailVide };
}

/**
 * Identifiants des demandes à effacer : au moins un, tous des UUID. Aucun
 * plafond (la base n'en a pas) : tout ce que la recherche montre peut être
 * effacé.
 */
export const schemaIdsDemandes = z.array(z.uuid()).min(1);

// Textes au singulier ou au pluriel --------------------------------------------

/** « Effacer ces 3 demandes » ; « Effacer cette demande » pour 1. */
export function texteBoutonEffacer(nombre: number): string {
  return nombre === 1 ? "Effacer cette demande" : `Effacer ces ${formaterNombre(nombre)} demandes`;
}

/** Texte de la fenêtre de confirmation. */
export function texteConfirmationEffacement(nombre: number, email: string): string {
  return nombre === 1
    ? `1 demande de ${email} va être effacée définitivement, avec son historique et ses notes. Cette action ne peut pas être annulée.`
    : `${formaterNombre(nombre)} demandes de ${email} vont être effacées définitivement, avec leur historique et leurs notes. Cette action ne peut pas être annulée.`;
}

/** Toast après l'effacement : « 3 demandes effacées. ». */
export function texteDemandesEffacees(nombre: number): string {
  return nombre === 1 ? "1 demande effacée." : `${formaterNombre(nombre)} demandes effacées.`;
}

// Réponse de `chercher_demandes_demandeur()` -----------------------------------

export type DemandeDemandeur = {
  id: string;
  reference: string;
  creeLe: string;
  objet: string;
  statut: Statut;
};

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

/**
 * Valide la réponse de `chercher_demandes_demandeur()` ; null si une ligne
 * n'a pas la forme attendue (rien n'est alors affiché ni effaçable : une
 * liste incomplète ferait croire que tout a été trouvé).
 */
export function lireReponseDemandesDemandeur(valeur: unknown): DemandeDemandeur[] | null {
  if (!Array.isArray(valeur)) return null;
  const demandes: DemandeDemandeur[] = [];
  for (const element of valeur) {
    if (!estObjet(element)) return null;
    const { id, reference, cree_le, objet, statut } = element;
    if (
      typeof id !== "string" ||
      !z.uuid().safeParse(id).success ||
      typeof reference !== "string" ||
      typeof cree_le !== "string" ||
      Number.isNaN(new Date(cree_le).getTime()) ||
      typeof objet !== "string" ||
      typeof statut !== "string" ||
      !(STATUTS as readonly string[]).includes(statut)
    ) {
      return null;
    }
    demandes.push({ id, reference, creeLe: cree_le, objet, statut: statut as Statut });
  }
  return demandes;
}
