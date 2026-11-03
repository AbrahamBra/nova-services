import { z } from "zod";

// Schéma unique du formulaire « Connexion » (AD-8) : utilisé à l'écran
// (components/formulaire-connexion.tsx) et dans l'action serveur `connexion`
// (lib/actions/comptes.ts).

export const CHAMPS_CONNEXION = ["email", "mot_de_passe"] as const;
export type ChampConnexion = (typeof CHAMPS_CONNEXION)[number];
export type ErreursConnexion = Partial<Record<ChampConnexion, string>>;

// Textes : EXPERIENCE.md §3 (vouvoiement, phrases courtes, sans « ! »).
export const MESSAGES_CONNEXION = {
  emailVide: "Indiquez votre adresse email.",
  emailInvalide: "Cette adresse email ne semble pas valide.",
  motDePasseVide: "Indiquez votre mot de passe.",
} as const;

const LONGUEUR_MAX_EMAIL = 254;

export const schemaConnexion = z.object({
  // Espaces retirés et minuscules (AD-31).
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, MESSAGES_CONNEXION.emailVide)
    .refine(
      (valeur) =>
        valeur === "" || (valeur.length <= LONGUEUR_MAX_EMAIL && z.regexes.email.test(valeur)),
      MESSAGES_CONNEXION.emailInvalide,
    ),
  // Jamais retouché : un espace peut faire partie du mot de passe.
  mot_de_passe: z.string().min(1, MESSAGES_CONNEXION.motDePasseVide),
});

export type SaisieConnexion = z.input<typeof schemaConnexion>;
export type DonneesConnexion = z.output<typeof schemaConnexion>;

export function lireSaisieConnexion(formulaire: FormData): SaisieConnexion {
  const texte = (nom: string) => {
    const valeur = formulaire.get(nom);
    return typeof valeur === "string" ? valeur : "";
  };
  return { email: texte("email"), mot_de_passe: texte("mot_de_passe") };
}

export type VerificationConnexion =
  | { ok: true; donnees: DonneesConnexion }
  | { ok: false; erreurs: ErreursConnexion };

export function verifierConnexion(saisie: unknown): VerificationConnexion {
  const resultat = schemaConnexion.safeParse(saisie);
  if (resultat.success) return { ok: true, donnees: resultat.data };
  const erreurs: ErreursConnexion = {};
  for (const probleme of resultat.error.issues) {
    const champ = probleme.path[0];
    if (
      typeof champ === "string" &&
      (CHAMPS_CONNEXION as readonly string[]).includes(champ) &&
      !erreurs[champ as ChampConnexion]
    ) {
      erreurs[champ as ChampConnexion] = probleme.message;
    }
  }
  return { ok: false, erreurs };
}

export function premierChampConnexionEnErreur(erreurs: ErreursConnexion): ChampConnexion | null {
  return CHAMPS_CONNEXION.find((champ) => erreurs[champ]) ?? null;
}

// Adresse de retour après connexion (AD-28) : seulement une adresse interne
// qui commence par `/equipe` ; sinon l'accueil de l'espace équipe. Jamais
// d'adresse externe (`https://…`, `//…`), ni de barre oblique inverse ou
// d'espace, que certains navigateurs réinterprètent.
export const ACCUEIL_EQUIPE = "/equipe";
const RETOUR_AUTORISE = /^\/equipe(?:[/?#][^\s\\]*)?$/;

const BASE_INTERNE = "http://interne.invalid";

export function adresseDeRetour(valeur: unknown): string {
  if (typeof valeur !== "string" || valeur.length > 2000) return ACCUEIL_EQUIPE;
  if (!RETOUR_AUTORISE.test(valeur)) return ACCUEIL_EQUIPE;
  // Segments « . » et « .. » résolus (`/equipe/../connexion` → `/connexion`) :
  // seule l'adresse résolue compte.
  let url: URL;
  try {
    url = new URL(valeur, BASE_INTERNE);
  } catch {
    return ACCUEIL_EQUIPE;
  }
  if (url.origin !== BASE_INTERNE) return ACCUEIL_EQUIPE;
  const chemin = url.pathname;
  if (chemin !== "/equipe" && !chemin.startsWith("/equipe/")) return ACCUEIL_EQUIPE;
  return chemin + url.search;
}

/** État renvoyé par l'action `connexion` au formulaire (useActionState). */
export type EtatConnexion = {
  erreurs: ErreursConnexion;
  /** Refus (« Email ou mot de passe incorrect. ») ou erreur serveur, en bandeau. */
  erreurGenerale: { type: "refus" | "serveur"; message: string } | null;
  /** Numéro de la réponse : chaque réponse en erreur replace le focus. */
  tentative: number;
};

export const ETAT_CONNEXION_INITIAL: EtatConnexion = {
  erreurs: {},
  erreurGenerale: null,
  tentative: 0,
};
