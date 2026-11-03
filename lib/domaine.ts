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
