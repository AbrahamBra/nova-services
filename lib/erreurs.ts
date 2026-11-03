// Codes d'erreur prévus et messages affichés (AD-20).
// Une fonction SQL lève `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>'`.
// Chaque code levé par la base doit figurer ici avec son message (test de
// concordance ajouté avec les premières fonctions SQL). Les stories suivantes
// complètent cette liste.

export const MESSAGES_ERREUR = {
  ERREUR_INATTENDUE:
    "Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant.",
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
