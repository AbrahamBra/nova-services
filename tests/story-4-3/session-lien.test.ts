import { describe, expect, it } from "vitest";
import {
  DUREE_LIEN_MOT_DE_PASSE_MS,
  derniereConnexion,
  sessionParLien,
} from "@/lib/supabase/proxy";

// Story 4.3 — `sessionParLien` (lib/supabase/proxy.ts) : seule une session
// dont la connexion la plus récente est un lien (otp, recovery, invite,
// magiclink) ouvert il y a moins d'une heure peut changer le mot de passe.

const MAINTENANT = Date.UTC(2026, 10, 6, 12, 0, 0);
/** Horodatage `amr` (secondes) il y a `minutes` minutes. */
const ilYa = (minutes: number) => (MAINTENANT - minutes * 60_000) / 1000;
const claims = (...amr: { method: string; timestamp: number }[]) => ({ sub: "x", amr });

describe("sessionParLien", () => {
  it.each(["otp", "recovery", "invite", "magiclink"])("lien %s récent : vrai", (methode) => {
    expect(sessionParLien(claims({ method: methode, timestamp: ilYa(5) }), MAINTENANT)).toBe(true);
  });

  it.each(["totp", "oauth", "sso/saml", "anonymous", "web3"])(
    "méthode hors liste (%s) : faux",
    (methode) => {
      expect(sessionParLien(claims({ method: methode, timestamp: ilYa(1) }), MAINTENANT)).toBe(false);
    },
  );

  it("méthode hors liste plus récente qu'un lien : ignorée, le lien compte", () => {
    const c = claims({ method: "otp", timestamp: ilYa(10) }, { method: "totp", timestamp: ilYa(1) });
    expect(sessionParLien(c, MAINTENANT)).toBe(true);
  });

  it("mot de passe plus récent que le lien : faux ; lien plus récent : vrai", () => {
    expect(
      sessionParLien(
        claims({ method: "otp", timestamp: ilYa(10) }, { method: "password", timestamp: ilYa(1) }),
        MAINTENANT,
      ),
    ).toBe(false);
    expect(
      sessionParLien(
        claims({ method: "password", timestamp: ilYa(10) }, { method: "otp", timestamp: ilYa(1) }),
        MAINTENANT,
      ),
    ).toBe(true);
  });

  it("même horodatage : le mot de passe l'emporte, quel que soit l'ordre", () => {
    const t = ilYa(1);
    const a = claims({ method: "otp", timestamp: t }, { method: "password", timestamp: t });
    const b = claims({ method: "password", timestamp: t }, { method: "otp", timestamp: t });
    expect(sessionParLien(a, MAINTENANT)).toBe(false);
    expect(sessionParLien(b, MAINTENANT)).toBe(false);
    expect(derniereConnexion(a)?.methode).toBe("password");
    expect(derniereConnexion(b)?.methode).toBe("password");
  });

  it("lien ouvert il y a une heure ou plus : faux ; juste avant : vrai", () => {
    const limite = (MAINTENANT - DUREE_LIEN_MOT_DE_PASSE_MS) / 1000;
    expect(sessionParLien(claims({ method: "recovery", timestamp: limite }), MAINTENANT)).toBe(false);
    expect(sessionParLien(claims({ method: "recovery", timestamp: ilYa(61) }), MAINTENANT)).toBe(false);
    expect(sessionParLien(claims({ method: "recovery", timestamp: limite + 1 }), MAINTENANT)).toBe(true);
  });

  it.each([null, "texte", {}, { amr: "otp" }, { amr: [] }, { amr: [{ method: "otp" }] }])(
    "claims illisibles (%j) : faux",
    (valeur) => {
      expect(sessionParLien(valeur, MAINTENANT)).toBe(false);
    },
  );
});
