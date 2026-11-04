import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  clientConnecte,
  clientPubliableTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "../outils/comptes";

// Story 1.9 — limite de 8 h des sessions (lib/supabase/proxy.ts, AD-21) et
// mot de passe de 8 caractères minimum (réglage Supabase).
//
// 1. Proxy, avec un client Supabase simulé (on ne peut pas fabriquer une
//    vraie session de plus de 8 h) : moins de 8 h conservée, plus de 8 h
//    fermée, horodatage absent traité comme expiré, appel d'action serveur.
// 2. Vrai Supabase Auth, compte `TEST-…` jetable : l'horodatage `amr` de la
//    méthode `password` existe et ne change pas quand le jeton est rafraîchi ;
//    un mot de passe de 7 caractères est refusé.

const simulation = vi.hoisted(() => ({
  claims: null as unknown,
  deconnexions: 0,
  signOutEnPanne: false,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _cle: string,
    options: {
      cookies: {
        getAll: () => { name: string; value: string }[];
        setAll: (cookies: { name: string; value: string; options: object }[], entetes: object) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: async () =>
        simulation.claims
          ? { data: { claims: simulation.claims }, error: null }
          : { data: null, error: null },
      signOut: async () => {
        simulation.deconnexions += 1;
        if (simulation.signOutEnPanne) throw new Error("Auth indisponible");
        // Comme @supabase/ssr : cookies de session vidés.
        const aVider = options.cookies
          .getAll()
          .filter(({ name }) => name.startsWith("sb-"))
          .map(({ name }) => ({ name, value: "", options: { maxAge: 0, path: "/" } }));
        options.cookies.setAll(aVider, {});
        return { error: null };
      },
    },
  }),
}));

import {
  DUREE_MAX_SESSION_MS,
  heureDeConnexion,
  mettreAJourSession,
  sessionExpiree,
} from "@/lib/supabase/proxy";

const HEURE = 3600 * 1000;
const COOKIE = "sb-projet-auth-token";

function claimsConnecteIlYA(ms: number): Record<string, unknown> {
  const secondes = Math.floor((Date.now() - ms) / 1000);
  return {
    sub: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    // `iat` récent : le jeton vient d'être rafraîchi, seule l'heure de `amr` compte.
    iat: Math.floor(Date.now() / 1000) - 60,
    amr: [{ method: "password", timestamp: secondes }],
  };
}

function requete(adresse: string, init: { methode?: string; action?: boolean } = {}): NextRequest {
  const entetes = new Headers({ cookie: `${COOKIE}=jeton; autre=garde` });
  if (init.action) entetes.set("next-action", "abc123");
  return new NextRequest(new URL(adresse, "http://localhost:3000"), {
    method: init.methode ?? "GET",
    headers: entetes,
  });
}

/** Le cookie de session est effacé dans la réponse (Set-Cookie expiré). */
function cookieEfface(reponse: Response): boolean {
  return (reponse.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[^;,]+=)/)
    .some((c) => c.trim().startsWith(`${COOKIE}=;`) && /max-age=0|expires=thu, 01 jan 1970/i.test(c));
}

beforeEach(() => {
  simulation.claims = null;
  simulation.deconnexions = 0;
  simulation.signOutEnPanne = false;
});

