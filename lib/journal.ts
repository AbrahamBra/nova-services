import "server-only";
import { LIBELLES_ROLE, ROLES, TYPES_JOURNAL, type Role, type TypeJournal } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { formaterDuree, formaterNombre } from "@/lib/format";
import { bornerPage, TAILLE_PAGE_JOURNAL } from "@/lib/filtres";
import { appeler, signaler, type ClientRpc, type Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Journal des événements (story 5.1, page Journal) : lu avec la session de
// l'administrateur par `lire_journal(p_type, p_page)` (la base refuse toute
// autre personne : DROIT_INSUFFISANT), puis traduit ici en phrases.
// Module UNIQUE de traduction (AD-19) : les détails stockés sont des codes et
// des identifiants ; chaque `details.evenement` a sa phrase, jamais de JSON
// brut à l'écran. Les stories 5.2 à 5.5 ajoutent leurs événements ici
// (phrase et clés attendues).

export type AuteurJournal = "membre" | "systeme";

export type LigneJournal = {
  id: number;
  creeLe: string;
  type: TypeJournal;
  auteurType: AuteurJournal;
  /** Nom actuel du membre auteur ; null pour le système ou un membre disparu. */
  auteurNom: string | null;
  details: Record<string, unknown>;
};

export type PageJournal = {
  lignes: LigneJournal[];
  /** Nombre de lignes du filtre, toutes pages confondues. */
  total: number;
  /** Page réellement lue (ramenée à la dernière si le numéro la dépassait). */
  page: number;
  taillePage: number;
};

/** Auteur d'une ligne écrite par l'application (échec d'email, blocage de connexion). */
export const AUTEUR_SYSTEME = "Système";
/** Auteur membre dont le nom n'est plus lisible. */
export const AUTEUR_MEMBRE_INCONNU = "Membre inconnu";

/**
 * Clés de `details` de chaque événement connu (liste fermée, AD-14) : codes,
 * identifiants et noms de MEMBRES seulement, jamais une donnée de demandeur.
 * Toutes présentes, sauf pour les événements de EVENEMENTS_CLES_FACULTATIVES
 * (clés PERMISES, seule `evenement` obligatoire). Vérifiée sur toute la base
 * par tests/story-5-1/base.test.ts (`clesJournalValides`).
 */
export const CLES_DETAILS_JOURNAL: Record<string, readonly string[]> = {
  echec_confirmation: ["evenement", "reference", "code"],
  connexion_bloquee: ["evenement", "bloque", "duree_minutes"],
  compte_cree: ["evenement", "membre_id", "nom", "role"],
  compte_modifie: ["evenement", "membre_id", "nom", "role", "ancien_nom", "ancien_role"],
  compte_desactive: ["evenement", "membre_id", "nom", "demandes_remises"],
  compte_reactive: ["evenement", "membre_id", "nom"],
  lien_mot_de_passe_genere: ["evenement", "membre_id", "nom"],
  invitation_renvoyee: ["evenement", "membre_id", "nom"],
  invitation_annulee: ["evenement", "membre_id", "nom"],
  // Story 5.2 : catégories (nom de la catégorie, jamais une donnée de demandeur).
  categorie_ajoutee: ["evenement", "categorie_id", "nom"],
  categorie_renommee: ["evenement", "categorie_id", "nom", "ancien_nom"],
  categorie_desactivee: ["evenement", "categorie_id", "nom"],
  categorie_reactivee: ["evenement", "categorie_id", "nom"],
  // Story 5.3 : seulement les champs changés, chacun avec son ancienne valeur
  // (paramètres de l'organisation, jamais une donnée de demandeur).
  parametres_modifies: [
    "evenement",
    "nom_affiche",
    "ancien_nom_affiche",
    "email_contact",
    "ancien_email_contact",
    "duree_conservation_mois",
    "ancienne_duree_conservation_mois",
  ],
  // Story 5.4 : le nombre de demandes effacées seulement (jamais l'email, le
  // nom ni les références de la personne).
  demandeur_efface: ["evenement", "nombre"],
};

/**
 * Événements dont les clés de CLES_DETAILS_JOURNAL sont permises, pas toutes
 * obligatoires : `evenement` toujours, puis chaque valeur changée avec son
 * ancienne valeur (story 5.3).
 */
export const EVENEMENTS_CLES_FACULTATIVES: ReadonlySet<string> = new Set(["parametres_modifies"]);

/** Paires nouvelle / ancienne valeur des événements à clés facultatives : les deux ou aucune. */
const PAIRES_CLES: Record<string, readonly (readonly [string, string])[]> = {
  parametres_modifies: [
    ["nom_affiche", "ancien_nom_affiche"],
    ["email_contact", "ancien_email_contact"],
    ["duree_conservation_mois", "ancienne_duree_conservation_mois"],
  ],
};

/**
 * Les clés d'une ligne sont-elles celles de son événement ? Exactement la
 * liste ; ou, pour un événement à clés facultatives, `evenement` plus au
 * moins une paire complète, aucune clé hors liste.
 */
export function clesJournalValides(evenement: string, cles: readonly string[]): boolean {
  if (!Object.hasOwn(CLES_DETAILS_JOURNAL, evenement)) return false;
  const attendues = CLES_DETAILS_JOURNAL[evenement];
  if (!EVENEMENTS_CLES_FACULTATIVES.has(evenement)) {
    return [...cles].sort().join("|") === [...attendues].sort().join("|");
  }
  if (!cles.includes("evenement") || cles.some((cle) => !attendues.includes(cle))) return false;
  const paires = PAIRES_CLES[evenement];
  if (paires === undefined) {
    throw new Error(
      `clesJournalValides : « ${evenement} » est dans EVENEMENTS_CLES_FACULTATIVES sans entrée dans PAIRES_CLES`,
    );
  }
  let completes = 0;
  for (const [nouvelle, ancienne] of paires) {
    const a = cles.includes(nouvelle);
    const b = cles.includes(ancienne);
    if (a !== b) return false;
    if (a) completes += 1;
  }
  return completes > 0;
}

/**
 * Type de ligne attendu pour chaque événement connu (mêmes clés que
 * CLES_DETAILS_JOURNAL), vérifié sur toute la base par
 * tests/story-5-1/base.test.ts.
 */
export const TYPE_EVENEMENT_JOURNAL: Record<string, TypeJournal> = {
  echec_confirmation: "email",
  connexion_bloquee: "connexion",
  compte_cree: "compte",
  compte_modifie: "compte",
  compte_desactive: "compte",
  compte_reactive: "compte",
  lien_mot_de_passe_genere: "compte",
  invitation_renvoyee: "compte",
  invitation_annulee: "compte",
  categorie_ajoutee: "categorie",
  categorie_renommee: "categorie",
  categorie_desactivee: "categorie",
  categorie_reactivee: "categorie",
  parametres_modifies: "parametre",
  demandeur_efface: "donnees",
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

// Phrases ----------------------------------------------------------------------

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur : null;
}

function libelleRole(valeur: unknown): string | null {
  return typeof valeur === "string" && (ROLES as readonly string[]).includes(valeur)
    ? LIBELLES_ROLE[valeur as Role]
    : null;
}

function entierPositif(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur > 0 ? valeur : null;
}

/** Nom du membre cité par la ligne (enregistré au moment de l'événement). */
function nomCite(details: Record<string, unknown>): string {
  return texte(details.nom) ?? AUTEUR_MEMBRE_INCONNU;
}

/** Nom de la catégorie citée par la ligne (enregistré au moment de l'événement). */
export const CATEGORIE_SANS_NOM = "(nom inconnu)";
function nomCategorie(valeur: unknown): string {
  return texte(valeur) ?? CATEGORIE_SANS_NOM;
}

/** « 3 ans » ; null si la valeur enregistrée n'est pas une durée. */
function duree(valeur: unknown): string | null {
  const mois = entierPositif(valeur);
  return mois === null ? null : formaterDuree(mois);
}

/**
 * « libellé « a » → « b » », seulement si les deux valeurs sont lisibles et
 * différentes. Valeurs entre guillemets : un nom contenant « ; » ou « → »
 * reste sans ambiguïté.
 */
function changement(libelle: string, ancien: string | null, nouveau: string | null): string | null {
  if (ancien === null || nouveau === null || ancien === nouveau) return null;
  return `${libelle} « ${ancien} » → « ${nouveau} »`;
}

const PRECISION_BLOCAGE: Record<string, string> = {
  email: "(même email)",
  ip: "(même adresse IP)",
  email_et_ip: "(même email et même adresse IP)",
};

export const PHRASES_JOURNAL: Record<string, (details: Record<string, unknown>) => string> = {
  compte_cree: (d) => {
    const role = libelleRole(d.role);
    return `Compte créé : ${nomCite(d)}${role ? ` (${role})` : ""}`;
  },
  compte_modifie: (d) => {
    const changements: string[] = [];
    const nom = texte(d.nom);
    const ancienNom = texte(d.ancien_nom);
    if (nom && ancienNom && nom !== ancienNom) changements.push(`nom : ${ancienNom} → ${nom}`);
    const role = libelleRole(d.role);
    const ancienRole = libelleRole(d.ancien_role);
    if (role && ancienRole && role !== ancienRole) changements.push(`rôle : ${ancienRole} → ${role}`);
    return [`Compte modifié : ${nomCite(d)}`, ...changements].join(", ");
  },
  compte_desactive: (d) => {
    const n = entierPositif(d.demandes_remises);
    const remises =
      n === null ? "" : n === 1 ? ", 1 demande remise en Nouvelle" : `, ${n} demandes remises en Nouvelle`;
    return `Compte désactivé : ${nomCite(d)}${remises}`;
  },
  compte_reactive: (d) => `Compte réactivé : ${nomCite(d)}`,
  lien_mot_de_passe_genere: (d) => `Lien de mot de passe généré pour ${nomCite(d)}`,
  invitation_renvoyee: (d) => `Invitation renvoyée à ${nomCite(d)}`,
  invitation_annulee: (d) => `Invitation annulée : ${nomCite(d)}`,
  // Story 5.2 : le nom enregistré au moment de l'événement.
  categorie_ajoutee: (d) => `Catégorie ajoutée : ${nomCategorie(d.nom)}`,
  categorie_renommee: (d) => {
    const ancien = texte(d.ancien_nom);
    return `Catégorie renommée : ${ancien ? `${ancien} → ` : ""}${nomCategorie(d.nom)}`;
  },
  categorie_desactivee: (d) => `Catégorie désactivée : ${nomCategorie(d.nom)}`,
  categorie_reactivee: (d) => `Catégorie réactivée : ${nomCategorie(d.nom)}`,
  // Story 5.3 : seulement les champs changés, dans l'ordre de la page.
  parametres_modifies: (d) => {
    const changements = [
      changement("nom affiché", texte(d.ancien_nom_affiche), texte(d.nom_affiche)),
      changement("email de contact", texte(d.ancien_email_contact), texte(d.email_contact)),
      changement(
        "durée de conservation",
        duree(d.ancienne_duree_conservation_mois),
        duree(d.duree_conservation_mois),
      ),
    ].filter((c): c is string => c !== null);
    return changements.length === 0
      ? "Paramètres modifiés"
      : `Paramètres modifiés : ${changements.join(" ; ")}`;
  },
  // Story 5.4 : « 3 demandes effacées (droit à l'effacement) ».
  demandeur_efface: (d) => {
    const n = entierPositif(d.nombre);
    if (n === null) return "Demandes effacées (droit à l'effacement)";
    return n === 1
      ? "1 demande effacée (droit à l'effacement)"
      : `${formaterNombre(n)} demandes effacées (droit à l'effacement)`;
  },
  connexion_bloquee: (d) => {
    // Durée affichée seulement si elle est enregistrée.
    const duree = entierPositif(d.duree_minutes);
    const precision = typeof d.bloque === "string" ? PRECISION_BLOCAGE[d.bloque] : undefined;
    return `Connexion bloquée ${duree === null ? "" : `${duree} minutes `}après 5 échecs${precision ? ` ${precision}` : ""}`;
  },
  echec_confirmation: (d) => {
    const reference = texte(d.reference) ?? "une demande";
    const code = texte(d.code);
    return `Email de confirmation non envoyé pour ${reference}${code ? ` (code : ${code})` : ""}`;
  },
};

/** Phrase d'une ligne du journal, fabriquée à partir de ses détails (jamais de JSON brut). */
export function descriptionJournal(details: Record<string, unknown>): string {
  const evenement = texte(details.evenement);
  const phrase = evenement !== null && Object.hasOwn(PHRASES_JOURNAL, evenement)
    ? PHRASES_JOURNAL[evenement]
    : undefined;
  if (phrase) return phrase(details);
  return `Événement « ${evenement ?? "inconnu"} »`;
}

/** « Système », le nom actuel du membre, ou « Membre inconnu ». */
export function auteurJournal(ligne: Pick<LigneJournal, "auteurType" | "auteurNom">): string {
  if (ligne.auteurType === "systeme") return AUTEUR_SYSTEME;
  return ligne.auteurNom ?? AUTEUR_MEMBRE_INCONNU;
}

// Lecture ----------------------------------------------------------------------

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

/** Premier champ invalide d'une ligne de `lire_journal()`, ou null si elle est valide. */
function champInvalide(v: Record<string, unknown>): string | null {
  if (typeof v.id !== "number" || !Number.isInteger(v.id)) return "id";
  if (typeof v.cree_le !== "string" || Number.isNaN(new Date(v.cree_le).getTime())) return "cree_le";
  if (typeof v.type !== "string" || !(TYPES_JOURNAL as readonly string[]).includes(v.type)) return "type";
  if (v.auteur_type !== "membre" && v.auteur_type !== "systeme") return "auteur_type";
  if (v.auteur_nom !== null && typeof v.auteur_nom !== "string") return "auteur_nom";
  if (!estObjet(v.details)) return "details";
  return null;
}

/**
 * Valide la réponse de `lire_journal()` ; null si sa forme générale n'est
 * pas celle attendue. Une ligne invalide est écartée (les autres restent
 * affichées) et signalée (console et Sentry : identifiant et champ seulement,
 * jamais le contenu).
 */
export function lireReponseJournal(
  valeur: unknown,
): { total: number; lignes: LigneJournal[] } | null {
  if (!estObjet(valeur)) return null;
  const { total, lignes } = valeur;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) return null;
  if (!Array.isArray(lignes)) return null;
  const resultat: LigneJournal[] = [];
  for (const element of lignes) {
    const v = estObjet(element) ? element : null;
    const champ = v === null ? "ligne" : champInvalide(v);
    if (v === null || champ !== null) {
      const id = v !== null && typeof v.id === "number" && Number.isInteger(v.id) ? v.id : "inconnu";
      signaler(`[journal] ligne écartée : id=${id} champ=${champ}`);
      continue;
    }
    resultat.push({
      id: v.id as number,
      creeLe: v.cree_le as string,
      type: v.type as TypeJournal,
      auteurType: v.auteur_type as AuteurJournal,
      auteurNom: v.auteur_nom as string | null,
      details: v.details as Record<string, unknown>,
    });
  }
  return { total, lignes: resultat };
}

