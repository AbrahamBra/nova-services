import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Breadcrumb, ErrorEvent, init } from "@sentry/nextjs";

type OptionsInit = NonNullable<Parameters<typeof init>[0]>;
type Integration = Extract<NonNullable<OptionsInit["integrations"]>, readonly unknown[]>[number];

// Story 3.3 — options Sentry (AD-14) : aucune donnée personnelle envoyée.

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

const lireProfil = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session", () => ({ lireProfil }));

import {
  nettoyerEvenement,
  nettoyerFilAriane,
  optionsSentry,
  masquerCoordonnees,
  sansParametres,
  sentryActif,
} from "@/lib/sentry/options";
import { appeler } from "@/lib/server/appeler";
import { provoquerErreurTest } from "@/app/equipe/admin/test-erreur/actions";

const DSN = "https://cle-publique@o0.ingest.de.sentry.io/0";
const RACINE = process.cwd();

function lire(chemin: string): string {
  return readFileSync(join(RACINE, chemin), "utf8");
}

describe("lib/sentry/options — réglages communs", () => {
  const options = optionsSentry({
    dsn: DSN,
    environnement: "developpement",
    version: "1.0.0",
  });

  it("ne collecte ni utilisateur, ni cookies, ni corps de requête (AD-14)", () => {
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
    });
    expect(options.sendDefaultPii).toBe(false);
  });

  it("sans suivi des performances, sans journaux ni tunnel", () => {
    expect(options.tracesSampleRate).toBe(0);
    expect(options.traceLifecycle).toBe("static");
    expect(options.enableLogs).toBe(false);
    expect(options).not.toHaveProperty("tunnel");
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
    expect(options).not.toHaveProperty("profilesSampleRate");
  });

  it("retire toute intégration Replay", () => {
    const parDefaut = ["Replay", "ReplayCanvas", "Breadcrumbs", "Dedupe"].map(
      (name) => ({ name }) as Integration,
    );
    expect(options.integrations(parDefaut).map((i) => i.name)).toEqual(["Breadcrumbs", "Dedupe"]);
  });

  it("environnement et version", () => {
    expect(options.environment).toBe("developpement");
    expect(options.release).toBe("1.0.0");
    const sansVersion = optionsSentry({ dsn: DSN, environnement: "production", version: "" });
    expect(sansVersion.environment).toBe("production");
    expect(sansVersion.release).toBeUndefined();
  });

  it("environnement vide → « inconnu » (jamais « production » par défaut)", () => {
    for (const vide of [undefined, "", "  "]) {
      expect(optionsSentry({ dsn: DSN, environnement: vide, version: undefined }).environment).toBe(
        "inconnu",
      );
    }
  });

  it("actif seulement avec un DSN rempli", () => {
    expect(options.enabled).toBe(true);
    expect(options.dsn).toBe(DSN);
    for (const vide of [undefined, "", "   "]) {
      expect(sentryActif(vide)).toBe(false);
      const inactif = optionsSentry({ dsn: vide, environnement: "developpement", version: undefined });
      expect(inactif.enabled).toBe(false);
      expect(inactif.dsn).toBeUndefined();
    }
  });

  it("les crochets beforeSend, beforeSendTransaction et beforeBreadcrumb nettoient", () => {
    const evenement = {
      user: { email: "karim@example.com" },
      request: { url: "https://site/equipe?email=karim@example.com" },
    } as ErrorEvent;
    const nettoye = options.beforeSend(evenement);
    expect(nettoye).not.toHaveProperty("user");
    expect(nettoye.request?.url).toBe("https://site/equipe");
    expect(
      options.beforeSendTransaction({ type: "transaction", user: { ip_address: "1.2.3.4" } }),
    ).not.toHaveProperty("user");
    expect(
      options.beforeBreadcrumb({ category: "fetch", data: { url: "/api?telephone=0600" } }).data,
    ).toEqual({ url: "/api" });
  });
});

