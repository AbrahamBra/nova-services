import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { appeler } from "@/lib/server/appeler";
import { lireDetailAvec } from "@/lib/detail-demande";
import type { Statut } from "@/lib/domaine";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 2.3 — `changer_statut` et `classer_sans_suite` sur la vraie base
// (migration 20261103000016) : cas de la matrice, dates écrites par le
// déclencheur (AD-22), une seule ligne d'historique, note du classement sans
// son texte dans l'historique, appels simultanés, droits.
// Base partagée : données propres `TEST-2.3-…`, effacées à la fin.

const PREFIXE = `TEST-2.3-${randomUUID().slice(0, 8)}`;
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
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.3" });
  comptes.push(karim);
  claire = await creerCompteTest({ role: "administrateur", prenom: "Claire", etiquette: "2.3" });
  comptes.push(claire);
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.3" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", prenom: "Ines", etiquette: "2.3" });
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

type Etat = {
  statut: Statut;
  responsable_id: string | null;
  traitee_le: Date | null;
  mis_a_jour_le: Date;
};

async function etat(d: DemandeTest): Promise<Etat> {
  const { rows } = await base.query<Etat>(
    "select statut, responsable_id, traitee_le, mis_a_jour_le from public.demandes where id = $1",
    [d.id],
  );
  return rows[0];
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

type Note = { auteur_id: string; texte: string; cree_le: Date };

async function notes(d: DemandeTest): Promise<Note[]> {
  const { rows } = await base.query<Note>(
    "select auteur_id, texte, cree_le from public.notes where demande_id = $1 order by cree_le, id",
    [d.id],
  );
  return rows;
}

function changer(client: SupabaseClient, id: string, statut: unknown) {
  return client.rpc("changer_statut", { p_demande_id: id, p_statut: statut });
}

function classer(client: SupabaseClient, id: string, note: unknown) {
  return client.rpc("classer_sans_suite", { p_demande_id: id, p_note: note });
}

describe("changer_statut — passages permis", () => {
  it("En cours → Traitée : responsable inchangé, une ligne d'historique, dates par le déclencheur", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const avant = await etat(d);
    expect(avant.traitee_le).toBeNull();

    const { data, error } = await changer(sessionKarim, d.id, "traitee");
    expect(error).toBeNull();
    expect(data).toEqual({
      id: d.id,
      statut: "traitee",
      responsable_id: karim.id,
      avait_responsable: true,
    });

    const apres = await etat(d);
    expect(apres).toMatchObject({ statut: "traitee", responsable_id: karim.id });
    expect(apres.traitee_le).not.toBeNull();
    expect(apres.mis_a_jour_le.getTime()).toBeGreaterThan(avant.mis_a_jour_le.getTime());
    // Même transaction : traitee_le et mis_a_jour_le écrites ensemble par le déclencheur.
    expect(apres.traitee_le?.getTime()).toBe(apres.mis_a_jour_le.getTime());

    const lignes = await historique(d);
    expect(lignes.map((l) => l.type)).toEqual(["creation", "changement_statut"]);
    expect(lignes[1]).toMatchObject({
      auteur_type: "membre",
      auteur_id: karim.id,
      ancienne_valeur: "en_cours",
      nouvelle_valeur: "traitee",
    });
  });

  it("tout membre actif, pas seulement le responsable", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const { error } = await changer(sessionClaire, d.id, "traitee");
    expect(error).toBeNull();
    expect(await etat(d)).toMatchObject({ statut: "traitee", responsable_id: karim.id });
    expect((await historique(d))[1]).toMatchObject({ auteur_id: claire.id });
  });

  it("Rouvrir, responsable actif : En cours, même responsable, traitee_le conservée", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    expect((await changer(sessionKarim, d.id, "traitee")).error).toBeNull();
    const traitee = await etat(d);

    const { data, error } = await changer(sessionClaire, d.id, "en_cours");
    expect(error).toBeNull();
    expect(data).toEqual({
      id: d.id,
      statut: "en_cours",
      responsable_id: karim.id,
      avait_responsable: true,
    });

    const apres = await etat(d);
    expect(apres).toMatchObject({ statut: "en_cours", responsable_id: karim.id });
    // Dernier passage à Traitée conservé (déclencheur), mise à jour avancée.
    expect(apres.traitee_le?.getTime()).toBe(traitee.traitee_le?.getTime());
    expect(apres.mis_a_jour_le.getTime()).toBeGreaterThan(traitee.mis_a_jour_le.getTime());

    const lignes = await historique(d);
    expect(lignes.map((l) => [l.type, l.ancienne_valeur, l.nouvelle_valeur])).toEqual([
      ["creation", null, "formulaire"],
      ["changement_statut", "en_cours", "traitee"],
      ["changement_statut", "traitee", "en_cours"],
    ]);
  });

  it("Rouvrir, responsable désactivé : Nouvelle sans responsable, historique Traitée → Nouvelle", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: desactive.id });
    const { data, error } = await changer(sessionKarim, d.id, "en_cours");
    expect(error).toBeNull();
    // Avait un responsable (désactivé) : message « Son responsable n'est plus actif ».
    expect(data).toEqual({ id: d.id, statut: "nouvelle", responsable_id: null, avait_responsable: true });
    expect(await etat(d)).toMatchObject({ statut: "nouvelle", responsable_id: null });
    const lignes = await historique(d);
    expect(lignes).toHaveLength(2);
    expect(lignes[1]).toMatchObject({
      type: "changement_statut",
      auteur_id: karim.id,
      ancienne_valeur: "traitee",
      nouvelle_valeur: "nouvelle",
    });
  });

  it("Rouvrir une demande Traitée sans responsable (classée sans suite) : Nouvelle", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: null });
    const { data, error } = await changer(sessionKarim, d.id, "en_cours");
    expect(error).toBeNull();
    // Aucun responsable avant : message « Elle revient en Nouvelle, sans responsable. ».
    expect(data).toMatchObject({ statut: "nouvelle", responsable_id: null, avait_responsable: false });
  });

  it("par appeler() avec la session : { ok: true, donnees }", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const resultat = await appeler(sessionKarim, "changer_statut", {
      p_demande_id: d.id,
      p_statut: "traitee",
    });
    expect(resultat).toEqual({
      ok: true,
      donnees: { id: d.id, statut: "traitee", responsable_id: karim.id, avait_responsable: true },
    });
  });
});

