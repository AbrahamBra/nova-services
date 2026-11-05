import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { appeler } from "@/lib/server/appeler";
import { lireDetailAvec } from "@/lib/detail-demande";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 2.2 — table `notes` et `ajouter_note` sur la vraie base (migration
// 20261103000015) : cas de la matrice, ajout seulement (UPDATE, DELETE,
// TRUNCATE refusés, suppression en cascade avec la demande permise),
// historique sans le texte, lecture par les seuls membres actifs, droits.
// Base partagée : données propres `TEST-2.2-…`, effacées à la fin.

const PREFIXE = `TEST-2.2-${randomUUID().slice(0, 8)}`;
const PERMISSION_REFUSEE = "42501";

const comptes: CompteTest[] = [];
let karim: CompteTest; // collaborateur
let claire: CompteTest; // administratrice
let desactive: CompteTest;
let invite: CompteTest;
let sessionKarim: SupabaseClient;
let sessionClaire: SupabaseClient;
const sessions: SupabaseClient[] = [];

let base: Client;

beforeAll(async () => {
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.2" });
  comptes.push(karim);
  claire = await creerCompteTest({ role: "administrateur", prenom: "Claire", etiquette: "2.2" });
  comptes.push(claire);
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.2" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", prenom: "Ines", etiquette: "2.2" });
  comptes.push(invite);

  sessionKarim = await clientConnecte(karim);
  sessionClaire = await clientConnecte(claire);
  sessions.push(sessionKarim, sessionClaire);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  // Demandes d'abord : notes et historique (qui citent les comptes) partent en cascade.
  let demandesNettoyees = !base;
  try {
    if (base) {
      await supprimerDemandesTest(base, PREFIXE);
      demandesNettoyees = true;
    }
  } finally {
    await base?.end().catch(() => {});
    for (const session of sessions) await session.auth.signOut({ scope: "local" }).catch(() => {});
    if (demandesNettoyees) {
      await supprimerComptesTest(comptes);
    } else {
      console.error(`Demandes ${PREFIXE} non nettoyées : comptes de test conservés.`);
    }
  }
}, 60_000);

type Note = { id: string; auteur_id: string; texte: string; cree_le: Date };

async function notes(d: DemandeTest): Promise<Note[]> {
  const { rows } = await base.query<Note>(
    "select id::text, auteur_id, texte, cree_le from public.notes where demande_id = $1 order by cree_le, id",
    [d.id],
  );
  return rows;
}

type LigneHistorique = {
  type: string;
  auteur_type: string;
  auteur_id: string | null;
  ancienne_valeur: string | null;
  nouvelle_valeur: string | null;
  cree_le: Date;
};

async function historique(d: DemandeTest): Promise<LigneHistorique[]> {
  const { rows } = await base.query<LigneHistorique>(
    `select type, auteur_type, auteur_id, ancienne_valeur, nouvelle_valeur, cree_le
       from public.historique where demande_id = $1 order by cree_le, id`,
    [d.id],
  );
  return rows;
}

function ajouter(client: SupabaseClient, id: string, texte: unknown) {
  return client.rpc("ajouter_note", { p_demande_id: id, p_texte: texte });
}

/** Exécute une requête directe dans une transaction annulée ; renvoie l'erreur éventuelle. */
async function essayer(sql: string, valeurs: unknown[] = []): Promise<Error | null> {
  await base.query("begin");
  try {
    await base.query(sql, valeurs);
    return null;
  } catch (erreur) {
    return erreur as Error;
  } finally {
    await base.query("rollback");
  }
}

