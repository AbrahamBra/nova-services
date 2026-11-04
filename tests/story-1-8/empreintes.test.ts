import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENTETE_NETLIFY,
  ENTETE_RELAIS,
  ENTETE_TEST,
  IP_LOCALE,
  enteteDeTestAutorise,
  estSurNetlify,
  lireAdresseIp,
} from "@/lib/server/adresse-ip";
import {
  calculerEmpreinte,
  empreinteIp,
  estEmpreinte,
  estHorsProduction,
  lireCleHmac,
  oublierCleDeRepli,
} from "@/lib/server/empreintes";

// Story 1.8 — empreintes HMAC des IP (lib/server/empreintes.ts) et lecture de
// l'IP selon l'environnement (lib/server/adresse-ip.ts). Aucun accès réseau
// ni base.

const DEV = { SUPABASE_ENVIRONNEMENT: "developpement" };
const PROD = { SUPABASE_ENVIRONNEMENT: "production" };

afterEach(() => {
  oublierCleDeRepli();
  vi.restoreAllMocks();
});

function entetes(valeurs: Record<string, string>): Headers {
  return new Headers(valeurs);
}

describe("empreintes HMAC", () => {
  it("même valeur et même clé → même empreinte, de 64 caractères hexadécimaux", () => {
    const a = calculerEmpreinte("ip", "203.0.113.7", "cle-1");
    const b = calculerEmpreinte("ip", "203.0.113.7", "cle-1");
    expect(a).toBe(b);
    expect(estEmpreinte(a)).toBe(true);
    // HMAC-SHA-256 standard, avec le domaine en préfixe.
    expect(a).toBe(createHmac("sha256", "cle-1").update("ip:203.0.113.7").digest("hex"));
  });

  it("autre clé, autre IP ou autre domaine → autre empreinte", () => {
    const base = calculerEmpreinte("ip", "203.0.113.7", "cle-1");
    expect(calculerEmpreinte("ip", "203.0.113.7", "cle-2")).not.toBe(base);
    expect(calculerEmpreinte("ip", "203.0.113.8", "cle-1")).not.toBe(base);
    expect(calculerEmpreinte("email", "203.0.113.7", "cle-1")).not.toBe(base);
  });

  it("l'empreinte ne contient jamais l'IP", () => {
    const ip = "203.0.113.7";
    expect(empreinteIp(ip, { ...DEV, HMAC_SECRET: "secret" })).not.toContain(ip);
  });

  it("HMAC_SECRET présent → utilisé (espaces retirés), en production comme en développement", () => {
    expect(lireCleHmac({ ...PROD, HMAC_SECRET: " secret " })).toBe("secret");
    expect(empreinteIp("203.0.113.7", { ...PROD, HMAC_SECRET: "secret" })).toBe(
      calculerEmpreinte("ip", "203.0.113.7", "secret"),
    );
  });

  it("hors production sans secret → clé aléatoire stable pour le processus, avec un avertissement", () => {
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cle = lireCleHmac(DEV);
    expect(cle).toMatch(/^[0-9a-f]{64}$/);
    expect(lireCleHmac({ ...DEV, HMAC_SECRET: "" })).toBe(cle);
    expect(empreinteIp("203.0.113.7", DEV)).toBe(empreinteIp("203.0.113.7", DEV));
    expect(avertissement).toHaveBeenCalledTimes(1);

    // Nouveau processus (redémarrage) : nouvelle clé.
    oublierCleDeRepli();
    expect(lireCleHmac(DEV)).not.toBe(cle);
  });

  it("production sans secret → aucune empreinte, erreur tracée sans valeur", () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(lireCleHmac(PROD)).toBeNull();
    expect(empreinteIp("203.0.113.7", { ...PROD, HMAC_SECRET: "  " })).toBeNull();
    expect(erreur).toHaveBeenCalled();
    for (const [message] of erreur.mock.calls) {
      expect(String(message)).not.toContain("203.0.113.7");
    }
  });

  it("environnement absent ou inconnu → traité comme la production (pas de clé de repli)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(estHorsProduction({})).toBe(false);
    expect(estHorsProduction({ SUPABASE_ENVIRONNEMENT: "test" })).toBe(false);
    expect(estHorsProduction(DEV)).toBe(true);
    expect(lireCleHmac({})).toBeNull();
  });
});