describe("heure de connexion lue dans les claims", () => {
  it("lit l'horodatage le plus récent, quelle que soit la méthode", () => {
    expect(heureDeConnexion({ amr: [{ method: "password", timestamp: 1793797367 }] })).toBe(
      1793797367000,
    );
    expect(
      heureDeConnexion({
        amr: [
          { method: "password", timestamp: 1793790000 },
          { method: "otp", timestamp: 1793799999 },
          { method: "password", timestamp: 1793797367 },
        ],
      }),
    ).toBe(1793799999000);
    // Session ouverte par un lien (invitation, réinitialisation : epic 4).
    expect(heureDeConnexion({ amr: [{ method: "otp", timestamp: 1793797367 }] })).toBe(
      1793797367000,
    );
    expect(heureDeConnexion({ amr: [{ method: "recovery", timestamp: 1793797367 }] })).toBe(
      1793797367000,
    );
  });

  it("introuvable → null", () => {
    for (const claims of [
      null,
      {},
      { amr: "password" },
      { amr: ["password"] },
      { amr: [{ method: "password" }] },
      { amr: [{ method: "password", timestamp: "1793797367" }] },
      { amr: [{ method: "password", timestamp: -1 }] },
    ]) {
      expect(heureDeConnexion(claims), JSON.stringify(claims)).toBeNull();
    }
  });

  it("expirée au-delà de 8 h, ou sans horodatage", () => {
    const maintenant = Date.now();
    expect(sessionExpiree(claimsConnecteIlYA(7 * HEURE), maintenant)).toBe(false);
    expect(sessionExpiree(claimsConnecteIlYA(DUREE_MAX_SESSION_MS - 60_000), maintenant)).toBe(false);
    expect(sessionExpiree(claimsConnecteIlYA(DUREE_MAX_SESSION_MS + 60_000), maintenant)).toBe(true);
    expect(sessionExpiree({ sub: "x" }, maintenant)).toBe(true);
  });
});

describe("proxy — limite de 8 h", () => {
  it("session de moins de 8 h : conservée, pas de redirection", async () => {
    simulation.claims = claimsConnecteIlYA(7 * HEURE);
    const reponse = await mettreAJourSession(requete("/equipe/demandes"));
    expect(reponse.headers.get("location")).toBeNull();
    expect(simulation.deconnexions).toBe(0);
    expect(cookieEfface(reponse)).toBe(false);
  });

  it("session de plus de 8 h : fermée, cookies effacés, retour à /connexion avec le message", async () => {
    simulation.claims = claimsConnecteIlYA(8 * HEURE + 60_000);
    const reponse = await mettreAJourSession(requete("/equipe/demandes?page=2"));
    expect(reponse.status).toBe(307);
    const cible = new URL(reponse.headers.get("location") ?? "");
    expect(cible.pathname).toBe("/connexion");
    expect(cible.searchParams.get("expiree")).toBe("1");
    expect(cible.searchParams.get("retour")).toBe("/equipe/demandes?page=2");
    expect(simulation.deconnexions).toBe(1);
    expect(cookieEfface(reponse)).toBe(true);
    expect(reponse.headers.get("cache-control")).toContain("no-store");
  });

  it("horodatage absent : traité comme expiré", async () => {
    simulation.claims = { sub: "7c9e6679-7425-40de-944b-e07fc1f90ae7", amr: ["password"] };
    const reponse = await mettreAJourSession(requete("/equipe"));
    expect(new URL(reponse.headers.get("location") ?? "").searchParams.get("expiree")).toBe("1");
    expect(simulation.deconnexions).toBe(1);
    expect(cookieEfface(reponse)).toBe(true);
  });

  it("Auth en panne pendant signOut : la session est tout de même fermée", async () => {
    simulation.claims = claimsConnecteIlYA(9 * HEURE);
    simulation.signOutEnPanne = true;
    const reponse = await mettreAJourSession(requete("/equipe"));
    expect(reponse.status).toBe(307);
    expect(cookieEfface(reponse)).toBe(true);
  });

  it("appel d'action serveur : pas de redirection, mais session fermée (la requête n'a plus le cookie)", async () => {
    simulation.claims = claimsConnecteIlYA(9 * HEURE);
    const reponse = await mettreAJourSession(
      requete("/equipe/demandes", { methode: "POST", action: true }),
    );
    expect(reponse.headers.get("location")).toBeNull();
    expect(simulation.deconnexions).toBe(1);
    expect(cookieEfface(reponse)).toBe(true);
    // Cookies transmis à la suite du traitement (action, pages) : plus de session.
    const transmis = reponse.headers.get("x-middleware-request-cookie") ?? "";
    expect(transmis).not.toContain(COOKIE);
    expect(transmis).toContain("autre=garde");
  });

  it("sur /connexion?expiree=1 : session fermée sans nouvelle redirection (pas de boucle)", async () => {
    simulation.claims = claimsConnecteIlYA(9 * HEURE);
    const reponse = await mettreAJourSession(requete("/connexion?expiree=1"));
    expect(reponse.headers.get("location")).toBeNull();
    expect(cookieEfface(reponse)).toBe(true);
  });

  it("sur /connexion?retour=… : l'adresse de retour valide est gardée, une adresse extérieure est retirée", async () => {
    simulation.claims = claimsConnecteIlYA(9 * HEURE);
    const reponse = await mettreAJourSession(requete("/connexion?retour=%2Fequipe%2Fdemandes%3Fpage%3D2"));
    const cible = new URL(reponse.headers.get("location") ?? "");
    expect(cible.pathname).toBe("/connexion");
    expect(cible.searchParams.get("expiree")).toBe("1");
    expect(cible.searchParams.get("retour")).toBe("/equipe/demandes?page=2");
    expect(cookieEfface(reponse)).toBe(true);

    simulation.claims = claimsConnecteIlYA(9 * HEURE);
    const exterieure = await mettreAJourSession(
      requete(`/connexion?retour=${encodeURIComponent("https://exemple.com")}`),
    );
    const cible2 = new URL(exterieure.headers.get("location") ?? "");
    expect(cible2.searchParams.get("expiree")).toBe("1");
    expect(cible2.searchParams.has("retour")).toBe(false);
  });

  it("sans session : comportement de la story 1.4 inchangé", async () => {
    const reponse = await mettreAJourSession(requete("/equipe/admin"));
    const cible = new URL(reponse.headers.get("location") ?? "");
    expect(cible.pathname).toBe("/connexion");
    expect(cible.searchParams.get("retour")).toBe("/equipe/admin");
    expect(cible.searchParams.has("expiree")).toBe(false);
    expect(simulation.deconnexions).toBe(0);
  });
});