describe("ajouter_note — réussite", () => {
  it("collaborateur : note enregistrée avec l'auteur et la date, une ligne d'historique sans le texte", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const texte = "Rappelée à 9 h";
    const { data, error } = await ajouter(sessionKarim, d.id, texte);
    expect(error).toBeNull();
    expect(data).toMatchObject({ demande_id: d.id, auteur_id: karim.id });
    expect(typeof data.id).toBe("number");
    expect(Number.isNaN(Date.parse(data.cree_le))).toBe(false);

    const enregistrees = await notes(d);
    expect(enregistrees).toHaveLength(1);
    expect(enregistrees[0]).toMatchObject({ id: String(data.id), auteur_id: karim.id, texte });

    const lignes = await historique(d);
    expect(lignes.map((l) => l.type)).toEqual(["creation", "note_ajoutee"]);
    expect(lignes[1]).toMatchObject({
      auteur_type: "membre",
      auteur_id: karim.id,
      ancienne_valeur: null,
      nouvelle_valeur: null,
    });
    // Note et ligne d'historique écrites ensemble (même transaction, même date).
    expect(lignes[1].cree_le.getTime()).toBe(enregistrees[0].cree_le.getTime());
    // Le texte n'est nulle part dans l'historique (AD-19).
    const { rows } = await base.query<{ n: number }>(
      `select count(*)::int as n from public.historique h
        where h.demande_id = $1 and (h::text like '%' || $2 || '%')`,
      [d.id, texte],
    );
    expect(rows[0].n).toBe(0);
  });

  it("espaces de début et de fin retirés, retours à la ligne et code conservés tels quels", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const texte = "Ligne 1\n<script>alert('note')</script>\n\nLigne 4";
    const { error } = await ajouter(sessionClaire, d.id, `  \n${texte}\t \n`);
    expect(error).toBeNull();
    expect((await notes(d)).map((n) => n.texte)).toEqual([texte]);
  });

  it("2 000 caractères exactement : acceptée (emoji compté pour 1)", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const texte = "🙂".repeat(2000);
    const { error } = await ajouter(sessionKarim, d.id, texte);
    expect(error).toBeNull();
    expect((await notes(d))[0].texte).toBe(texte);
  });

  it.each(["nouvelle", "en_cours", "traitee"] as const)(
    "quel que soit le statut (%s) : acceptée, statut inchangé",
    async (statut) => {
      const d = await creerDemandeTest(base, PREFIXE, {
        statut,
        responsableId: statut === "en_cours" ? karim.id : null,
      });
      const { error } = await ajouter(sessionKarim, d.id, "Note");
      expect(error).toBeNull();
      const { rows } = await base.query<{ statut: string }>(
        "select statut from public.demandes where id = $1",
        [d.id],
      );
      expect(rows[0].statut).toBe(statut);
      expect(await notes(d)).toHaveLength(1);
    },
  );

  it("plusieurs notes : de la plus ancienne à la plus récente, une ligne d'historique chacune", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    for (const texte of ["Première", "Deuxième", "Troisième"]) {
      const { error } = await ajouter(sessionKarim, d.id, texte);
      expect(error).toBeNull();
    }
    expect((await notes(d)).map((n) => n.texte)).toEqual(["Première", "Deuxième", "Troisième"]);
    expect((await historique(d)).filter((l) => l.type === "note_ajoutee")).toHaveLength(3);
  });

  it("par appeler() avec la session : { ok: true, donnees }", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const resultat = await appeler<{ id: number }>(sessionKarim, "ajouter_note", {
      p_demande_id: d.id,
      p_texte: "Note",
    });
    expect(resultat).toMatchObject({ ok: true, donnees: { demande_id: d.id, auteur_id: karim.id } });
  });
});

