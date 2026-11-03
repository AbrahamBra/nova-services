import { describe, expect, it, vi } from "vitest";

// Ajoute un code prévu fictif à lib/erreurs.ts, le temps de ces tests : la
// liste réelle ne contient encore que ERREUR_INATTENDUE.
vi.mock("@/lib/erreurs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/erreurs")>();
  const MESSAGES_ERREUR = {
    ...original.MESSAGES_ERREUR,
    TEST_CODE_PREVU: "Message prévu pour le test.",
  } as const;
  return {
    ...original,
    MESSAGES_ERREUR,
    estCodeErreur: (valeur: unknown) =>
      typeof valeur === "string" && valeur in MESSAGES_ERREUR,
    messageErreur: (code: keyof typeof MESSAGES_ERREUR) => MESSAGES_ERREUR[code],
  };
});

import { appeler, type ClientRpc } from "@/lib/server/appeler";
import { MESSAGES_ERREUR } from "@/lib/erreurs";

function clientQuiRepond(
  reponse: Awaited<ReturnType<ClientRpc["rpc"]>>,
): ClientRpc & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn().mockResolvedValue(reponse) };
}

describe("lib/server/appeler — appel d'une fonction SQL", () => {
  it("renvoie { ok: true, donnees } quand la fonction réussit", async () => {
    const client = clientQuiRepond({ data: { reference: "NOVA-2026-0001" }, error: null });

    const resultat = await appeler(client, "ma_fonction", { p_id: 1 });

    expect(resultat).toEqual({ ok: true, donnees: { reference: "NOVA-2026-0001" } });
    expect(client.rpc).toHaveBeenCalledWith("ma_fonction", { p_id: 1 });
  });

  it("traduit une erreur prévue (P0001 + code connu) en code et message", async () => {
    const client = clientQuiRepond({
      data: null,
      error: { code: "P0001", message: "TEST_CODE_PREVU" },
    });

    const resultat = await appeler(client, "ma_fonction");

    expect(resultat).toEqual({
      ok: false,
      code: "TEST_CODE_PREVU",
      message: "Message prévu pour le test.",
    });
  });

  it("traite un code P0001 inconnu comme une erreur inattendue", async () => {
    const client = clientQuiRepond({
      data: null,
      error: { code: "P0001", message: "CODE_INCONNU" },
    });

    expect(await appeler(client, "ma_fonction")).toEqual({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: MESSAGES_ERREUR.ERREUR_INATTENDUE,
    });
  });

  it("ne laisse pas passer un message technique de PostgreSQL", async () => {
    const client = clientQuiRepond({
      data: null,
      error: { code: "42501", message: "permission denied for table demandes" },
    });

    const resultat = await appeler(client, "ma_fonction");

    expect(resultat).toEqual({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: MESSAGES_ERREUR.ERREUR_INATTENDUE,
    });
  });

  it("ne laisse remonter aucune exception (réseau coupé)", async () => {
    const client: ClientRpc = {
      rpc: vi.fn().mockRejectedValue(new Error("fetch failed")),
    };

    await expect(appeler(client, "ma_fonction")).resolves.toMatchObject({
      ok: false,
      code: "ERREUR_INATTENDUE",
    });
  });
});

describe("lib/erreurs — message des erreurs inattendues", () => {
  it("reprend le texte d'EXPERIENCE.md", async () => {
    const reel = await vi.importActual<typeof import("@/lib/erreurs")>("@/lib/erreurs");
    expect(reel.messageErreur("ERREUR_INATTENDUE")).toBe(
      "Le serveur ne répond pas. Vos informations sont conservées : réessayez dans un instant.",
    );
  });
});