describe("vrai Supabase Auth — compte TEST- jetable", () => {
  const comptes: CompteTest[] = [];

  afterAll(async () => {
    await supprimerComptesTest(comptes);
  }, 60_000);

  it("l'horodatage amr « password » est l'heure de connexion et ne change pas au rafraîchissement", async () => {
    const compte = await creerCompteTest({ etiquette: "1.9" });
    comptes.push(compte);
    const avant = Date.now();
    const client = await clientConnecte(compte);

    const premier = await client.auth.getClaims();
    expect(premier.error).toBeNull();
    const heure = heureDeConnexion(premier.data?.claims);
    expect(heure).not.toBeNull();
    expect(Math.abs((heure as number) - avant)).toBeLessThan(60_000);
    expect(sessionExpiree(premier.data?.claims)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const { error } = await client.auth.refreshSession();
    expect(error).toBeNull();
    const second = await client.auth.getClaims();
    expect(second.data?.claims.iat).toBeGreaterThan(premier.data?.claims.iat as number);
    expect(heureDeConnexion(second.data?.claims)).toBe(heure);
  }, 60_000);

  it("un mot de passe de 7 caractères est refusé (réglage Supabase : 8 minimum)", async () => {
    const compte = await creerCompteTest({ etiquette: "1.9" });
    comptes.push(compte);
    const client = await clientConnecte(compte);
    const { error } = await client.auth.updateUser({ password: "abcdefg" });
    expect(error?.code).toBe("weak_password");
    // L'ancien mot de passe reste le bon.
    const verification = clientPubliableTest();
    const { error: erreurConnexion } = await verification.auth.signInWithPassword({
      email: compte.email,
      password: compte.motDePasse,
    });
    expect(erreurConnexion).toBeNull();
  }, 60_000);
});