describe("changer_statut — passages interdits", () => {
  it.each([
    ["Nouvelle → Traitée (classement seulement)", "nouvelle", "traitee"],
    ["Nouvelle → En cours (prise en charge seulement)", "nouvelle", "en_cours"],
    ["Nouvelle → Nouvelle", "nouvelle", "nouvelle"],
    ["En cours → Nouvelle (« Libérer » seulement)", "en_cours", "nouvelle"],
    ["En cours → En cours", "en_cours", "en_cours"],
    ["Traitée → Traitée", "traitee", "traitee"],
    ["Traitée → Nouvelle", "traitee", "nouvelle"],
    ["statut inconnu", "en_cours", "fermee"],
    ["statut absent (null)", "en_cours", null],
  ] as const)("%s : PASSAGE_INTERDIT, rien ne change", async (_cas, depart, vers) => {
    const d = await creerDemandeTest(base, PREFIXE, {
      statut: depart,
      responsableId: depart === "nouvelle" ? null : karim.id,
    });
    const avant = await etat(d);
    const { error } = await changer(sessionKarim, d.id, vers);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect(await etat(d)).toEqual(avant);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it("double clic ou onglet périmé : le second « Marquer comme traitée » est refusé", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    expect((await changer(sessionKarim, d.id, "traitee")).error).toBeNull();
    const { error } = await changer(sessionClaire, d.id, "traitee");
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect((await historique(d)).filter((l) => l.type === "changement_statut")).toHaveLength(1);
  });

  it("deux sessions en même temps : une seule réussit, une seule ligne d'historique", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const resultats = await Promise.all([
      changer(sessionKarim, d.id, "traitee"),
      changer(sessionClaire, d.id, "traitee"),
    ]);
    const erreurs = resultats.map((r) => r.error?.message ?? null).sort();
    expect(erreurs).toEqual(["PASSAGE_INTERDIT", null].sort());
    expect((await etat(d)).statut).toBe("traitee");
    expect((await historique(d)).filter((l) => l.type === "changement_statut")).toHaveLength(1);
  });

  it("demande inconnue : DEMANDE_INTROUVABLE", async () => {
    const { error } = await changer(sessionKarim, randomUUID(), "traitee");
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
  });
});

