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
  // Story 2.1 : passage de statut `nouvelle` → `en_cours` (une seule ligne).
  prise_en_charge: "statut",
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

/**
 * Début de phrase placé AVANT l'auteur, pour les types dont la phrase ne
 * commence pas par l'auteur : « <début><auteur> <phrase> ».
 */
export const AVANT_AUTEUR_HISTORIQUE: Partial<Record<TypeHistorique, string>> = {
  prise_en_charge: "Prise en charge par ",
  // Story 2.3 : « Classée sans suite par Karim Benali : Nouvelle → Traitée ».
  classement_sans_suite: "Classée sans suite par ",
};

/**
 * Début de phrase AVANT l'auteur pour une création par un membre (saisie
 * interne, story 2.6) : « Saisie par Nadia Morel (téléphone) ». La création
 * par le formulaire public garde « Demandeur (formulaire) a créé la demande ».
 */
export const AVANT_AUTEUR_SAISIE = "Saisie par ";

/** Début de phrase placé avant l'auteur d'une ligne, ou "" (voir ci-dessus). */
export function avantAuteurHistorique(type: TypeHistorique, auteurEstDemandeur: boolean): string {
  if (type === "creation") return auteurEstDemandeur ? "" : AVANT_AUTEUR_SAISIE;
  return AVANT_AUTEUR_HISTORIQUE[type] ?? "";
}

/**
 * Types dont le passage (« : Nouvelle → En cours ») est omis quand les
 * valeurs stockées ne sont pas des codes connus : anciennes lignes
 * `prise_en_charge` (identifiant du membre dans `nouvelle_valeur`), affichées
 * « Prise en charge par [nom] » ; lignes `classement_sans_suite` sans
 * valeurs, affichées « Classée sans suite par [nom] ».
 */
export const TYPES_PASSAGE_OMIS_SI_INCONNU: readonly TypeHistorique[] = [
  "prise_en_charge",
  "classement_sans_suite",
];

export const PHRASES_HISTORIQUE: Record<
  TypeHistorique,
  (valeurs: ValeursHistorique, auteurEstDemandeur: boolean) => string
> = {
  creation: ({ nouvelle }, auteurEstDemandeur) => {
    if (auteurEstDemandeur) return "a créé la demande";
    // Saisie interne, auteur au milieu de la phrase (AVANT_AUTEUR_SAISIE) :
    // « Saisie par Nadia Morel (téléphone) » ; canal absent ou inconnu :
    // sans parenthèse.
    return nouvelle ? `(${nouvelle.toLocaleLowerCase("fr-FR")})` : "";
  },
  // Auteur au milieu de la phrase (voir AVANT_AUTEUR_HISTORIQUE) :
  // « Prise en charge par Karim Benali : Nouvelle → En cours ».
  prise_en_charge: (valeurs) => passage(valeurs).trimStart(),
  attribution: ({ nouvelle }) =>
    nouvelle ? `a attribué la demande à ${nouvelle}` : "a attribué la demande",
  liberation: () => "a libéré la demande",
  changement_statut: (valeurs) => `a changé le statut${passage(valeurs)}`,
  // Auteur au milieu de la phrase (voir AVANT_AUTEUR_HISTORIQUE).
  classement_sans_suite: (valeurs) => passage(valeurs).trimStart(),
  changement_priorite: (valeurs) => `a changé la priorité${passage(valeurs)}`,
  changement_categorie: (valeurs) => `a changé la catégorie${passage(valeurs)}`,
  note_ajoutee: () => "a ajouté une note interne",
  retour_nouvelle: () => "a remis la demande en Nouvelle",
};

/** Aucune demande du tout : tableau de bord (story 2.8) et liste sans filtre. */
export const MESSAGE_AUCUNE_DEMANDE =
  "Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients.";
