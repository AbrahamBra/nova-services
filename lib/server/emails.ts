import "server-only";
import { Resend } from "resend";
import type { EtatEmailResultat } from "@/lib/domaine";
import { formaterDateHeure } from "@/lib/format";

// Seul module d'envoi d'emails de l'application (AD-13), via Resend.
// Seul endroit où RESEND_API_KEY, EMAILS_AUTORISES et EMAIL_EXPEDITEUR sont
// lues (AD-9).
//
// Mode démonstration (budget 0 €, pas de domaine) : Resend n'écrit qu'à
// l'adresse du compte d'Abraham. Seules les adresses de EMAILS_AUTORISES
// reçoivent un email ; pour les autres (et pour tout le monde si la liste
// est vide), aucun appel à Resend, état `non_envoye_demo`.
// Passage en vraie production, sans changer le code : vérifier un domaine
// dans Resend, puis EMAIL_EXPEDITEUR=<adresse de ce domaine> et
// EMAILS_AUTORISES=* (toutes les adresses).
//
// Aucune fonction de ce module ne lève d'exception : un email non envoyé ne
// fait jamais échouer une action.

/** Adresse d'expédition de Resend sans domaine (défaut de EMAIL_EXPEDITEUR). */
export const ADRESSE_EXPEDITEUR = "onboarding@resend.dev";

/** Valeur de EMAILS_AUTORISES qui autorise toutes les adresses (production). */
export const TOUTES_ADRESSES = "*";

/** Au-delà, l'envoi est considéré comme un échec (`delai_depasse`). */
export const DELAI_ENVOI_MS = 5_000;

export type MessageEmail = {
  a: string;
  de: string;
  objet: string;
  texte: string;
  html: string;
  /** Clé d'idempotence Resend : deux envois avec la même clé = un seul email. */
  cleIdempotence?: string;
};

/** Code d'erreur court, en minuscules, sans donnée personnelle. */
export type ResultatExpedition = { ok: true } | { ok: false; code: string };

/** Ce qui envoie réellement un message : Resend, ou une simulation en test. */
export type Expediteur = (message: MessageEmail) => Promise<ResultatExpedition>;

const FORMAT_CODE = /^[a-z0-9_]{1,64}$/;

function codeSur(code: unknown): string {
  return typeof code === "string" && FORMAT_CODE.test(code) ? code : "inconnu";
}

// --- Liste autorisée -------------------------------------------------------

/** Adresses séparées par des virgules, comparées en minuscules. */
export function lireAdressesAutorisees(valeur: string | undefined): Set<string> {
  return new Set(
    (valeur ?? "")
      .split(",")
      .map((adresse) => adresse.trim().toLowerCase())
      .filter((adresse) => adresse.length > 0),
  );
}

/** « * » dans la liste : toutes les adresses (production avec un domaine vérifié). */
export function estAdresseAutorisee(adresse: string, autorisees: Set<string>): boolean {
  return autorisees.has(TOUTES_ADRESSES) || autorisees.has(adresse.trim().toLowerCase());
}

// --- Contenu de l'email de confirmation ------------------------------------

