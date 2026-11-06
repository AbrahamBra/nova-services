import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionsCompte, repartirErreursModification } from "@/components/nova/comptes/actions-compte";
import { ListeComptes } from "@/components/nova/comptes/liste-comptes";
import { FournisseurToasts } from "@/components/nova/toasts";
import { lireReponseComptes, type Compte } from "@/lib/comptes";
import { MESSAGES_ERREUR } from "@/lib/erreurs";
import {
  MESSAGES_COMPTE,
  texteDesactivation,
  verifierModification,
} from "@/lib/schemas/compte";

// Story 4.2 — sans base : actions par état (Invité → Modifier ; Actif →
// Modifier, Désactiver ; Désactivé → Modifier, Réactiver ; ma ligne :
// Modifier seulement), texte de la fenêtre « Désactiver » (singulier,
// pluriel, aucune demande), schéma « Modifier », messages des nouveaux codes.

const ID = "33333333-3333-4333-8333-333333333333";

function compte(etat: Compte["etat"], demandesEnCours = 0): Compte {
  return {
    id: ID,
    nom: "Léo Martin",
    email: "leo@example.com",
    role: "collaborateur",
    etat,
    demandesEnCours,
  };
}

function boutons(element: React.ReactElement): string[] {
  const html = renderToStaticMarkup(<FournisseurToasts>{element}</FournisseurToasts>);
  // Texte visible de chaque bouton (sans le nom caché aux yeux).
  return [...html.matchAll(/<button[^>]*>([^<]*)/g)].map(([, texte]) => texte.trim());
}

describe("ActionsCompte — selon l'état", () => {
  it("Invité : Modifier", () => {
    expect(boutons(<ActionsCompte compte={compte("invite")} estMoi={false} />)).toEqual(["Modifier"]);
  });

  it("Actif : Modifier, Désactiver", () => {
    expect(boutons(<ActionsCompte compte={compte("actif")} estMoi={false} />)).toEqual([
      "Modifier",
      "Désactiver",
    ]);
  });

  it("Désactivé : Modifier, Réactiver", () => {
    expect(boutons(<ActionsCompte compte={compte("desactive")} estMoi={false} />)).toEqual([
      "Modifier",
      "Réactiver",
    ]);
  });

  it("ma propre ligne (active) : Modifier seulement, jamais Désactiver", () => {
    expect(boutons(<ActionsCompte compte={compte("actif")} estMoi />)).toEqual(["Modifier"]);
  });

  it("le nom du compte complète le nom accessible du bouton", () => {
    const html = renderToStaticMarkup(
      <FournisseurToasts>
        <ActionsCompte compte={compte("actif")} estMoi={false} />
      </FournisseurToasts>,
    );
    expect(html).toContain('aria-label="Actions pour Léo Martin"');
    expect(html).toContain('<span class="sr-only"> Léo Martin</span>');
  });

  it("la liste affiche les actions dans le tableau et dans les cartes", () => {
    const moi: Compte = { ...compte("actif"), id: "moi", nom: "Claire Roux", email: "claire@example.com" };
    const html = renderToStaticMarkup(
      <FournisseurToasts>
        <ListeComptes comptes={[moi, compte("actif", 2)]} idConnecte="moi" />
      </FournisseurToasts>,
    );
    expect(html.match(/aria-label="Actions pour Léo Martin"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Actions pour Claire Roux"/g)).toHaveLength(2);
    // Désactiver : seulement sur la ligne de Léo (tableau et carte).
    expect(html.match(/>Désactiver</g)).toHaveLength(2);
  });
});

describe("fenêtre « Modifier » — erreurs de rôle", () => {
  const DERNIER = MESSAGES_ERREUR.DERNIER_ADMIN;

  it("champ Rôle affiché : l'erreur reste sous le champ", () => {
    expect(repartirErreursModification({ role: DERNIER }, true)).toEqual({
      champs: { role: DERNIER },
      bandeau: null,
    });
  });

  it("ma propre ligne (sans champ Rôle) : l'erreur de rôle va dans le bandeau", () => {
    expect(repartirErreursModification({ role: MESSAGES_ERREUR.PROPRE_COMPTE }, false)).toEqual({
      champs: {},
      bandeau: MESSAGES_ERREUR.PROPRE_COMPTE,
    });
    expect(repartirErreursModification({ nom: "Nom vide.", role: DERNIER }, false)).toEqual({
      champs: { nom: "Nom vide." },
      bandeau: DERNIER,
    });
  });

  it("erreur du nom seule : sous le champ, pas de bandeau", () => {
    expect(repartirErreursModification({ nom: "Nom vide." }, false)).toEqual({
      champs: { nom: "Nom vide." },
      bandeau: null,
    });
  });
});

describe("fenêtre « Désactiver »", () => {
  it("annonce les demandes en cours : aucune, une (singulier), plusieurs", () => {
    expect(texteDesactivation("Léo Martin", 0)).toEqual(["Léo Martin ne pourra plus se connecter."]);
    expect(texteDesactivation("Léo Martin", 1)).toEqual([
      "Léo Martin ne pourra plus se connecter.",
      "Sa demande en cours reviendra en Nouvelle, sans responsable.",
    ]);
    expect(texteDesactivation("Léo Martin", 2)).toEqual([
      "Léo Martin ne pourra plus se connecter.",
      "Ses 2 demandes en cours reviendront en Nouvelle, sans responsable.",
    ]);
  });
});

describe("schéma « Modifier »", () => {
  it("nom nettoyé, rôle fermé", () => {
    expect(verifierModification({ id: ID, nom: "  Léo Martin ", role: "administrateur" })).toEqual({
      ok: true,
      donnees: { id: ID, nom: "Léo Martin", role: "administrateur" },
    });
  });

  it("nom vide et rôle inconnu : un message par champ", () => {
    const resultat = verifierModification({ id: ID, nom: "   ", role: "chef" });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(Object.keys(resultat.erreurs).sort()).toEqual(["nom", "role"]);
    expect(resultat.idInvalide).toBe(false);
  });

  it("identifiant mal formé : refusé", () => {
    const resultat = verifierModification({ id: "abc", nom: "Léo", role: "collaborateur" });
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.idInvalide).toBe(true);
  });
});

describe("lecture de lister_comptes", () => {
  const LIGNE = { id: ID, nom: "Léo", email: "l@x.fr", role: "collaborateur", etat: "actif" };

  it("demandes_en_cours lu dans chaque compte", () => {
    expect(lireReponseComptes([{ ...LIGNE, demandes_en_cours: 2 }])?.[0].demandesEnCours).toBe(2);
  });

  it.each([[undefined], [-1], [1.5], ["2"]])("demandes_en_cours %j : réponse refusée", (valeur) => {
    expect(lireReponseComptes([{ ...LIGNE, demandes_en_cours: valeur }])).toBeNull();
  });
});

describe("textes", () => {
  it("nouveaux codes et toasts", () => {
    expect(MESSAGES_ERREUR.DERNIER_ADMIN).toBe("Il doit rester au moins un administrateur actif.");
    expect(MESSAGES_ERREUR.COMPTE_DESACTIVE).toBe("Cette adresse appartient à un compte désactivé.");
    expect(MESSAGES_COMPTE.modifie).toBe("Compte modifié.");
  });
});
