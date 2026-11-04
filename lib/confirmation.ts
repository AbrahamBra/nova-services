import "server-only";
import { ETATS_EMAIL, type EtatEmail } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { appeler, type Resultat } from "@/lib/server/appeler";
import { creerClientService } from "@/lib/server/supabase-service";

// Lecture de la page de confirmation `/confirmation/[jeton]` (AD-16) :
// référence et contact de Nova, jamais de donnée du demandeur. Valable 24 h.
// `null` : jeton inconnu, mal formé ou expiré (« Cette page n'est plus
// disponible. »).
// Story 1.7 : l'état de l'email de confirmation décide de la phrase « Un
// email de confirmation vous a été envoyé. » (affichée seulement si `envoye`).

export type Confirmation = {
  reference: string;
  nomAffiche: string;
  emailContact: string;
  etatEmail: EtatEmail;
};

const ECHEC = {
  ok: false,
  code: "ERREUR_INATTENDUE",
  message: messageErreur("ERREUR_INATTENDUE"),
} as const;

const FORMAT_JETON = /^[0-9a-f]{64}$/;

function estReponseValide(
  valeur: unknown,
): valeur is {
  reference: string;
  nom_affiche: string;
  email_contact: string;
  etat_email?: unknown;
} {
  if (typeof valeur !== "object" || valeur === null) return false;
  const v = valeur as Record<string, unknown>;
  return (
    typeof v.reference === "string" &&
    typeof v.nom_affiche === "string" &&
    typeof v.email_contact === "string"
  );
}

/** État inconnu ou absent : traité comme `en_attente` (la phrase ne s'affiche pas). */
function lireEtatEmail(valeur: unknown): EtatEmail {
  return (ETATS_EMAIL as readonly unknown[]).includes(valeur) ? (valeur as EtatEmail) : "en_attente";
}

export async function lireConfirmation(jeton: string): Promise<Resultat<Confirmation | null>> {
  // Jeton mal formé : inutile d'interroger la base.
  if (!FORMAT_JETON.test(jeton)) return { ok: true, donnees: null };

  let client;
  try {
    client = creerClientService();
  } catch {
    console.error("[confirmation] client service indisponible");
    return ECHEC;
  }

  const resultat = await appeler<unknown>(client, "lire_confirmation", { p_jeton: jeton });
  if (!resultat.ok) return resultat;
  if (resultat.donnees === null) return { ok: true, donnees: null };

  if (!estReponseValide(resultat.donnees)) {
    console.error("[confirmation] réponse inattendue de lire_confirmation");
    return ECHEC;
  }

  const d = resultat.donnees;
  return {
    ok: true,
    donnees: {
      reference: d.reference,
      nomAffiche: d.nom_affiche,
      emailContact: d.email_contact,
      etatEmail: lireEtatEmail(d.etat_email),
    },
  };
}
