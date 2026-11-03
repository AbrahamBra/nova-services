import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { messageErreur } from "@/lib/erreurs";

// Story 1.2 — page `/` quand la base est injoignable : bandeau d'erreur et
// « Réessayer », jamais de formulaire vide trompeur.

vi.mock("@/lib/infos-publiques", async () => {
  const { messageErreur: message } = await import("@/lib/erreurs");
  return {
    lireInfosPubliques: async () => ({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: message("ERREUR_INATTENDUE"),
    }),
  };
});

import Accueil from "@/app/page";

describe("page / — base injoignable", () => {
  it("affiche le bandeau d'erreur avec « Réessayer », sans formulaire", async () => {
    const html = renderToStaticMarkup(await Accueil());

    expect(html).toContain('role="alert"');
    expect(html).toContain(messageErreur("ERREUR_INATTENDUE"));
    expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
    expect(html).toContain("Nova Services");
    expect(html).not.toContain("Nom et prénom");
    expect(html).not.toContain("<form");
  });
});