/** Échappe un texte pour l'insérer dans du HTML (contenu ou attribut). */
export function echapperHtml(texte: string): string {
  return texte
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Données de l'email de confirmation. Volontairement limitées : jamais la
 * description, le téléphone, la société ni le nom du demandeur.
 */
export type DonneesConfirmation = {
  reference: string;
  objet: string;
  /** Date d'enregistrement (affichée à l'heure de Paris). */
  creeLe: string | Date;
  nomAffiche: string;
  emailContact: string;
};

export type ContenuEmail = { objet: string; texte: string; html: string };

export function contenuConfirmation(d: DonneesConfirmation): ContenuEmail {
  const date = formaterDateHeure(d.creeLe);
  const objet = `Votre demande ${d.reference} a bien été enregistrée`;

  const texte = [
    "Bonjour,",
    "",
    "Votre demande a bien été enregistrée.",
    "",
    `Référence : ${d.reference}`,
    `Objet : ${d.objet}`,
    `Date : ${date}`,
    "",
    "Conservez cette référence pour tout échange avec notre équipe.",
    "",
    `Une question ? Contactez ${d.nomAffiche} : ${d.emailContact}`,
    "",
  ].join("\n");

  const e = {
    reference: echapperHtml(d.reference),
    objet: echapperHtml(d.objet),
    date: echapperHtml(date),
    nomAffiche: echapperHtml(d.nomAffiche),
    emailContact: echapperHtml(d.emailContact),
  };

  const html = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>${e.nomAffiche}</title></head>
<body style="margin:0;padding:24px;background:#F8FAFC;font-family:Inter,Arial,sans-serif;color:#0F172A;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;padding:24px;">
<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#1E3A8A;">${e.nomAffiche}</p>
<p style="margin:0 0 8px;">Bonjour,</p>
<p style="margin:0 0 16px;">Votre demande a bien été enregistrée.</p>
<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;">
<tr><td style="padding:4px 12px 4px 0;color:#64748B;">Référence</td><td style="padding:4px 0;font-family:monospace;font-weight:600;color:#1E3A8A;">${e.reference}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#64748B;">Objet</td><td style="padding:4px 0;">${e.objet}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#64748B;">Date</td><td style="padding:4px 0;">${e.date}</td></tr>
</table>
<p style="margin:0 0 16px;">Conservez cette référence pour tout échange avec notre équipe.</p>
<p style="margin:0;font-size:13px;color:#64748B;">Une question ? Contactez ${e.nomAffiche} : <a href="mailto:${e.emailContact}" style="color:#1E3A8A;">${e.emailContact}</a></p>
</div>
</body>
</html>
`;

  return { objet, texte, html };
}

// --- Expéditeur Resend -----------------------------------------------------

/**
 * Expéditeur réel. Clé absente : chaque envoi échoue (`cle_absente`), sans
 * appel réseau. Erreur de Resend, exception ou délai dépassé : échec avec un
 * code court (jamais le message, qui pourrait citer l'adresse).
 */
export function expediteurResend(
  cle: string | undefined = process.env.RESEND_API_KEY,
  delaiMs: number = DELAI_ENVOI_MS,
): Expediteur {
  if (!cle || cle.trim() === "") {
    return async () => ({ ok: false, code: "cle_absente" });
  }
  const resend = new Resend(cle.trim());

  return async (message) => {
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const delai = new Promise<ResultatExpedition>((resoudre) => {
      minuteur = setTimeout(() => resoudre({ ok: false, code: "delai_depasse" }), delaiMs);
    });

    const envoi = (async (): Promise<ResultatExpedition> => {
      try {
        const { error } = await resend.emails.send(
          {
            from: message.de,
            to: message.a,
            subject: message.objet,
            text: message.texte,
            html: message.html,
          },
          message.cleIdempotence ? { idempotencyKey: message.cleIdempotence } : undefined,
        );
        if (error) return { ok: false, code: codeSur(error.name) };
        return { ok: true };
      } catch {
        return { ok: false, code: "exception" };
      }
    })();

    try {
      return await Promise.race([envoi, delai]);
    } finally {
      clearTimeout(minuteur);
    }
  };
}

// --- Envoi de l'email de confirmation --------------------------------------

export type ResultatEnvoi = { etat: EtatEmailResultat; code: string | null };

export type OptionsEnvoi = {
  /** Expéditeur simulé (tests). Par défaut : Resend avec RESEND_API_KEY. */
  expediteur?: Expediteur;
  /** Liste autorisée (tests). Par défaut : EMAILS_AUTORISES. */
  adressesAutorisees?: string;
  /** Adresse d'expédition (tests). Par défaut : EMAIL_EXPEDITEUR, sinon onboarding@resend.dev. */
  adresseExpediteur?: string;
};

/**
 * En-tête « From » : nom affiché en chaîne entre guillemets (RFC 5322), pour
 * qu'une virgule ou un chevron ne casse pas l'en-tête. Nom vide : l'adresse seule.
 */
export function enteteExpediteur(nom: string, adresse: string): string {
  const propre = nom.replace(/[\r\n]+/g, " ").trim();
  if (propre === "") return adresse;
  return `"${propre.replace(/["\\]/g, (c) => `\\${c}`)}" <${adresse}>`;
}

/**
 * Envoie l'email de confirmation d'une demande et renvoie l'état à noter.
 * Adresse hors de EMAILS_AUTORISES : aucun appel, `non_envoye_demo`.
 */
export async function envoyerConfirmation(
  destinataire: string,
  donnees: DonneesConfirmation & { demandeId: string },
  options: OptionsEnvoi = {},
): Promise<ResultatEnvoi> {
  try {
    const autorisees = lireAdressesAutorisees(
      options.adressesAutorisees ?? process.env.EMAILS_AUTORISES,
    );
    if (!estAdresseAutorisee(destinataire, autorisees)) {
      return { etat: "non_envoye_demo", code: null };
    }

    const contenu = contenuConfirmation(donnees);
    const expediteur = options.expediteur ?? expediteurResend();
    const adresseExpediteur =
      (options.adresseExpediteur ?? process.env.EMAIL_EXPEDITEUR ?? "").trim() ||
      ADRESSE_EXPEDITEUR;
    const resultat = await expediteur({
      // Adresse telle que saisie (sans espaces) ; la casse ne compte que pour la liste.
      a: destinataire.trim(),
      de: enteteExpediteur(donnees.nomAffiche, adresseExpediteur),
      ...contenu,
      cleIdempotence: `confirmation-demande/${donnees.demandeId}`,
    });
    return resultat.ok
      ? { etat: "envoye", code: null }
      : { etat: "echec", code: codeSur(resultat.code) };
  } catch {
    return { etat: "echec", code: "exception" };
  }
}
