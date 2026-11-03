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
} as const;

export type CodeErreur = keyof typeof MESSAGES_ERREUR;

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
