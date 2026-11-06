import "server-only";
import { ETATS_MEMBRE, ROLES, type EtatMembre, type Role } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { appeler, type ClientRpc, type Resultat } from "@/lib/server/appeler";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Comptes de l'équipe (story 4.1, page Comptes) : lus avec la session de
// l'administrateur par `lister_comptes()` (la base refuse toute autre
// personne : DROIT_INSUFFISANT).

export type Compte = {
  id: string;
  nom: string;
  email: string;
  role: Role;
  etat: EtatMembre;
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

const ORDRE_NOMS = new Intl.Collator("fr-FR", { sensitivity: "base", numeric: true });

/** Valide la réponse de `lister_comptes()` ; null si elle n'a pas la forme attendue. */
export function lireReponseComptes(valeur: unknown): Compte[] | null {
  if (!Array.isArray(valeur)) return null;
  const comptes: Compte[] = [];
  for (const element of valeur) {
    if (typeof element !== "object" || element === null) return null;
    const v = element as Record<string, unknown>;
    if (
      typeof v.id !== "string" ||
      typeof v.nom !== "string" ||
      typeof v.email !== "string" ||
      typeof v.role !== "string" ||
      !(ROLES as readonly string[]).includes(v.role) ||
      typeof v.etat !== "string" ||
      !(ETATS_MEMBRE as readonly string[]).includes(v.etat)
    ) {
      return null;
    }
    comptes.push({
      id: v.id,
      nom: v.nom,
      email: v.email,
      role: v.role as Role,
      etat: v.etat as EtatMembre,
    });
  }
  // Tri par nom, à la française (accents et majuscules ignorés).
  return comptes.sort((a, b) => ORDRE_NOMS.compare(a.nom, b.nom) || a.id.localeCompare(b.id));
}

/** Appelle `lister_comptes()` avec un client porteur de la session. */
export async function lireComptesAvec(client: ClientRpc): Promise<Resultat<Compte[]>> {
  const resultat = await appeler<unknown>(client, "lister_comptes");
  if (!resultat.ok) return resultat;
  const comptes = lireReponseComptes(resultat.donnees);
  if (comptes === null) {
    console.error("[comptes] réponse inattendue de lister_comptes");
    return ECHEC;
  }
  return { ok: true, donnees: comptes };
}

/** Comptes de l'équipe, lus avec la session de la personne connectée. */
export async function lireComptes(): Promise<Resultat<Compte[]>> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[comptes] client serveur indisponible");
    return ECHEC;
  }
  return lireComptesAvec(client);
}
