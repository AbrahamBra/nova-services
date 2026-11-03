import "server-only";
import { messageErreur } from "@/lib/erreurs";
import { appeler, type Resultat } from "@/lib/server/appeler";
import { creerClientService } from "@/lib/server/supabase-service";

// Informations affichées sur le formulaire public (story 1.2) : catégories
// actives, nom affiché, email de contact, durée de conservation. Lues avec la
// clé secrète via la fonction SQL `infos_publiques()` (AD-15) ; le navigateur
// ne parle jamais à Supabase (AD-1).

export type Categorie = { id: string; nom: string };

export type InfosPubliques = {
  nomAffiche: string;
  emailContact: string;
  dureeConservationMois: number;
  categories: Categorie[];
};

type ReponseSql = {
  nom_affiche: string;
  email_contact: string;
  duree_conservation_mois: number;
  categories: Categorie[];
};

function estReponseValide(valeur: unknown): valeur is ReponseSql {
  if (typeof valeur !== "object" || valeur === null) return false;
  const v = valeur as Record<string, unknown>;
  return (
    typeof v.nom_affiche === "string" &&
    typeof v.email_contact === "string" &&
    typeof v.duree_conservation_mois === "number" &&
    Number.isInteger(v.duree_conservation_mois) &&
    v.duree_conservation_mois >= 6 &&
    v.duree_conservation_mois <= 60 &&
    Array.isArray(v.categories) &&
    v.categories.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Categorie).id === "string" &&
        typeof (c as Categorie).nom === "string",
    )
  );
}

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

export async function lireInfosPubliques(): Promise<Resultat<InfosPubliques>> {
  let client;
  try {
    client = creerClientService();
  } catch {
    console.error("[infos-publiques] client service indisponible");
    return ECHEC;
  }

  const resultat = await appeler<unknown>(client, "infos_publiques");
  if (!resultat.ok) return resultat;

  // Ligne `parametres` absente (réponse nulle) ou forme inattendue.
  if (!estReponseValide(resultat.donnees)) {
    console.error("[infos-publiques] réponse inattendue de infos_publiques");
    return ECHEC;
  }

  const d = resultat.donnees;
  return {
    ok: true,
    donnees: {
      nomAffiche: d.nom_affiche,
      emailContact: d.email_contact,
      dureeConservationMois: d.duree_conservation_mois,
      categories: d.categories.map(({ id, nom }) => ({ id, nom })),
    },
  };
}
