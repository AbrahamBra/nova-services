// Codes d'erreur prévus et messages affichés (AD-20).
// Une fonction SQL lève `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>'`.
// Chaque code levé par la base doit figurer ici avec son message (test de
// concordance : tests/story-1-3/codes-erreur.test.ts). Les stories suivantes
// complètent cette liste.

export const MESSAGES_ERREUR = {
  ERREUR_INATTENDUE:
    "Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant.",
  // Story 1.3 — dépôt public (deposer_demande).
  DONNEES_INVALIDES: "Certaines informations ne sont pas valides. Vérifiez le formulaire.",
  CATEGORIE_INVALIDE: "Choisissez une catégorie dans la liste.",
  CONSENTEMENT_REQUIS: "Cochez cette case pour envoyer votre demande.",
  // Story 1.4 — connexion (action `connexion`, propre à l'application) : même
  // message pour un mauvais mot de passe, un email inconnu et un compte
  // invité ou désactivé. Il ne révèle jamais si l'email existe.
  CONNEXION_REFUSEE: "Email ou mot de passe incorrect.",
  // Story 1.4 — création d'un membre (creer_membre).
  MEMBRE_EXISTANT: "Ce compte est déjà membre de l'équipe.",
  EMAIL_DEJA_UTILISE: "Cette adresse email est déjà utilisée par un autre membre.",
  // Story 1.7 — résultat de l'email de confirmation (noter_resultat_email).
  // Jamais affichés au demandeur : un échec de notation ne change pas la
  // confirmation (AD-13).
  EMAIL_DEJA_NOTE: "Le résultat de l'email de confirmation est déjà noté.",
  DEMANDE_INTROUVABLE: "Demande introuvable. Elle a peut-être été effacée.",
  // Story 1.8 — limite d'envois du formulaire public (deposer_demande).
  TROP_D_ENVOIS: "Trop d'envois depuis votre connexion. Réessayez dans quelques minutes.",
  // Story 1.8 — champ piège rempli (action `deposer`, propre à
  // l'application) : message neutre, qui ne dit jamais pourquoi.
  ENVOI_IMPOSSIBLE: "Votre demande n'a pas pu être envoyée. Réessayez plus tard.",
} as const;

export type CodeErreur = keyof typeof MESSAGES_ERREUR;

/** Codes propres à l'application, jamais levés par une fonction SQL. */
export const CODES_APPLICATION: readonly CodeErreur[] = [
  "ERREUR_INATTENDUE",
  "CONNEXION_REFUSEE",
  "ENVOI_IMPOSSIBLE",
];

export const CODES_ERREUR = Object.keys(MESSAGES_ERREUR) as CodeErreur[];

export function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return (
    typeof valeur === "string" &&
    Object.prototype.hasOwnProperty.call(MESSAGES_ERREUR, valeur)
  );
}

export function messageErreur(code: CodeErreur): string {
  return MESSAGES_ERREUR[code];
}
