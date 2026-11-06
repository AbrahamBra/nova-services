import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compterDemandesAvec,
  lireDemandesAvec,
  type LigneDemande,
} from "@/lib/demandes";
import { messageErreur } from "@/lib/erreurs";
import { RESPONSABLE_AUCUN, RESPONSABLE_MOI, adresseListe, type Filtres } from "@/lib/filtres";
import type { Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Tableau de bord de l'espace équipe (story 2.8, EXPERIENCE.md §9.3, FR-19) :
// cinq chiffres, chacun le total de la liste ouverte avec les MÊMES filtres
// (AD-25 : comptages de la vue `demandes_liste` à travers lib/filtres.ts,
// rien d'autre n'est calculé ici), et « Mes demandes en cours ».
// Le compteur du menu réutilise la définition de la carte « À prendre en
// charge ». Lus au chargement de la page, jamais en temps réel.

export const CHEMIN_LISTE = "/equipe/demandes";


export type CleCarte = "a_prendre" | "haute_non_traitees" | "nouvelle" | "en_cours" | "traitee";

export type DefinitionCarte = {
  cle: CleCarte;
  libelle: string;
  filtres: Filtres;
  /** Carte mise en avant (« À prendre en charge »). */
  miseEnAvant: boolean;
};

/** Les cinq cartes, dans l'ordre d'affichage. */
export const CARTES: readonly DefinitionCarte[] = [
  {
    cle: "a_prendre",
    libelle: "À prendre en charge",
    filtres: { statut: "nouvelle", responsable: RESPONSABLE_AUCUN },
    miseEnAvant: true,
  },
  {
    cle: "haute_non_traitees",
    libelle: "Priorité Haute non traitées",
    filtres: { statut: "non_traitees", priorite: "haute" },
    miseEnAvant: false,
  },
  { cle: "nouvelle", libelle: "Nouvelle", filtres: { statut: "nouvelle" }, miseEnAvant: false },
  { cle: "en_cours", libelle: "En cours", filtres: { statut: "en_cours" }, miseEnAvant: false },
  { cle: "traitee", libelle: "Traitée", filtres: { statut: "traitee" }, miseEnAvant: false },
];

/** Filtres du compteur du menu : ceux de la carte « À prendre en charge ». */
export const FILTRES_A_PRENDRE_EN_CHARGE: Filtres = CARTES[0].filtres;

/** « Mes demandes en cours » : les 5 dernières, tri par défaut de la liste. */
export const FILTRES_MES_DEMANDES_EN_COURS: Filtres = {
  statut: "en_cours",
  responsable: RESPONSABLE_MOI,
};
export const NOMBRE_MES_DEMANDES = 5;

/** Adresse de la liste filtrée ouverte par une carte (ou « Tout voir »). */
export function adresseCarte(filtres: Filtres): string {
  return adresseListe(CHEMIN_LISTE, filtres, 1);
}

export type Carte = DefinitionCarte & { nombre: number; adresse: string };

export type TableauDeBord = {
  cartes: Carte[];
  mesDemandes: LigneDemande[];
  adresseMesDemandes: string;
  /** Aucune demande du tout (Nouvelle + En cours + Traitée = 0). */
  vide: boolean;
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

/** Lit les cinq chiffres et « Mes demandes en cours », en parallèle. */
export async function lireTableauDeBordAvec(
  client: SupabaseClient,
): Promise<Resultat<TableauDeBord>> {
  const [comptages, mesDemandes] = await Promise.all([
    Promise.all(CARTES.map((carte) => compterDemandesAvec(client, carte.filtres))),
    lireDemandesAvec(client, 1, FILTRES_MES_DEMANDES_EN_COURS, NOMBRE_MES_DEMANDES),
  ]);

  const cartes: Carte[] = [];
  for (const [i, carte] of CARTES.entries()) {
    const comptage = comptages[i];
    if (!comptage.ok) return ECHEC;
    cartes.push({ ...carte, nombre: comptage.donnees, adresse: adresseCarte(carte.filtres) });
  }
  if (!mesDemandes.ok) return ECHEC;

  const nombre = (cle: CleCarte) => cartes.find((carte) => carte.cle === cle)?.nombre ?? 0;
  const vide = nombre("nouvelle") + nombre("en_cours") + nombre("traitee") === 0;

  return {
    ok: true,
    donnees: {
      cartes,
      mesDemandes: mesDemandes.donnees.lignes.slice(0, NOMBRE_MES_DEMANDES),
      adresseMesDemandes: adresseCarte(FILTRES_MES_DEMANDES_EN_COURS),
      vide,
    },
  };
}

/** Tableau de bord de la personne connectée. */
export async function lireTableauDeBord(): Promise<Resultat<TableauDeBord>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[tableau-de-bord] client serveur indisponible");
    return ECHEC;
  }
  return lireTableauDeBordAvec(client);
}

/**
 * Compteur du menu : nombre de demandes « À prendre en charge » avec ce
 * client, ou `null` en cas d'erreur (le compteur est alors masqué).
 */
export async function lireCompteurMenuAvec(client: SupabaseClient): Promise<number | null> {
  const resultat = await compterDemandesAvec(client, FILTRES_A_PRENDRE_EN_CHARGE);
  return resultat.ok ? resultat.donnees : null;
}

/** Compteur du menu pour la personne connectée, ou `null` en cas d'erreur. */
export async function lireCompteurMenu(): Promise<number | null> {
  try {
    return await lireCompteurMenuAvec(await creerClientServeur());
  } catch {
    console.error("[tableau-de-bord] compteur du menu illisible");
    return null;
  }
}