/**
 * Appelle `lire_journal()` avec un client porteur de la session. Un numéro
 * de page au-delà de la dernière est ramené à la dernière (seconde lecture).
 */
export async function lireJournalAvec(
  client: ClientRpc,
  type: TypeJournal | undefined,
  pageDemandee: number,
): Promise<Resultat<PageJournal>> {
  const lire = async (page: number): Promise<Resultat<{ total: number; lignes: LigneJournal[] }>> => {
    const resultat = await appeler<unknown>(client, "lire_journal", {
      p_type: type ?? null,
      p_page: page,
    });
    if (!resultat.ok) return resultat;
    const lu = lireReponseJournal(resultat.donnees);
    if (lu === null) {
      console.error("[journal] réponse inattendue de lire_journal");
      return ECHEC;
    }
    return { ok: true, donnees: lu };
  };

  let page = Math.max(1, Math.trunc(pageDemandee));
  let resultat = await lire(page);
  if (!resultat.ok) return resultat;
  const bornee = bornerPage(page, resultat.donnees.total, TAILLE_PAGE_JOURNAL);
  if (bornee !== page) {
    page = bornee;
    resultat = await lire(page);
    if (!resultat.ok) return resultat;
  }
  return {
    ok: true,
    donnees: { ...resultat.donnees, page, taillePage: TAILLE_PAGE_JOURNAL },
  };
}

/** Une page du journal, lue avec la session de la personne connectée. */
export async function lireJournal(
  type: TypeJournal | undefined,
  page: number,
): Promise<Resultat<PageJournal>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[journal] client serveur indisponible");
    return ECHEC;
  }
  return lireJournalAvec(client, type, page);
}