describe("nettoyerEvenement — matrice des données retirées", () => {
  const evenement: ErrorEvent = {
    type: undefined,
    message: "Erreur de test Sentry (volontaire) pour karim@example.com au 06 12 34 56 78",
    exception: {
      values: [{ type: "Error", value: "Échec pour sophie.garnier@example.com (+33 6 12 34 56 78)" }],
    },
    extra: { saisie: "Texte du formulaire" },
    server_name: "poste-de-karim",
    user: { id: "u1", email: "karim@example.com", ip_address: "203.0.113.7", username: "Karim" },
    request: {
      url: "https://nova.example/equipe/admin/test-erreur?email=karim@example.com#haut",
      method: "POST",
      data: { nom: "Karim Benali", telephone: "0600000000", description: "Texte du formulaire" },
      cookies: { "sb-access-token": "jeton" },
      headers: {
        "x-nf-client-connection-ip": "203.0.113.7",
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "Mozilla",
      },
      query_string: "email=karim@example.com",
      env: { REMOTE_ADDR: "203.0.113.7" },
    },
    breadcrumbs: [
      { category: "fetch", data: { url: "https://nova.example/api?email=karim@example.com", method: "GET" } },
      { category: "navigation", data: { from: "/connexion?retour=%2Fequipe", to: "/equipe#menu" } },
      { category: "console", message: "Texte du formulaire", data: { logger: "console" } },
      {
        category: "http",
        message: "appel pour karim@example.com",
        data: {
          url: "https://nova.example/api",
          "url.query": "?email=karim@example.com",
          "url.fragment": "#haut",
          "http.query": "email=karim@example.com",
          "http.fragment": "haut",
          "http.request.method": "GET",
        },
      },
    ],
  };

  const propre = nettoyerEvenement(evenement);
  const texte = JSON.stringify(propre);

  it("retire l'utilisateur, le corps, les cookies, les en-têtes et les paramètres", () => {
    expect(propre.user).toBeUndefined();
    expect(propre.request).toEqual({
      url: "https://nova.example/equipe/admin/test-erreur",
      method: "POST",
    });
  });

  it("coupe les paramètres des adresses des fils d'Ariane", () => {
    expect(propre.breadcrumbs?.[0]?.data).toEqual({ url: "https://nova.example/api", method: "GET" });
    expect(propre.breadcrumbs?.[1]?.data).toEqual({ from: "/connexion", to: "/equipe" });
  });

  it("retire `request.env` (REMOTE_ADDR), `extra` et `server_name`", () => {
    expect(propre.request).not.toHaveProperty("env");
    expect(propre).not.toHaveProperty("extra");
    expect(propre).not.toHaveProperty("server_name");
  });

  it("masque emails et téléphones dans le message et les exceptions", () => {
    expect(propre.message).toBe(
      "Erreur de test Sentry (volontaire) pour [email retiré] au [téléphone retiré]",
    );
    expect(propre.exception?.values?.[0]?.value).toBe("Échec pour [email retiré] ([téléphone retiré])");
    expect(propre.exception?.values?.[0]?.type).toBe("Error");
  });

  it("retire le texte des fils « console » et masque les autres messages", () => {
    expect(propre.breadcrumbs?.[2]).toEqual({ category: "console", data: { logger: "console" } });
    expect(propre.breadcrumbs?.[3]?.message).toBe("appel pour [email retiré]");
  });

  it("retire les clés `url.query`, `url.fragment`, `http.query`, `http.fragment`", () => {
    expect(propre.breadcrumbs?.[3]?.data).toEqual({
      url: "https://nova.example/api",
      "http.request.method": "GET",
    });
  });

  it("ne laisse aucune donnée personnelle ni adresse IP", () => {
    for (const interdit of [
      "karim@example.com",
      "sophie.garnier@example.com",
      "203.0.113.7",
      "Karim Benali",
      "0600000000",
      "12 34 56 78",
      "Texte du formulaire",
      "jeton",
      "poste-de-karim",
    ]) {
      expect(texte).not.toContain(interdit);
    }
  });

  it("ne modifie pas l'événement reçu", () => {
    expect(evenement.user?.email).toBe("karim@example.com");
    expect(evenement.request?.data).toBeDefined();
  });

  it("accepte un événement sans requête ni fil d'Ariane", () => {
    expect(nettoyerEvenement({ type: undefined, message: "x" })).toEqual({ type: undefined, message: "x" });
  });
});

describe("nettoyerFilAriane et sansParametres", () => {
  it("coupe après ? ou #", () => {
    expect(sansParametres("/a?b=1#c")).toBe("/a");
    expect(sansParametres("/a#c?b=1")).toBe("/a");
    expect(sansParametres("/a")).toBe("/a");
  });

  it("laisse un fil d'Ariane sans données intact", () => {
    const fil: Breadcrumb = { category: "ui.click", message: "button" };
    expect(nettoyerFilAriane(fil)).toEqual(fil);
  });

  it("masquerCoordonnees laisse un texte sans coordonnées intact", () => {
    expect(masquerCoordonnees("fonction=deposer_demande code=XX000")).toBe(
      "fonction=deposer_demande code=XX000",
    );
  });
});