describe("ajouter_note — refus", () => {
  it.each([
    ["vide", ""],
    ["espaces seulement", "  \n\t  "],
    ["espaces Unicode seulement", "\u00a0\u3000\ufeff\u200b\u2028 \u00a0"],
    ["absent (null)", null],
    ["2 001 caractères", "a".repeat(2001)],
    ["2 001 caractères après retrait des espaces", ` ${"a".repeat(2001)} `],
  ])("texte %s : DONNEES_INVALIDES, rien d'enregistré", async (_cas, texte) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await ajouter(sessionKarim, d.id, texte);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DONNEES_INVALIDES");
    expect(await notes(d)).toEqual([]);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it("contrainte CHECK : une note faite d'espaces Unicode est refusée même en écriture directe", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const inserer = "insert into public.notes (demande_id, auteur_id, texte) values ($1, $2, $3)";
    for (const texte of ["\u00a0", "\u3000\u3000", "\ufeff", "\u200b\u00a0"]) {
      const erreur = (await essayer(inserer, [d.id, karim.id, texte])) as { code?: string } | null;
      expect(erreur?.code, JSON.stringify(texte)).toBe("23514");
    }
    // Un caractère visible entouré d'espaces Unicode reste accepté.
    expect(await essayer(inserer, [d.id, karim.id, "\u00a0ok\u3000"])).toBeNull();
  });

  it("demande inconnue : DEMANDE_INTROUVABLE, rien d'enregistré", async () => {
    const inconnue = randomUUID();
    const { error } = await ajouter(sessionKarim, inconnue, "Note");
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
    const { rows } = await base.query<{ n: number }>(
      "select count(*)::int as n from public.notes where demande_id = $1",
      [inconnue],
    );
    expect(rows[0].n).toBe(0);
  });

  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ])("compte %s : DROIT_INSUFFISANT, rien d'enregistré", async (_nom, compte) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const client = await clientConnecte(compte());
    try {
      const { error } = await ajouter(client, d.id, "Note");
      expect(error?.code).toBe("P0001");
      expect(error?.message).toBe("DROIT_INSUFFISANT");
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    expect(await notes(d)).toEqual([]);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it("visiteur (clé publiable sans session) : droit refusé", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await ajouter(clientPubliableTest(), d.id, "Note");
    expect(error?.code).toBe(PERMISSION_REFUSEE);
    expect(await notes(d)).toEqual([]);
  });

  it("clé secrète : droit refusé", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await ajouter(clientServiceTest(), d.id, "Note");
    expect(error?.code).toBe(PERMISSION_REFUSEE);
    expect(await notes(d)).toEqual([]);
  });
});

describe("notes — ajout seulement (AD-5)", () => {
  let d: DemandeTest;

  beforeAll(async () => {
    d = await creerDemandeTest(base, PREFIXE);
    const { error } = await ajouter(sessionKarim, d.id, "Note à protéger");
    expect(error).toBeNull();
  });

  it("UPDATE direct (propriétaire de la base) : refusé par le déclencheur", async () => {
    const erreur = await essayer("update public.notes set texte = 'Modifiée' where demande_id = $1", [d.id]);
    expect(erreur?.message).toMatch(/ne se modifient pas/);
    expect((await notes(d)).map((n) => n.texte)).toEqual(["Note à protéger"]);
  });

  it("DELETE direct (propriétaire de la base) : refusé par le déclencheur", async () => {
    const erreur = await essayer("delete from public.notes where demande_id = $1", [d.id]);
    expect(erreur?.message).toMatch(/ne se suppriment pas/);
    expect(await notes(d)).toHaveLength(1);
  });

  it("TRUNCATE direct (propriétaire de la base) : refusé par le déclencheur", async () => {
    const erreur = await essayer("truncate public.notes");
    expect(erreur?.message).toMatch(/ne se suppriment pas/);
    expect(await notes(d)).toHaveLength(1);
  });

  it.each([
    ["membre actif", () => sessionKarim],
    ["clé secrète", () => clientServiceTest()],
  ])("%s par l'API : aucune écriture directe (insert, update, delete)", async (_nom, client) => {
    const api = client();
    const insertion = await api
      .from("notes")
      .insert({ demande_id: d.id, auteur_id: karim.id, texte: "Directe" });
    expect(insertion.error?.code).toBe(PERMISSION_REFUSEE);
    const modification = await api.from("notes").update({ texte: "Modifiée" }).eq("demande_id", d.id);
    expect(modification.error?.code).toBe(PERMISSION_REFUSEE);
    const suppression = await api.from("notes").delete().eq("demande_id", d.id);
    expect(suppression.error?.code).toBe(PERMISSION_REFUSEE);
    expect((await notes(d)).map((n) => n.texte)).toEqual(["Note à protéger"]);
  });

  it("suppression de la demande (effacement complet) : ses notes partent en cascade", async () => {
    const effacee = await creerDemandeTest(base, PREFIXE);
    const { error } = await ajouter(sessionKarim, effacee.id, "Note de la demande effacée");
    expect(error).toBeNull();
    await base.query("delete from public.demandes where id = $1", [effacee.id]);
    expect(await notes(effacee)).toEqual([]);
    // Les notes des autres demandes ne bougent pas.
    expect(await notes(d)).toHaveLength(1);
  });

  it("aucune fonction ne modifie ni ne supprime une note", async () => {
    const { rows } = await base.query<{ nom: string }>(
      `select n.nspname || '.' || p.proname as nom
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'prive')
          and p.prokind = 'f'
          and pg_get_functiondef(p.oid) ~* '(update|delete\\s+from|truncate)\\s+(only\\s+)?public\\.notes'`,
    );
    expect(rows.map((r) => r.nom)).toEqual([]);
  });
});