describe("classer_sans_suite", () => {
  it("Nouvelle + raison : Traitée sans responsable, note visible, une seule ligne d'historique sans le texte", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    const raison = "Doublon de NOVA-2026-0001";

    const { data, error } = await classer(sessionKarim, d.id, `  ${raison}\n`);
    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: d.id,
      statut: "traitee",
      responsable_id: null,
      avait_responsable: false,
    });

    const apres = await etat(d);
    expect(apres).toMatchObject({ statut: "traitee", responsable_id: null });
    expect(apres.traitee_le).not.toBeNull();
    expect(apres.traitee_le?.getTime()).toBe(apres.mis_a_jour_le.getTime());
    expect(apres.mis_a_jour_le.getTime()).toBeGreaterThan(avant.mis_a_jour_le.getTime());

    const enregistrees = await notes(d);
    expect(enregistrees).toEqual([expect.objectContaining({ auteur_id: karim.id, texte: raison })]);

    const lignes = await historique(d);
    expect(lignes.map((l) => l.type)).toEqual(["creation", "classement_sans_suite"]);
    expect(lignes[1]).toMatchObject({
      auteur_type: "membre",
      auteur_id: karim.id,
      ancienne_valeur: "nouvelle",
      nouvelle_valeur: "traitee",
    });
    // En un bloc : note et ligne d'historique de la même transaction.
    expect(lignes[1].cree_le.getTime()).toBe(enregistrees[0].cree_le.getTime());
    const { rows } = await base.query<{ n: number }>(
      `select count(*)::int as n from public.historique h
        where h.demande_id = $1 and (h::text like '%' || $2 || '%')`,
      [d.id, "Doublon"],
    );
    expect(rows[0].n).toBe(0);
  });

  it.each([
    ["En cours", "en_cours"],
    ["Traitée", "traitee"],
  ] as const)("demande %s : PASSAGE_INTERDIT, rien ne change", async (_nom, statut) => {
    const d = await creerDemandeTest(base, PREFIXE, { statut, responsableId: karim.id });
    const avant = await etat(d);
    const { error } = await classer(sessionKarim, d.id, "Spam");
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect(await etat(d)).toEqual(avant);
    expect(await notes(d)).toEqual([]);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it.each([
    ["vide", ""],
    ["espaces seulement", "  \n\t "],
    ["espaces Unicode seulement", "\u00a0\u3000\ufeff\u200b"],
    ["absente (null)", null],
    ["2 001 caractères", "a".repeat(2001)],
  ])("raison %s : DONNEES_INVALIDES, rien ne change", async (_cas, note) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    const { error } = await classer(sessionKarim, d.id, note);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DONNEES_INVALIDES");
    expect(await etat(d)).toEqual(avant);
    expect(await notes(d)).toEqual([]);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it("2 000 caractères exactement : acceptée", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await classer(sessionKarim, d.id, "🙂".repeat(2000));
    expect(error).toBeNull();
  });

  it("demande inconnue : DEMANDE_INTROUVABLE", async () => {
    const { error } = await classer(sessionKarim, randomUUID(), "Spam");
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
  });

  it("classée puis rouverte : revient en Nouvelle (aucun responsable)", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    expect((await classer(sessionClaire, d.id, "Spam")).error).toBeNull();
    const { data, error } = await changer(sessionKarim, d.id, "en_cours");
    expect(error).toBeNull();
    expect(data).toMatchObject({ statut: "nouvelle", responsable_id: null, avait_responsable: false });
  });

  it("lireDetailAvec : note du classement et ligne d'historique visibles", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    expect((await classer(sessionClaire, d.id, "Spam publicitaire")).error).toBeNull();
    const resultat = await lireDetailAvec(sessionKarim, d.reference);
    if (!resultat.ok || resultat.donnees === null) throw new Error("détail attendu");
    expect(resultat.donnees.statut).toBe("traitee");
    expect(resultat.donnees.notes.map((n) => n.texte)).toEqual(["Spam publicitaire"]);
    expect(resultat.donnees.historique.map((l) => l.type)).toEqual(["creation", "classement_sans_suite"]);
  });
});

