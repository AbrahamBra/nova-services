"use server";

import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { messageErreur } from "@/lib/erreurs";
import {
  adresseDeRetour,
  lireSaisieConnexion,
  verifierConnexion,
  type EtatConnexion,
} from "@/lib/schemas/connexion";
import { profilDuClient } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Actions serveur sur les comptes (AD-1, AD-7). Story 1.4 : connexion et
// déconnexion. Aucun client Supabase dans le navigateur : la session est
// posée en cookies par le client serveur.
// À venir : blocage après 5 échecs et limite de 8 h (story 1.9).

function refus(etat: EtatConnexion): EtatConnexion {
  return {
    erreurs: {},
    erreurGenerale: { type: "refus", message: messageErreur("CONNEXION_REFUSEE") },
    tentative: etat.tentative + 1,
  };
}

function erreurServeur(etat: EtatConnexion): EtatConnexion {
  return {
    erreurs: {},
    erreurGenerale: { type: "serveur", message: messageErreur("ERREUR_INATTENDUE") },
    tentative: etat.tentative + 1,
  };
}

// Réponses de Supabase Auth qui veulent dire « ces identifiants ne donnent
// pas accès » : elles reçoivent toutes le même message, qui ne révèle jamais
// si l'email existe.
const CODES_REFUS = new Set(["invalid_credentials", "email_not_confirmed", "user_banned"]);

/**
 * Ferme la session de cet appareil. Si Supabase Auth ne répond pas, les
 * cookies de session sont tout de même effacés.
 */
async function fermerSession(client: Awaited<ReturnType<typeof creerClientServeur>>) {
  let echec = false;
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    echec = Boolean(error);
  } catch {
    echec = true;
  }
  if (echec) {
    console.error("[comptes] échec de signOut : cookies de session effacés");
    await effacerCookiesSession();
  }
}

async function effacerCookiesSession() {
  const magasin = await cookies();
  for (const { name } of magasin.getAll()) {
    if (name.startsWith("sb-")) magasin.delete(name);
  }
}

/**
 * Connexion par email et mot de passe : Zod → `signInWithPassword` (clé
 * publiable, cookies) → `mon_profil()`. Un compte qui n'est pas un membre
 * actif est déconnecté aussitôt, avec le même message qu'un mauvais mot de
 * passe. Ensuite : l'adresse demandée si elle commence par `/equipe`.
 */
export async function connexion(etat: EtatConnexion, formulaire: FormData): Promise<EtatConnexion> {
  const verification = verifierConnexion(lireSaisieConnexion(formulaire));
  if (!verification.ok) {
    return { erreurs: verification.erreurs, erreurGenerale: null, tentative: etat.tentative + 1 };
  }
  const { email, mot_de_passe } = verification.donnees;
  const retour = adresseDeRetour(formulaire.get("retour"));

  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[connexion] client serveur indisponible");
    return erreurServeur(etat);
  }

  try {
    const { error } = await client.auth.signInWithPassword({ email, password: mot_de_passe });
    if (error) {
      // Refus sans code (anciennes réponses d'Auth) : statut 400.
      if ((error.code && CODES_REFUS.has(error.code)) || (!error.code && error.status === 400)) {
        return refus(etat);
      }
      // Trace minimale : jamais l'email ni le mot de passe (AD-14).
      console.error(
        `[connexion] erreur Auth : code=${error.code ?? "inconnu"} statut=${error.status ?? "aucun"}`,
      );
      return erreurServeur(etat);
    }
  } catch {
    console.error("[connexion] exception pendant signInWithPassword");
    return erreurServeur(etat);
  }

  // Le rôle et l'état viennent de `membres`, jamais des métadonnées Auth (AD-3).
  const profil = await profilDuClient(client);
  if (!profil.ok || profil.donnees === null) {
    // Compte Auth sans membre actif (invité, désactivé, inconnu) ou erreur :
    // la session tout juste ouverte est fermée.
    await fermerSession(client);
    return profil.ok ? refus(etat) : erreurServeur(etat);
  }

  redirect(retour, RedirectType.replace);
}

/** Déconnexion : ferme la session de cet appareil puis revient à la connexion. */
export async function deconnexion(): Promise<void> {
  try {
    await fermerSession(await creerClientServeur());
  } catch {
    console.error("[deconnexion] client serveur indisponible : cookies de session effacés");
    await effacerCookiesSession();
  }
  redirect("/connexion", RedirectType.replace);
}