describe("lib/server/appeler — envoi à Sentry", () => {
  it("une erreur Postgres imprévue envoie seulement « fonction=… code=… »", async () => {
    captureMessage.mockClear();
    const erreurConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    const resultat = await appeler(
      {
        rpc: async () => ({
          data: null,
          error: { code: "XX000", message: "détail karim@example.com" },
        }),
      },
      "deposer_demande",
      { p_email: "karim@example.com" },
    );
    expect(resultat.ok).toBe(false);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      "[appeler] erreur inattendue : fonction=deposer_demande code=XX000",
      "error",
    );
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain("karim");
    erreurConsole.mockRestore();
  });

  it("une exception envoie seulement le nom de la fonction", async () => {
    captureMessage.mockClear();
    const erreurConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    await appeler(
      {
        rpc: () => {
          throw new Error("karim@example.com");
        },
      },
      "mon_profil",
    );
    expect(captureMessage).toHaveBeenCalledWith(
      "[appeler] exception : fonction=mon_profil code=aucun",
      "error",
    );
    erreurConsole.mockRestore();
  });

  it("une erreur prévue n'est pas envoyée", async () => {
    captureMessage.mockClear();
    await appeler(
      { rpc: async () => ({ data: null, error: { code: "P0001", message: "ERREUR_INATTENDUE" } }) },
      "f",
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

describe("action provoquerErreurTest — rôle revérifié (AD-1)", () => {
  it("un collaborateur est refusé, sans erreur levée", async () => {
    lireProfil.mockResolvedValueOnce({
      ok: true,
      donnees: { nom: "TEST Karim", prenom: "TEST", role: "collaborateur", estAdmin: false },
    });
    await expect(provoquerErreurTest()).resolves.toEqual({
      ok: false,
      code: "ACCES_REFUSE",
      message: "Vous n'avez pas accès à cette page.",
    });
  });

  it("sans membre actif, refus aussi", async () => {
    lireProfil.mockResolvedValueOnce({ ok: true, donnees: null });
    await expect(provoquerErreurTest()).resolves.toMatchObject({ ok: false, code: "ACCES_REFUSE" });
  });

  it("un administrateur provoque l'erreur volontaire", async () => {
    lireProfil.mockResolvedValueOnce({
      ok: true,
      donnees: { nom: "TEST Claire", prenom: "TEST", role: "administrateur", estAdmin: true },
    });
    await expect(provoquerErreurTest()).rejects.toThrow("Erreur de test Sentry (volontaire)");
  });
});

describe("branchements Sentry dans le code", () => {
  it("serveur, edge et navigateur utilisent les options communes, seulement avec un DSN", () => {
    for (const fichier of ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]) {
      const source = lire(fichier);
      expect(source, fichier).toContain('from "@/lib/sentry/options"');
      expect(source, fichier).toMatch(/if \(sentryActif\(dsn\)\) \{\s*Sentry\.init\(\s*optionsSentry\(/);
      expect(source, fichier).toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");
    }
    expect(lire("instrumentation.ts")).toContain("export const onRequestError = Sentry.captureRequestError");
  });

  it("l'environnement du navigateur est recopié de SUPABASE_ENVIRONNEMENT", () => {
    expect(lire("next.config.ts")).toMatch(
      /env:\s*\{[^}]*NEXT_PUBLIC_SUPABASE_ENVIRONNEMENT:\s*process\.env\.SUPABASE_ENVIRONNEMENT\b/,
    );
    expect(lire("instrumentation-client.ts")).toMatch(
      /environnement:\s*process\.env\.NEXT_PUBLIC_SUPABASE_ENVIRONNEMENT\b/,
    );
    expect(lire("sentry.server.config.ts")).toMatch(
      /environnement:\s*process\.env\.SUPABASE_ENVIRONNEMENT\b/,
    );
  });

  it("cartes du code source envoyées seulement avec le jeton, sur Netlify", () => {
    const config = lire("next.config.ts");
    expect(config).toContain("withSentryConfig(");
    expect(config).toContain("silent: true");
    expect(config).toMatch(/envoyerCartes = Boolean\(process\.env\.SENTRY_AUTH_TOKEN\) && process\.env\.NETLIFY === "true"/);
    expect(config).toContain("sourcemaps: { disable: !envoyerCartes }");
    expect(config).toContain("devIndicators: false");
  });

  it("aucun setUser, Replay, journaux Sentry, profilage ni tunnel dans le code", () => {
    const sources: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(join(RACINE, dossier))) {
        const chemin = join(dossier, nom);
        if (statSync(join(RACINE, chemin)).isDirectory()) parcourir(chemin);
        else if (/\.(ts|tsx|mjs|js)$/.test(nom)) sources.push(chemin);
      }
    };
    for (const dossier of ["app", "lib", "components", "scripts"]) parcourir(dossier);
    sources.push(
      "instrumentation.ts",
      "instrumentation-client.ts",
      "sentry.server.config.ts",
      "sentry.edge.config.ts",
      "next.config.ts",
      "proxy.ts",
    );
    for (const chemin of sources) {
      const source = lire(chemin);
      expect(source, chemin).not.toMatch(/setUser\s*\(/);
      expect(source, chemin).not.toMatch(/replayIntegration|replayCanvasIntegration/);
      expect(source, chemin).not.toMatch(/enableLogs:\s*true/);
      expect(source, chemin).not.toMatch(/profilesSampleRate|profileSessionSampleRate|tunnelRoute|tunnel:/);
    }
  });

  it(".env.example liste les variables Sentry sans valeur", () => {
    const exemple = lire(".env.example");
    for (const variable of ["NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]) {
      expect(exemple).toMatch(new RegExp(`^${variable}=\\r?$`, "m"));
    }
  });
});
