import type { Breadcrumb, ErrorEvent, init } from "@sentry/nextjs";

// Types non réexportés par @sentry/nextjs : déduits des options de `init`.
type OptionsInit = NonNullable<Parameters<typeof init>[0]>;
type Integration = Extract<NonNullable<OptionsInit["integrations"]>, readonly unknown[]>[number];
type TransactionEvent = Parameters<NonNullable<OptionsInit["beforeSendTransaction"]>>[0];

// Options Sentry communes au serveur, à l'edge et au navigateur (AD-14) :
// aucune donnée personnelle ne quitte l'application. Un seul endroit,
// vérifié par tests/story-3-3/options-sentry.test.ts.
// Pas d'import `server-only` : ce fichier est aussi chargé par le navigateur.

/** Intégrations interdites (pas d'enregistrement de session, AD-14). */
const INTEGRATIONS_INTERDITES = new Set(["Replay", "ReplayCanvas"]);

/** Coupe tout ce qui suit `?` ou `#` dans une adresse (paramètres, fragment). */
export function sansParametres(adresse: string): string {
  const coupure = adresse.search(/[?#]/);
  return coupure === -1 ? adresse : adresse.slice(0, coupure);
}

const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;
// Numéros de téléphone : au moins 9 chiffres, séparés ou non par des
// espaces, points, tirets ou parenthèses, avec ou sans indicatif « + ».
const TELEPHONE = /\+?\d(?:[\s.()-]*\d){8,}/g;

/** Masque les adresses email et les numéros de téléphone d'un texte. */
export function masquerCoordonnees(texte: string): string {
  return texte.replace(EMAIL, "[email retiré]").replace(TELEPHONE, "[téléphone retiré]");
}

// Champs d'un fil d'Ariane qui portent une adresse : fetch / xhr (`url`),
// navigation (`from`, `to`).
const CHAMPS_ADRESSE = ["url", "from", "to"] as const;
// Paramètres rangés à part par les fils d'Ariane fetch de Node.
const CHAMPS_PARAMETRES = ["url.query", "url.fragment", "http.query", "http.fragment"] as const;

/**
 * Retire les paramètres des adresses d'un fil d'Ariane (navigation, fetch),
 * le texte des fils « console » et les coordonnées des autres messages.
 */
export function nettoyerFilAriane(filAriane: Breadcrumb): Breadcrumb {
  const propre: Breadcrumb = { ...filAriane };
  if (propre.category === "console") delete propre.message;
  else if (typeof propre.message === "string") propre.message = masquerCoordonnees(propre.message);

  if (propre.data) {
    const nettoyees: Record<string, unknown> = { ...propre.data };
    for (const champ of CHAMPS_ADRESSE) {
      const valeur = nettoyees[champ];
      if (typeof valeur === "string") nettoyees[champ] = sansParametres(valeur);
    }
    for (const champ of CHAMPS_PARAMETRES) delete nettoyees[champ];
    propre.data = nettoyees;
  }
  return propre;
}

/**
 * Retire d'un événement tout ce qui pourrait désigner une personne : la
 * personne (`user`), les données libres (`extra`), le nom de la machine, le
 * corps de la requête, ses cookies, ses en-têtes (qui portent l'IP :
 * `x-nf-client-connection-ip`, `x-forwarded-for`), son `env` (REMOTE_ADDR),
 * ses paramètres, les paramètres des adresses (requête et fils d'Ariane), et
 * masque emails et téléphones dans les messages et les exceptions.
 */
export function nettoyerEvenement<E extends ErrorEvent | TransactionEvent>(evenement: E): E {
  const propre: E = { ...evenement };
  delete propre.user;
  delete propre.extra;
  delete propre.server_name;
  if (typeof propre.message === "string") propre.message = masquerCoordonnees(propre.message);

  if (propre.exception?.values) {
    propre.exception = {
      ...propre.exception,
      values: propre.exception.values.map((valeur) =>
        typeof valeur.value === "string"
          ? { ...valeur, value: masquerCoordonnees(valeur.value) }
          : valeur,
      ),
    };
  }

  if (propre.request) {
    const requete = { ...propre.request };
    delete requete.data;
    delete requete.cookies;
    delete requete.headers;
    delete requete.query_string;
    delete requete.env; // REMOTE_ADDR
    if (typeof requete.url === "string") requete.url = sansParametres(requete.url);
    propre.request = requete;
  }

  if (Array.isArray(propre.breadcrumbs)) {
    propre.breadcrumbs = propre.breadcrumbs.map(nettoyerFilAriane);
  }

  return propre;
}

export type ContexteSentry = {
  /** NEXT_PUBLIC_SENTRY_DSN : sans DSN, Sentry n'est pas activé. */
  dsn: string | undefined;
  /** SUPABASE_ENVIRONNEMENT (ou NEXT_PUBLIC_SUPABASE_ENVIRONNEMENT côté navigateur). */
  environnement: string | undefined;
  /** NEXT_PUBLIC_APP_VERSION, si présente. */
  version: string | undefined;
};

/** Sentry ne s'active que si le DSN est rempli. */
export function sentryActif(dsn: string | undefined): dsn is string {
  return typeof dsn === "string" && dsn.trim() !== "";
}

/** Options passées à `Sentry.init` partout (serveur, edge, navigateur). */
export function optionsSentry({ dsn, environnement, version }: ContexteSentry) {
  const actif = sentryActif(dsn);
  return {
    dsn: actif ? dsn.trim() : undefined,
    enabled: actif,
    // Sans environnement, le SDK écrirait « production » : on dit « inconnu ».
    environment: environnement?.trim() || "inconnu",
    release: version?.trim() || undefined,
    // Option des versions précédentes du SDK, remplacée par `dataCollection`
    // en 11.x (qui l'ignore) : gardée à false par prudence (AD-14).
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      // En plus de l'AD-14 : ni en-têtes (IP), ni paramètres d'adresse, ni
      // valeurs des variables locales (texte de formulaire), ni données SQL.
      httpHeaders: false,
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
    },
    // Pas de suivi des performances, pas de journaux, pas de tunnel.
    tracesSampleRate: 0,
    // Transactions envoyées en bloc (et non en flux) : sans quoi le SDK
    // ignore `beforeSendTransaction`, gardé par prudence.
    traceLifecycle: "static" as const,
    enableLogs: false,
    integrations: (parDefaut: Integration[]) =>
      parDefaut.filter((integration) => !INTEGRATIONS_INTERDITES.has(integration.name)),
    beforeSend: (evenement: ErrorEvent) => nettoyerEvenement(evenement),
    beforeSendTransaction: (evenement: TransactionEvent) => nettoyerEvenement(evenement),
    beforeBreadcrumb: (filAriane: Breadcrumb) => nettoyerFilAriane(filAriane),
  };
}