describe("droits", () => {
  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ])("compte %s : DROIT_INSUFFISANT pour les deux fonctions, rien ne change", async (_nom, compte) => {
    const enCours = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const nouvelle = await creerDemandeTest(base, PREFIXE);
    const client = await clientConnecte(compte());
    try {
      const a = await changer(client, enCours.id, "traitee");
      expect(a.error?.message).toBe("DROIT_INSUFFISANT");
      const b = await classer(client, nouvelle.id, "Spam");
      expect(b.error?.message).toBe("DROIT_INSUFFISANT");
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    expect((await etat(enCours)).statut).toBe("en_cours");
    expect((await etat(nouvelle)).statut).toBe("nouvelle");
    expect(await notes(nouvelle)).toEqual([]);
  });

  it.each([
    ["visiteur (clé publiable sans session)", () => clientPubliableTest()],
    ["clé secrète", () => clientServiceTest()],
  ])("%s : droit refusé", async (_nom, client) => {
    const enCours = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const nouvelle = await creerDemandeTest(base, PREFIXE);
    expect((await changer(client(), enCours.id, "traitee")).error?.code).toBe(PERMISSION_REFUSEE);
    expect((await classer(client(), nouvelle.id, "Spam")).error?.code).toBe(PERMISSION_REFUSEE);
    expect((await etat(enCours)).statut).toBe("en_cours");
    expect((await etat(nouvelle)).statut).toBe("nouvelle");
  });

  it.each(["changer_statut(uuid, text)", "classer_sans_suite(uuid, text)"])(
    "%s : EXECUTE à authenticated seulement, SECURITY DEFINER, search_path vide",
    async (signature) => {
      const { rows } = await base.query<{ role: string; peut: boolean }>(
        `select r as role, has_function_privilege(r, $1, 'EXECUTE') as peut
           from unnest(array['anon', 'authenticated', 'service_role']) as r`,
        [`public.${signature}`],
      );
      expect(Object.fromEntries(rows.map((l) => [l.role, l.peut]))).toEqual({
        anon: false,
        authenticated: true,
        service_role: false,
      });
      const { rows: config } = await base.query<{ definer: boolean; config: string[] | null }>(
        "select prosecdef as definer, proconfig as config from pg_proc where oid = $1::regprocedure",
        [`public.${signature}`],
      );
      expect(config[0].definer).toBe(true);
      expect(config[0].config).toContain('search_path=""');
    },
  );

  it("prive.texte_note_valide : aucun droit EXECUTE, pour personne", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r as role,
              has_function_privilege(r, 'prive.texte_note_valide(text)', 'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(rows.every((l) => !l.peut)).toBe(true);
  });

  it("prive.texte_note_valide : même règle que la contrainte CHECK de notes", async () => {
    const cas: [string | null, boolean][] = [
      ["ok", true],
      ["\u00a0ok\u3000", true],
      ["a".repeat(2000), true],
      ["a".repeat(2001), false],
      ["", false],
      ["\u00a0\u3000\ufeff\u200b", false],
      [null, false],
    ];
    for (const [texte, attendu] of cas) {
      const { rows } = await base.query<{ v: boolean }>(
        "select coalesce(prive.texte_note_valide($1), false) as v",
        [texte],
      );
      expect(rows[0].v, JSON.stringify(texte)).toBe(attendu);
    }
  });

  it("ajouter_note et classer_sans_suite utilisent la règle commune", async () => {
    const { rows } = await base.query<{ nom: string }>(
      `select p.proname as nom from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('ajouter_note', 'classer_sans_suite')
          and pg_get_functiondef(p.oid) like '%prive.texte_note_valide(%'
        order by 1`,
    );
    expect(rows.map((r) => r.nom)).toEqual(["ajouter_note", "classer_sans_suite"]);
  });

  it("aucune des deux fonctions n'écrit elle-même traitee_le ni mis_a_jour_le (AD-22)", async () => {
    const { rows } = await base.query<{ nom: string }>(
      `select p.proname as nom from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('changer_statut', 'classer_sans_suite')
          and pg_get_functiondef(p.oid) ~* '(traitee_le|mis_a_jour_le)'`,
    );
    expect(rows).toEqual([]);
  });
});
