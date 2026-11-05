import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Historique, phraseLigneHistorique } from "@/components/nova/historique";
import type { LigneHistorique } from "@/lib/detail-demande";
import { PHRASES_HISTORIQUE, TYPES_HISTORIQUE, type TypeHistorique } from "@/lib/domaine";

// Story 1.6 — composant unique de l'historique (AD-19, UX-DR11) : chacun des
// 10 types a sa phrase dans lib/domaine.ts ; les codes (statut, priorité,
// canal) et les identifiants (membres, catégories) sont traduits.

const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";
const NADIA = "0b6c1f7e-0000-4000-8000-000000000002";
const TECHNIQUE = "0b6c1f7e-0000-4000-8000-0000000000c1";
const AUTRE = "0b6c1f7e-0000-4000-8000-0000000000c2";

const noms = {
  nomsMembres: { [KARIM]: "Karim Benali", [NADIA]: "Nadia Morel" },
  nomsCategories: { [TECHNIQUE]: "Problème technique", [AUTRE]: "Autre" },
};

function ligne(type: TypeHistorique, modifs: Partial<LigneHistorique> = {}): LigneHistorique {
  return {
    id: `${type}-1`,
    creeLe: "2026-11-03T07:47:00Z",
    auteurType: "membre",
    auteurId: KARIM,
    type,
    ancienneValeur: null,
    nouvelleValeur: null,
    ...modifs,
  };
}

function texte(l: LigneHistorique): string {
  return phraseLigneHistorique(l, noms);
}

describe("historique — phrases des 10 types", () => {
  it("chaque type de l'AD-19 a sa phrase dans lib/domaine.ts", () => {
    expect(TYPES_HISTORIQUE).toHaveLength(10);
    expect(Object.keys(PHRASES_HISTORIQUE).sort()).toEqual([...TYPES_HISTORIQUE].sort());
  });

  const attendus: [LigneHistorique, string][] = [
    [
      ligne("creation", { auteurType: "demandeur", auteurId: null, nouvelleValeur: "formulaire" }),
      "Demandeur (formulaire) a créé la demande",
    ],
    [
      ligne("creation", { auteurId: NADIA, nouvelleValeur: "telephone" }),
      "Saisie par Nadia Morel (téléphone)",
    ],
    // Story 2.1 : une seule ligne, auteur au milieu de la phrase.
    [
      ligne("prise_en_charge", { ancienneValeur: "nouvelle", nouvelleValeur: "en_cours" }),
      "Prise en charge par Karim Benali : Nouvelle → En cours",
    ],
    [
      ligne("attribution", { nouvelleValeur: NADIA }),
      "Karim Benali a attribué la demande à Nadia Morel",
    ],
    [ligne("liberation", { ancienneValeur: NADIA }), "Karim Benali a libéré la demande"],
    [
      ligne("changement_statut", { ancienneValeur: "nouvelle", nouvelleValeur: "en_cours" }),
      "Karim Benali a changé le statut : Nouvelle → En cours",
    ],
    [
      ligne("classement_sans_suite", { ancienneValeur: "nouvelle", nouvelleValeur: "traitee" }),
      "Classée sans suite par Karim Benali : Nouvelle → Traitée",
    ],
    [
      ligne("changement_priorite", { ancienneValeur: "normale", nouvelleValeur: "haute" }),
      "Karim Benali a changé la priorité : Normale → Haute",
    ],
    [
      ligne("changement_categorie", { ancienneValeur: AUTRE, nouvelleValeur: TECHNIQUE }),
      "Karim Benali a changé la catégorie : Autre → Problème technique",
    ],
    [ligne("note_ajoutee"), "Karim Benali a ajouté une note interne"],
    [
      ligne("retour_nouvelle", { ancienneValeur: "en_cours", nouvelleValeur: "nouvelle" }),
      "Karim Benali a remis la demande en Nouvelle",
    ],
  ];

  it.each(attendus)("%#", (l, phrase) => {
    expect(texte(l)).toBe(phrase);
  });

  it("tous les types sont couverts par les cas ci-dessus", () => {
    expect(new Set(attendus.map(([l]) => l.type))).toEqual(new Set(TYPES_HISTORIQUE));
  });

  it("membre ou valeur inconnus : texte neutre, jamais l'identifiant brut", () => {
    const inconnu = "0b6c1f7e-0000-4000-8000-00000000ffff";
    expect(texte(ligne("note_ajoutee", { auteurId: inconnu }))).toBe(
      "Membre de l'équipe a ajouté une note interne",
    );
    expect(
      texte(ligne("changement_statut", { ancienneValeur: "archivee", nouvelleValeur: "traitee" })),
    ).toBe("Karim Benali a changé le statut : ? → Traitée");
    expect(texte(ligne("attribution", { nouvelleValeur: inconnu }))).not.toContain(inconnu);
  });

  it("saisie interne avec un canal inconnu : « Saisie par … », sans « (?) »", () => {
    expect(texte(ligne("creation", { auteurId: NADIA, nouvelleValeur: "fax" }))).toBe(
      "Saisie par Nadia Morel",
    );
  });
});