describe("notes — lecture", () => {
  let d: DemandeTest;

  beforeAll(async () => {
    d = await creerDemandeTest(base, PREFIXE);
    const { error } = await ajouter(sessionClaire, d.id, "Note lisible par l'équipe");
    expect(error).toBeNull();
  });

  it("membre actif : lit la note (toutes les colonnes)", async () => {
    const { data, error } = await sessionKarim
      .from("notes")
      .select("id, demande_id, auteur_id, texte, cree_le")
      .eq("demande_id", d.id);
    expect(error).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({ demande_id: d.id, auteur_id: claire.id, texte: "Note lisible par l'équipe" }),
    ]);
  });

  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ])("compte %s : aucune note lisible", async (_nom, compte) => {
    const client = await clientConnecte(compte());
    try {
      const { data, error } = await client.from("notes").select("id, texte").eq("demande_id", d.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
  });

  it("visiteur : droit refusé", async () => {
    const { error } = await clientPubliableTest().from("notes").select("id, texte").eq("demande_id", d.id);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
  });

  it("clé secrète : droit refusé", async () => {
    const { error } = await clientServiceTest().from("notes").select("id, texte").eq("demande_id", d.id);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
  });

  it("lireDetailAvec avec la session : notes, nom de leur auteur et ligne d'historique", async () => {
    const resultat = await lireDetailAvec(sessionKarim, d.reference);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok || resultat.donnees === null) throw new Error("détail attendu");
    const detail = resultat.donnees;
    expect(detail.notes).toEqual([
      expect.objectContaining({ auteurId: claire.id, texte: "Note lisible par l'équipe" }),
    ]);
    expect(detail.notesIllisibles).toBe(0);
    expect(detail.nomsMembres[claire.id]).toBe(claire.nom);
    expect(detail.historique.map((l) => l.type)).toEqual(["creation", "note_ajoutee"]);
  });

  it("lireDetailAvec, demande sans note : liste vide", async () => {
    const vide = await creerDemandeTest(base, PREFIXE);
    const resultat = await lireDetailAvec(sessionKarim, vide.reference);
    expect(resultat).toMatchObject({ ok: true, donnees: { notes: [], notesIllisibles: 0 } });
  });
});

describe("ajouter_note — droits EXECUTE", () => {
  it("accordée à authenticated seulement dans le catalogue", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r as role,
              has_function_privilege(r, 'public.ajouter_note(uuid, text)', 'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(Object.fromEntries(rows.map((l) => [l.role, l.peut]))).toEqual({
      anon: false,
      authenticated: true,
      service_role: false,
    });
  });

  it("SECURITY DEFINER, search_path vide", async () => {
    const { rows } = await base.query<{ definer: boolean; config: string[] | null }>(
      `select p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ajouter_note'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].definer).toBe(true);
    expect(rows[0].config).toContain('search_path=""');
  });

  it("RLS activée sur notes", async () => {
    const { rows } = await base.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'public.notes'::regclass",
    );
    expect(rows[0].rls).toBe(true);
  });
});
