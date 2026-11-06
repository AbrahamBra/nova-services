import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ListeComptes,
  MESSAGE_AUCUN_COMPTE,
} from "@/components/nova/comptes/liste-comptes";
import type { Compte } from "@/lib/comptes";

// Story 4.1 — liste des comptes sans base : état vide (seul l'administrateur
// connecté, la base partagée n'est jamais vide), tableau et cartes, libellés
// du rôle et de l'état.

const MOI: Compte = {
  id: "moi",
  nom: "Claire Roux",
  email: "claire@example.com",
  role: "administrateur",
  etat: "actif",
};
const LEO: Compte = {
  id: "leo",
  nom: "Léo Martin",
  email: "leo@example.com",
  role: "collaborateur",
  etat: "invite",
};

describe("ListeComptes", () => {
  it("seul l'administrateur : « Aucun autre compte. Invitez un premier collaborateur. »", () => {
    const html = renderToStaticMarkup(<ListeComptes comptes={[MOI]} idConnecte="moi" />);
    expect(MESSAGE_AUCUN_COMPTE).toBe("Aucun autre compte. Invitez un premier collaborateur.");
    expect(html).toContain(MESSAGE_AUCUN_COMPTE);
    expect(html).not.toContain("<table");
  });

  it("tableau Nom · Email · Rôle · État, et une carte par compte sur téléphone", () => {
    const html = renderToStaticMarkup(<ListeComptes comptes={[MOI, LEO]} idConnecte="moi" />);
    expect(html).not.toContain(MESSAGE_AUCUN_COMPTE);
    const entetes = [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map(([, t]) => t);
    expect(entetes).toEqual(["Nom", "Email", "Rôle", "État"]);
    expect(html).toContain("Invité");
    expect(html).toContain("Collaborateur");
    expect(html).toContain("Administrateur");
    // Deux vues (tableau et cartes) : chaque compte apparaît deux fois.
    expect(html.match(/data-compte="leo@example.com"/g)).toHaveLength(2);
  });
});