describe("composant Historique", () => {
  it("affiche date et heure de Paris, auteur en gras, dans l'ordre reçu", () => {
    const html = renderToStaticMarkup(
      <Historique
        {...noms}
        lignes={[
          ligne("creation", { auteurType: "demandeur", auteurId: null, nouvelleValeur: "formulaire" }),
          ligne("changement_priorite", {
            id: "2",
            creeLe: "2026-11-03T08:14:00Z",
            ancienneValeur: "normale",
            nouvelleValeur: "haute",
          }),
        ]}
      />,
    );
    expect(html).toContain("03/11/2026 à 08:47");
    expect(html).toContain("03/11/2026 à 09:14");
    expect(html).toContain("<b class=\"font-semibold\">Demandeur (formulaire)</b> a créé la demande");
    expect(html).toContain("<b class=\"font-semibold\">Karim Benali</b> a changé la priorité : Normale → Haute");
    expect(html.indexOf("a créé la demande")).toBeLessThan(html.indexOf("a changé la priorité"));
  });

  it("prise en charge : « Prise en charge par <b>auteur</b> : Nouvelle → En cours »", () => {
    const html = renderToStaticMarkup(
      <Historique
        {...noms}
        lignes={[ligne("prise_en_charge", { ancienneValeur: "nouvelle", nouvelleValeur: "en_cours" })]}
      />,
    );
    expect(html).toContain(
      "Prise en charge par <b class=\"font-semibold\">Karim Benali</b> : Nouvelle → En cours",
    );
  });

  it("prise en charge à l'ancien format (identifiant du membre) : « Prise en charge par [nom] », sans « ? »", () => {
    const ancienne = ligne("prise_en_charge", { ancienneValeur: null, nouvelleValeur: KARIM });
    expect(texte(ancienne)).toBe("Prise en charge par Karim Benali");
    const html = renderToStaticMarkup(<Historique {...noms} lignes={[ancienne]} />);
    expect(html).toContain("Prise en charge par <b class=\"font-semibold\">Karim Benali</b></span>");
    expect(html).not.toContain("?");
    expect(html).not.toContain(KARIM);
  });

  it("lignes illisibles : « 1 événement illisible » sous l'historique", () => {
    const html = renderToStaticMarkup(
      <Historique {...noms} lignesIllisibles={1} lignes={[ligne("note_ajoutee")]} />,
    );
    expect(html).toContain("a ajouté une note interne");
    expect(html).toMatch(/>1 événement illisible</);
  });

  it("sans ligne : « Aucun événement. »", () => {
    expect(renderToStaticMarkup(<Historique {...noms} lignes={[]} />)).toContain("Aucun événement.");
  });
});
