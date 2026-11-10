import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionsCompte } from "@/components/nova/comptes/actions-compte";
import { FournisseurToasts } from "@/components/nova/toasts";
import type { Compte } from "@/lib/comptes";
import { MESSAGES_COMPTE, texteAnnulationInvitation } from "@/lib/schemas/compte";

// Story 4.4 — sans base : « Renvoyer l'invitation » et « Annuler
// l'invitation » seulement sur un compte invité ; textes de la fenêtre de
// confirmation et du toast.

function compte(etat: Compte["etat"]): Compte {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    nom: "Léo Martin",
    email: "leo@example.com",
    role: "collaborateur",
    etat,
    demandesEnCours: 0,
  };
}

function html(c: Compte): string {
  return renderToStaticMarkup(
    <FournisseurToasts>
      <ActionsCompte compte={c} estMoi={false} />
    </FournisseurToasts>,
  ).replaceAll("&#x27;", "'");
}

describe("boutons d'invitation", () => {
  it("Invité : Renvoyer et Annuler l'invitation, nom complété pour les lecteurs d'écran", () => {
    const rendu = html(compte("invite"));
    expect(rendu).toContain("Renvoyer l'invitation<span class=\"sr-only\"> Léo Martin</span>");
    expect(rendu).toContain("Annuler l'invitation<span class=\"sr-only\"> Léo Martin</span>");
  });

  it.each(["actif", "desactive"] as const)("%s : ni Renvoyer ni Annuler l'invitation", (etat) => {
    const rendu = html(compte(etat));
    expect(rendu).not.toContain("Renvoyer l'invitation");
    expect(rendu).not.toContain("Annuler l'invitation");
  });
});

describe("textes", () => {
  it("fenêtre de confirmation et toast", () => {
    expect(texteAnnulationInvitation("Léo Martin")).toBe(
      "L'invitation de Léo Martin sera annulée et son compte disparaîtra de la liste.",
    );
    expect(MESSAGES_COMPTE.invitationAnnulee).toBe("Invitation annulée.");
  });
});