describe("adresse IP selon l'environnement", () => {
  const tous = {
    [ENTETE_NETLIFY]: "198.51.100.1",
    [ENTETE_RELAIS]: "198.51.100.2, 10.0.0.1",
    [ENTETE_TEST]: "test-ip-1",
  };
  const sansNetlify = { [ENTETE_RELAIS]: "198.51.100.2, 10.0.0.1", [ENTETE_TEST]: "test-ip-1" };

  it("Netlify ou production : uniquement x-nf-client-connection-ip", () => {
    for (const env of [{ ...DEV, NETLIFY: "true" }, PROD]) {
      expect(estSurNetlify(env)).toBe(true);
      expect(lireAdresseIp(entetes(tous), env)).toBe("198.51.100.1");
      // Sans l'en-tête Netlify : rien (jamais x-forwarded-for, falsifiable).
      expect(lireAdresseIp(entetes(sansNetlify), env)).toBeNull();
    }
  });

  it("environnement absent ou inconnu → fermé : en-tête Netlify seul", () => {
    for (const env of [{}, { SUPABASE_ENVIRONNEMENT: "test" }]) {
      expect(estSurNetlify(env)).toBe(true);
      expect(lireAdresseIp(entetes(tous), { ...env, IP_DE_TEST_AUTORISEE: "1" })).toBe(
        "198.51.100.1",
      );
      expect(lireAdresseIp(entetes(sansNetlify), env)).toBeNull();
      expect(lireAdresseIp(entetes({}), env)).toBeNull();
    }
  });

  it("Netlify : l'en-tête de test est ignoré, même avec IP_DE_TEST_AUTORISEE=1", () => {
    const env = { ...DEV, NETLIFY: "true", IP_DE_TEST_AUTORISEE: "1" };
    expect(enteteDeTestAutorise(env)).toBe(false);
    expect(lireAdresseIp(entetes(tous), env)).toBe("198.51.100.1");
  });

  it("développement : x-nf-client-connection-ip s'il est présent (prévisualisation)", () => {
    expect(estSurNetlify(DEV)).toBe(false);
    expect(lireAdresseIp(entetes(tous), DEV)).toBe("198.51.100.1");
  });

  it("développement : premier élément non vide de x-forwarded-for, sinon 127.0.0.1", () => {
    expect(lireAdresseIp(entetes(sansNetlify), DEV)).toBe("198.51.100.2");
    expect(lireAdresseIp(entetes({ [ENTETE_RELAIS]: " 198.51.100.3 " }), DEV)).toBe(
      "198.51.100.3",
    );
    // Liste commençant par « , » : l'IP réelle, pas 127.0.0.1.
    expect(lireAdresseIp(entetes({ [ENTETE_RELAIS]: ", 198.51.100.4" }), DEV)).toBe(
      "198.51.100.4",
    );
    expect(lireAdresseIp(entetes({}), DEV)).toBe(IP_LOCALE);
    expect(lireAdresseIp(entetes({ [ENTETE_RELAIS]: "" }), DEV)).toBe(IP_LOCALE);
    expect(lireAdresseIp(entetes({ [ENTETE_RELAIS]: " , " }), DEV)).toBe(IP_LOCALE);
  });

  it("tests : x-nova-ip-test remplace l'IP seulement avec IP_DE_TEST_AUTORISEE=1", () => {
    expect(lireAdresseIp(entetes(tous), { ...DEV, IP_DE_TEST_AUTORISEE: "1" })).toBe("test-ip-1");
    // Sans la variable (ou avec une autre valeur) : en-tête ignoré.
    expect(lireAdresseIp(entetes(sansNetlify), DEV)).toBe("198.51.100.2");
    expect(lireAdresseIp(entetes(sansNetlify), { ...DEV, IP_DE_TEST_AUTORISEE: "true" })).toBe(
      "198.51.100.2",
    );
    // Variable posée mais en-tête absent : IP habituelle.
    expect(
      lireAdresseIp(entetes({ [ENTETE_RELAIS]: "198.51.100.2" }), {
        ...DEV,
        IP_DE_TEST_AUTORISEE: "1",
      }),
    ).toBe("198.51.100.2");
  });

  it("valeur trop longue → coupée à 100 caractères", () => {
    const longue = "a".repeat(500);
    expect(lireAdresseIp(entetes({ [ENTETE_RELAIS]: longue }), DEV)).toHaveLength(100);
  });
});
