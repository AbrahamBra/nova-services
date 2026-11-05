import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Story 2.2 — action serveur `ajouterNote` avec un client Supabase simulé
// (la base réelle est testée dans notes.test.ts) : session (jamais la clé
// secrète), schéma unique partagé avec l'écran (AD-8), texte refusé sans
// appel à la base, résultat sans `detail`, rafraîchissement du détail.
// Et le bloc Notes : liste (auteur · date et heure de Paris, texte échappé,
// retours à la ligne), état vide, zone libellée, compteur, bouton.

const simulation = vi.hoisted(() => ({
  rpc: null as null | ((fonction: string, parametres?: Record<string, unknown>) => unknown),
  rafraichissements: 0,
  clientService: 0,
}));

vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => {
    if (!simulation.rpc) throw new Error("variables d'environnement manquantes");
    return { rpc: simulation.rpc };
  },
}));

vi.mock("@/lib/server/supabase-service", () => ({
  creerClientService: () => {
    simulation.clientService++;
    throw new Error("la clé secrète ne doit pas servir au traitement");
  },
}));

vi.mock("next/cache", () => ({
  refresh: () => {
    simulation.rafraichissements++;
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: () => {
    throw new Error("REDIRECTION");
  },
}));

import { ajouterNote } from "@/lib/actions/demandes";
import {
  FormulaireNote,
  LIBELLE_ZONE_NOTE,
  ListeNotes,
  MESSAGE_NOTE_AJOUTEE,
  enteteNote,
} from "@/components/nova/notes";
import { FournisseurToasts } from "@/components/nova/toasts";
import { lireNote, type NoteInterne } from "@/lib/detail-demande";
import { messageErreur } from "@/lib/erreurs";
import { ESPACE_INSECABLE } from "@/lib/format";
import {
  LONGUEUR_MAX_NOTE,
  MESSAGES_NOTE,
  schemaTexteNote,
  verifierTexteNote,
} from "@/lib/schemas/traitement";

const DEMANDE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KARIM = "0b6c1f7e-0000-4000-8000-000000000001";

afterEach(() => {
  simulation.rpc = null;
  simulation.rafraichissements = 0;
  simulation.clientService = 0;
  vi.restoreAllMocks();
});

describe("schéma du texte d'une note (écran et action)", () => {
  it("espaces de début et de fin retirés, retours à la ligne intérieurs conservés", () => {
    expect(verifierTexteNote("  Ligne 1\nLigne 2 \n")).toEqual({ ok: true, texte: "Ligne 1\nLigne 2" });
  });

  it.each([
    ["vide", ""],
    ["espaces seulement", "   \n\t "],
    ["espaces Unicode seulement", "\u00a0\u3000\ufeff\u200b\u2028"],
    ["absent", undefined],
    ["pas un texte", 42],
  ])("%s : « Écrivez le texte de la note. »", (_cas, saisie) => {
    expect(verifierTexteNote(saisie)).toEqual({ ok: false, message: "Écrivez le texte de la note." });
  });

  it("un caractère visible entouré d'espaces Unicode : accepté", () => {
    expect(verifierTexteNote("\u200bok\u200b")).toMatchObject({ ok: true });
  });

  it("2 000 caractères acceptés (emoji compté pour 1), 2 001 refusés", () => {
    expect(LONGUEUR_MAX_NOTE).toBe(2000);
    expect(schemaTexteNote.safeParse("🙂".repeat(2000)).success).toBe(true);
    expect(verifierTexteNote("a".repeat(2001))).toEqual({ ok: false, message: MESSAGES_NOTE.long });
    expect(MESSAGES_NOTE.long).toBe(`La note ne doit pas dépasser 2${ESPACE_INSECABLE}000 caractères.`);
  });

  it("caractère nul refusé", () => {
    expect(verifierTexteNote(`a${String.fromCharCode(0)}b`)).toEqual({
      ok: false,
      message: MESSAGES_NOTE.caractereInterdit,
    });
  });
});

describe("action ajouterNote", () => {
  it("réussite : appelle ajouter_note avec la session et le texte nettoyé, rafraîchit", async () => {
    const appels: { fonction: string; parametres?: Record<string, unknown> }[] = [];
    simulation.rpc = (fonction, parametres) => {
      appels.push({ fonction, parametres });
      return Promise.resolve({
        data: { id: 12, demande_id: DEMANDE, auteur_id: KARIM, cree_le: "2026-11-03T08:16:00Z" },
        error: null,
      });
    };

    expect(await ajouterNote(DEMANDE, "  Rappelée à 9 h \n")).toEqual({
      ok: true,
      donnees: { noteId: "12" },
    });
    expect(appels).toEqual([
      { fonction: "ajouter_note", parametres: { p_demande_id: DEMANDE, p_texte: "Rappelée à 9 h" } },
    ]);
    expect(simulation.rafraichissements).toBe(1);
    expect(simulation.clientService).toBe(0);
  });

  it.each([
    ["vide", "", MESSAGES_NOTE.vide],
    ["espaces seulement", "  \n ", MESSAGES_NOTE.vide],
    ["trop longue", "a".repeat(2001), MESSAGES_NOTE.long],
    ["pas un texte", { texte: "x" }, MESSAGES_NOTE.vide],
  ])("texte %s : DONNEES_INVALIDES sans appeler la base", async (_cas, texte, message) => {
    let appels = 0;
    simulation.rpc = () => {
      appels++;
      return Promise.resolve({ data: null, error: null });
    };
    expect(await ajouterNote(DEMANDE, texte)).toEqual({ ok: false, code: "DONNEES_INVALIDES", message });
    expect(appels).toBe(0);
    expect(simulation.rafraichissements).toBe(0);
  });

  it("identifiant mal formé : refusé sans appeler la base", async () => {
    let appels = 0;
    simulation.rpc = () => {
      appels++;
      return Promise.resolve({ data: null, error: null });
    };
    for (const valeur of ["abc", "", null, 42, `${DEMANDE}' or 1=1`]) {
      expect(await ajouterNote(valeur, "Note"), String(valeur)).toMatchObject({
        ok: false,
        code: "DEMANDE_INTROUVABLE",
      });
    }
    expect(appels).toBe(0);
  });

  it.each(["DEMANDE_INTROUVABLE", "DROIT_INSUFFISANT"] as const)(
    "%s : message de lib/erreurs.ts, sans détail, détail rafraîchi",
    async (code) => {
      simulation.rpc = () =>
        Promise.resolve({ data: null, error: { code: "P0001", message: code, details: '{"x": 1}' } });
      const resultat = await ajouterNote(DEMANDE, "Note");
      expect(resultat).toEqual({ ok: false, code, message: messageErreur(code) });
      expect(resultat).not.toHaveProperty("detail");
      expect(simulation.rafraichissements).toBe(1);
    },
  );

  it("DONNEES_INVALIDES renvoyé par la base : message du champ (pas le message générique), rien n'est rafraîchi", async () => {
    simulation.rpc = () =>
      Promise.resolve({ data: null, error: { code: "P0001", message: "DONNEES_INVALIDES" } });
    expect(await ajouterNote(DEMANDE, "Note")).toEqual({
      ok: false,
      code: "DONNEES_INVALIDES",
      message: MESSAGES_NOTE.vide,
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("base injoignable : ERREUR_INATTENDUE, rien n'est rafraîchi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.reject(new Error("fetch failed"));
    expect(await ajouterNote(DEMANDE, "Note")).toEqual({
      ok: false,
      code: "ERREUR_INATTENDUE",
      message: messageErreur("ERREUR_INATTENDUE"),
    });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("client serveur indisponible : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = null;
    expect(await ajouterNote(DEMANDE, "Note")).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });

  it("réponse inattendue de la base : ERREUR_INATTENDUE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simulation.rpc = () => Promise.resolve({ data: { autre: 1 }, error: null });
    expect(await ajouterNote(DEMANDE, "Note")).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
    expect(simulation.rafraichissements).toBe(0);
  });
});

function note(modifs: Partial<NoteInterne> = {}): NoteInterne {
  return {
    id: "1",
    creeLe: "2026-11-03T08:16:00Z", // 09:16 à Paris
    auteurId: KARIM,
    texte: "Rappelée à 9 h, intervention à distance prévue.",
    ...modifs,
  };
}

const NOMS = { [KARIM]: "Karim Benali" };

describe("bloc Notes — liste", () => {
  it("auteur · date et heure de Paris : « Karim Benali · 03/11/2026 à 09:16 »", () => {
    expect(enteteNote(note(), NOMS)).toBe("Karim Benali · 03/11/2026 à 09:16");
    expect(enteteNote(note({ auteurId: "inconnu" }), NOMS)).toBe(
      "Membre de l'équipe · 03/11/2026 à 09:16",
    );
  });

  it("de la plus ancienne à la plus récente, dans l'ordre reçu", () => {
    const html = renderToStaticMarkup(
      createElement(ListeNotes, {
        nomsMembres: NOMS,
        notes: [note({ id: "1", texte: "Première" }), note({ id: "2", texte: "Seconde" })],
      }),
    );
    expect(html.indexOf("Première")).toBeLessThan(html.indexOf("Seconde"));
    expect(html.match(/data-testid="note"/g)).toHaveLength(2);
  });

  it("texte piégé : affiché tel quel (échappé), retours à la ligne conservés", () => {
    const html = renderToStaticMarkup(
      createElement(ListeNotes, {
        nomsMembres: NOMS,
        notes: [note({ texte: "Ligne 1\n<script>alert('note')</script>\n<b>gras</b>" })],
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>gras");
    expect(html).toContain("&lt;script&gt;alert(&#x27;note&#x27;)&lt;/script&gt;");
    expect(html).toContain("Ligne 1\n&lt;script&gt;");
    expect(html).toMatch(/data-testid="texte-note" class="[^"]*whitespace-pre-wrap/);
  });

  it("sans note : « Aucune note interne. »", () => {
    const html = renderToStaticMarkup(createElement(ListeNotes, { nomsMembres: NOMS, notes: [] }));
    expect(html).toContain("Aucune note interne.");
    expect(html).not.toContain('data-testid="note"');
  });

  it("notes illisibles : signalées, sans « Aucune note interne. »", () => {
    const html = renderToStaticMarkup(
      createElement(ListeNotes, { nomsMembres: NOMS, notes: [], notesIllisibles: 2 }),
    );
    expect(html).toContain("2 notes illisibles");
    expect(html).not.toContain("Aucune note interne.");
  });
});

describe("bloc Notes — zone d'ajout", () => {
  const html = renderToStaticMarkup(
    createElement(FournisseurToasts, null, createElement(FormulaireNote, { demandeId: DEMANDE })),
  );

  it("zone libellée « Ajouter une note (visible uniquement par l'équipe) »", () => {
    expect(LIBELLE_ZONE_NOTE).toBe("Ajouter une note (visible uniquement par l'équipe)");
    const id = /<label[^>]*for="([^"]+)"[^>]*>Ajouter une note \(visible uniquement par l&#x27;équipe\)<\/label>/.exec(
      html,
    )?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<textarea`);
    expect(html).toMatch(new RegExp(`<textarea[^>]*id="${id}"`));
  });

  it("compteur « 0 / 2 000 », relié à la zone", () => {
    expect(html).toContain(`0 / 2${ESPACE_INSECABLE}000`);
    const compteur = /<p id="([^"]+)" data-testid="compteur-note"/.exec(html)?.[1];
    expect(compteur).toBeTruthy();
    expect(html).toMatch(new RegExp(`<textarea[^>]*aria-describedby="${compteur}"`));
  });

  it("bouton « Ajouter la note », aucun bouton pour modifier ou supprimer", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Ajouter la note<\/button>/);
    expect(html).not.toMatch(/Modifier|Supprimer/);
  });

  it("message de réussite", () => {
    expect(MESSAGE_NOTE_AJOUTEE).toBe("Note ajoutée.");
  });
});

describe("lireNote — note mal formée", () => {
  const TEXTE = "Texte confidentiel de la note";
  const valide = { id: 7, auteur_id: KARIM, texte: TEXTE, cree_le: "2026-11-03T08:16:00Z" };

  it("garde une note valide (identifiant numérique converti en texte)", () => {
    expect(lireNote(valide)).toEqual({
      id: "7",
      auteurId: KARIM,
      texte: TEXTE,
      creeLe: "2026-11-03T08:16:00Z",
    });
  });

  it("écarte une forme ou un champ invalide, sans jamais écrire le texte au journal", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(lireNote(null)).toBeNull();
    expect(lireNote("note")).toBeNull();
    expect(lireNote({ ...valide, id: null })).toBeNull();
    expect(lireNote({ ...valide, auteur_id: null })).toBeNull();
    expect(lireNote({ ...valide, texte: 42 })).toBeNull();
    expect(lireNote({ ...valide, cree_le: "hier" })).toBeNull();
    expect(journal).toHaveBeenCalledTimes(6);
    const messages = journal.mock.calls.map((appel) => appel.map(String).join(" "));
    expect(messages[2]).toBe("[detail] note écartée : id=inconnu champ=id");
    expect(messages[3]).toBe("[detail] note écartée : id=7 champ=auteur_id");
    expect(messages[5]).toBe("[detail] note écartée : id=7 champ=cree_le");
    for (const message of messages) expect(message).not.toContain(TEXTE);
  });
});

describe("bloc Notes — date de la note", () => {
  it("dans un <time dateTime=…>", () => {
    const html = renderToStaticMarkup(
      createElement(ListeNotes, { nomsMembres: NOMS, notes: [note()] }),
    );
    expect(html).toContain('Karim Benali · <time dateTime="2026-11-03T08:16:00Z">03/11/2026 à 09:16</time>');
  });
});
