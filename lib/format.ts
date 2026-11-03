// Affichage des dates à l'heure de Paris (AD-24).
// Tout affichage de date passe par ce fichier : format « 03/11/2026 à 09:12 ».

export const FUSEAU = "Europe/Paris";

const formatJour = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const formatHeure = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const formatAnnee = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  year: "numeric",
});

function versDate(valeur: Date | string): Date {
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Date invalide : ${String(valeur)}`);
  }
  return date;
}

/** « 03/11/2026 » */
export function formaterDate(valeur: Date | string): string {
  return formatJour.format(versDate(valeur));
}

/** « 09:12 » */
export function formaterHeure(valeur: Date | string): string {
  return formatHeure.format(versDate(valeur));
}

/** « 03/11/2026 à 09:12 » */
export function formaterDateHeure(valeur: Date | string): string {
  const date = versDate(valeur);
  return `${formaterDate(date)} à ${formaterHeure(date)}`;
}

/** Année civile à l'heure de Paris (utile autour du 1er janvier). */
export function anneeParis(valeur: Date | string): number {
  return Number(formatAnnee.format(versDate(valeur)));
}
