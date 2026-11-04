// Codes fermés de l'application (AD-18, AD-19).
// Copie unique des contraintes CHECK de la base, avec les libellés affichés.
// Zod, les filtres et les adresses de page utilisent ce fichier : ne jamais
// réécrire ces valeurs ailleurs.

export const STATUTS = ["nouvelle", "en_cours", "traitee"] as const;
export type Statut = (typeof STATUTS)[number];
export const LIBELLES_STATUT: Record<Statut, string> = {
  nouvelle: "Nouvelle",
  en_cours: "En cours",
  traitee: "Traitée",
};

export const PRIORITES = ["basse", "normale", "haute"] as const;
export type Priorite = (typeof PRIORITES)[number];
export const LIBELLES_PRIORITE: Record<Priorite, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
};

export const CANAUX = ["formulaire", "telephone", "email"] as const;
export type Canal = (typeof CANAUX)[number];
export const LIBELLES_CANAL: Record<Canal, string> = {
  formulaire: "Formulaire",
  telephone: "Téléphone",
  email: "Email",
};

export const ROLES = ["collaborateur", "administrateur"] as const;
export type Role = (typeof ROLES)[number];
export const LIBELLES_ROLE: Record<Role, string> = {
  collaborateur: "Collaborateur",
  administrateur: "Administrateur",
};

export const ETATS_MEMBRE = ["invite", "actif", "desactive"] as const;
export type EtatMembre = (typeof ETATS_MEMBRE)[number];
export const LIBELLES_ETAT_MEMBRE: Record<EtatMembre, string> = {
  invite: "Invité",
  actif: "Actif",
  desactive: "Désactivé",
};

export const ETATS_EMAIL = [
  "en_attente",
  "envoye",
  "echec",
  "non_envoye_demo",
  "sans_email",
] as const;
export type EtatEmail = (typeof ETATS_EMAIL)[number];
export const LIBELLES_ETAT_EMAIL: Record<EtatEmail, string> = {
  en_attente: "Email en attente",
  envoye: "Email envoyé",
  echec: "Échec de l'envoi de l'email",
  non_envoye_demo: "Email non envoyé (mode démonstration)",
  sans_email: "Sans email",
};

/**
 * États possibles après un envoi : seuls passages permis par
 * `noter_resultat_email`, depuis `en_attente` (story 1.7, AD-13).
 * `sans_email` est réservé à la saisie interne (story 2.6).
 */
export const ETATS_EMAIL_RESULTAT = [
  "envoye",
  "echec",
  "non_envoye_demo",
] as const satisfies readonly EtatEmail[];
export type EtatEmailResultat = (typeof ETATS_EMAIL_RESULTAT)[number];

export const TYPES_HISTORIQUE = [
  "creation",
  "prise_en_charge",
  "attribution",
  "liberation",
  "changement_statut",
  "classement_sans_suite",
  "changement_priorite",
  "changement_categorie",
  "note_ajoutee",
  "retour_nouvelle",
] as const;
export type TypeHistorique = (typeof TYPES_HISTORIQUE)[number];
export const LIBELLES_TYPE_HISTORIQUE: Record<TypeHistorique, string> = {
  creation: "Création",
  prise_en_charge: "Prise en charge",
  attribution: "Attribution",
  liberation: "Libération",
  changement_statut: "Changement de statut",
  classement_sans_suite: "Classement sans suite",
  changement_priorite: "Changement de priorité",
  changement_categorie: "Changement de catégorie",
  note_ajoutee: "Note ajoutée",
  retour_nouvelle: "Retour à Nouvelle",
};

export const TYPES_JOURNAL = [
  "compte",
  "parametre",
  "categorie",
  "donnees",
  "email",
  "connexion",
] as const;
export type TypeJournal = (typeof TYPES_JOURNAL)[number];
export const LIBELLES_TYPE_JOURNAL: Record<TypeJournal, string> = {
  compte: "Compte",
  parametre: "Paramètre",
  categorie: "Catégorie",
  donnees: "Données",
  email: "Email",
  connexion: "Connexion",
};
// Phrases de l'historique (AD-19, UX-DR11), affichées par le composant unique
// `components/nova/historique.tsx` : « <auteur> <phrase> ».
// Les valeurs stockées sont des codes ou des identifiants ; le composant les
// traduit en libellés (ou en noms) selon leur nature, puis les passe ici.

/** Auteur d'une ligne écrite par le demandeur (dépôt par le formulaire). */
export const AUTEUR_DEMANDEUR = "Demandeur (formulaire)";

/** Auteur membre dont le nom n'est pas lisible (compte supprimé, par exemple). */
export const AUTEUR_INCONNU = "Membre de l'équipe";

/** Nature des valeurs ancienne et nouvelle de chaque type, pour leur traduction. */
export type NatureValeurHistorique = "canal" | "membre" | "statut" | "priorite" | "categorie" | null;

export const NATURE_VALEUR_HISTORIQUE: Record<TypeHistorique, NatureValeurHistorique> = {
  creation: "canal",
  prise_en_charge: "membre",
  attribution: "membre",
  liberation: "membre",
  changement_statut: "statut",
  classement_sans_suite: "statut",
  changement_priorite: "priorite",
  changement_categorie: "categorie",
  note_ajoutee: null,
  retour_nouvelle: "statut",
};

/** Valeurs d'une ligne déjà traduites en libellés (ou `null` si absentes). */
export type ValeursHistorique = { ancienne: string | null; nouvelle: string | null };

function passage({ ancienne, nouvelle }: ValeursHistorique): string {
  if (ancienne && nouvelle) return ` : ${ancienne} → ${nouvelle}`;
  if (nouvelle) return ` : ${nouvelle}`;
  return "";
}

export const PHRASES_HISTORIQUE: Record<
  TypeHistorique,
  (valeurs: ValeursHistorique, auteurEstDemandeur: boolean) => string
> = {
  creation: ({ nouvelle }, auteurEstDemandeur) => {
    if (auteurEstDemandeur) return "a créé la demande";
    // Saisie interne ; canal absent ou inconnu : sans parenthèse.
    return nouvelle
      ? `a saisi la demande (${nouvelle.toLocaleLowerCase("fr-FR")})`
      : "a saisi la demande";
  },
  prise_en_charge: () => "a pris en charge la demande",
  attribution: ({ nouvelle }) =>
    nouvelle ? `a attribué la demande à ${nouvelle}` : "a attribué la demande",
  liberation: () => "a libéré la demande",
  changement_statut: (valeurs) => `a changé le statut${passage(valeurs)}`,
  classement_sans_suite: () => "a classé la demande sans suite",
  changement_priorite: (valeurs) => `a changé la priorité${passage(valeurs)}`,
  changement_categorie: (valeurs) => `a changé la catégorie${passage(valeurs)}`,
  note_ajoutee: () => "a ajouté une note interne",
  retour_nouvelle: () => "a remis la demande en Nouvelle",
};
