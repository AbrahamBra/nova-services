import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// Story 4.3 — email « Choisissez un nouveau mot de passe »
// (`envoyerLienMotDePasse`, lib/server/emails.ts). Aucun appel réel à
// Resend : le paquet est remplacé par une simulation, et les tests passent
// un expéditeur simulé.

const simulation = vi.hoisted(() => ({
  envois: [] as { payload: Record<string, unknown>; options?: Record<string, unknown> }[],
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        simulation.envois.push({ payload, options });
        return Promise.resolve({ data: { id: "email-simule" }, error: null, headers: null });
      },
    };
  },
}));

import {
  ADRESSE_EXPEDITEUR,
  cleIdempotenceMotDePasse,
  contenuLienMotDePasse,
  envoyerLienMotDePasse,
  expediteurResend,
  type Expediteur,
  type MessageEmail,
} from "@/lib/server/emails";

const JETON = "b".repeat(56);
const LIEN = `https://nova.example/auth/confirmer?token_hash=${JETON}&type=recovery`;
const ABRAHAM = "abraham@example.com";

function expediteurSimule(reponse: Awaited<ReturnType<Expediteur>> = { ok: true }) {
  const messages: MessageEmail[] = [];
  const expediteur: Expediteur = async (message) => {
    messages.push(message);
    return reponse;
  };
  return { messages, expediteur };
}

afterEach(() => {
  simulation.envois.length = 0;
});

describe("contenu de l'email", () => {
  it("objet, lien, durée de 24 h ; ni nom ni adresse du membre", () => {
    const c = contenuLienMotDePasse(LIEN);
    expect(c.objet).toBe("Choisissez un nouveau mot de passe");
    expect(c.texte).toContain(LIEN);
    expect(c.texte).toContain("valable 24 h");
    expect(c.html).toContain("valable 24 h");
    expect(c.html).toContain(LIEN.replaceAll("&", "&amp;"));
    expect(`${c.texte} ${c.html}`).not.toContain(ABRAHAM);
    expect(`${c.texte} ${c.objet}`).not.toContain("!");
  });

  it("lien échappé dans le HTML", () => {
    const c = contenuLienMotDePasse('https://x.example/?a="<b>"');
    expect(c.html).not.toContain('"<b>"');
    expect(c.html).toContain("&quot;&lt;b&gt;&quot;");
  });
});

describe("envoyerLienMotDePasse", () => {
  it("adresse hors de EMAILS_AUTORISES : aucun envoi, non_envoye_demo", async () => {
    const { messages, expediteur } = expediteurSimule();
    const r = await envoyerLienMotDePasse(
      "autre@example.com",
      { lien: LIEN, jetonHache: JETON },
      { expediteur, adressesAutorisees: ABRAHAM },
    );
    expect(r).toEqual({ etat: "non_envoye_demo", code: null });
    expect(messages).toEqual([]);
  });

  it("liste vide : aucun envoi", async () => {
    const { messages, expediteur } = expediteurSimule();
    const r = await envoyerLienMotDePasse(ABRAHAM, { lien: LIEN, jetonHache: JETON }, { expediteur, adressesAutorisees: "" });
    expect(r.etat).toBe("non_envoye_demo");
    expect(messages).toEqual([]);
  });

  it("adresse autorisée : même expéditeur que la confirmation, clé d'idempotence sans le jeton", async () => {
    const { messages, expediteur } = expediteurSimule();
    const r = await envoyerLienMotDePasse(
      ` ${ABRAHAM} `,
      { lien: LIEN, jetonHache: JETON },
      { expediteur, adressesAutorisees: `Abraham@Example.com, autre@example.com` },
    );
    expect(r).toEqual({ etat: "envoye", code: null });
    expect(messages).toHaveLength(1);
    const [m] = messages;
    expect(m.a).toBe(ABRAHAM);
    expect(m.de).toBe(`"Nova Services" <${ADRESSE_EXPEDITEUR}>`);
    expect(m.objet).toBe("Choisissez un nouveau mot de passe");
    expect(m.texte).toContain(LIEN);
    const empreinte = createHash("sha256").update(JETON).digest("hex");
    expect(m.cleIdempotence).toBe(`mot-de-passe/${empreinte}`);
    expect(m.cleIdempotence).not.toContain(JETON);
    expect(cleIdempotenceMotDePasse(JETON)).toBe(m.cleIdempotence);
  });

  it("« * » : toutes les adresses ; EMAIL_EXPEDITEUR respecté", async () => {
    const { messages, expediteur } = expediteurSimule();
    await envoyerLienMotDePasse(
      "leo@example.com",
      { lien: LIEN, jetonHache: JETON },
      { expediteur, adressesAutorisees: "*", adresseExpediteur: "equipe@nova.example" },
    );
    expect(messages[0].de).toBe(`"Nova Services" <equipe@nova.example>`);
  });

  it("échec de Resend : etat echec avec un code court, jamais d'exception", async () => {
    const { expediteur } = expediteurSimule({ ok: false, code: "rate_limit_exceeded" });
    const r = await envoyerLienMotDePasse(ABRAHAM, { lien: LIEN, jetonHache: JETON }, { expediteur, adressesAutorisees: ABRAHAM });
    expect(r).toEqual({ etat: "echec", code: "rate_limit_exceeded" });

    const enPanne: Expediteur = async () => {
      throw new Error(`panne pour ${ABRAHAM}`);
    };
    const r2 = await envoyerLienMotDePasse(ABRAHAM, { lien: LIEN, jetonHache: JETON }, { expediteur: enPanne, adressesAutorisees: ABRAHAM });
    expect(r2).toEqual({ etat: "echec", code: "exception" });
  });

  it("Resend (simulé) reçoit la clé d'idempotence", async () => {
    const r = await envoyerLienMotDePasse(
      ABRAHAM,
      { lien: LIEN, jetonHache: JETON },
      { expediteur: expediteurResend("re_test_simule"), adressesAutorisees: ABRAHAM },
    );
    expect(r.etat).toBe("envoye");
    expect(simulation.envois).toHaveLength(1);
    expect(simulation.envois[0].options).toEqual({ idempotencyKey: cleIdempotenceMotDePasse(JETON) });
    expect(simulation.envois[0].payload.to).toBe(ABRAHAM);
  });
});
