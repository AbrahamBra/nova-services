import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TYPE_EVENEMENT_JOURNAL, clesJournalValides, descriptionJournal } from "@/lib/journal";
import {
  clientConnecte,
  clientPubliableTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 5.4 — `chercher_demandes_demandeur` et `effacer_demandeur` sur le
// projet de développement (migration 20261103000033) : droits
// (authenticated seulement, SECURITY DEFINER, search_path vide),
// administrateur actif seulement, recherche exacte et normalisée, tri,
// effacement complet (demandes, historique, notes), registre `effacements`,
// journal sans l'email, DEMANDES_CHANGEES (rien n'est effacé), deux
// effacements simultanés.
// Base partagée : chaque test a son email `test-5-4-<code>@example.com` et
// ses demandes `TEST-5.4-…` ; les références inscrites dans `effacements`,
// les demandes restantes, le journal et les comptes de test sont effacés à
// la fin. Jamais les données d'essai (jean.dupont@example.com).

const PREFIXE = `TEST-5.4-${randomUUID().slice(0, 8)}`;

const comptes: CompteTest[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let clientAdmin: SupabaseClient;
let clientCollaborateur: SupabaseClient;
let base: Client;
/** Références de toutes les demandes créées (retirées du registre à la fin). */
const references: string[] = [];

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.4", ...options });
  comptes.push(c);
  return c;
}

beforeAll(async () => {
  admin = await compte({ role: "administrateur", prenom: "Claire" });
  collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
  clientAdmin = await clientConnecte(admin);
  clientCollaborateur = await clientConnecte(collaborateur);
  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  try {
    if (base) {
      // Registre d'abord, même si un test a échoué : jamais une référence de
      // ce test laissée dans `effacements` (story 3.4).
      try {
        await base.query("delete from public.effacements where reference = any($1::text[])", [
          references,
        ]);
      } finally {
        await supprimerDemandesTest(base, PREFIXE).catch((erreur) =>
          console.error(`Nettoyage des demandes impossible : ${String(erreur)}`),
        );
      }
    }
  } finally {
    await base?.end().catch(() => {});
    await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
      console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
    );
    await supprimerComptesTest(comptes);
  }
}, 60_000);

/** Email unique d'un test (jamais celui des données d'essai). */
function emailUnique(): string {
  return `test-5-4-${randomUUID().slice(0, 8)}@example.com`;
}

/** Crée `nombre` demandes pour cet email, de la plus ancienne à la plus récente. */
async function demandesDe(email: string, nombre: number): Promise<DemandeTest[]> {
  const creees: DemandeTest[] = [];
  for (let i = 0; i < nombre; i++) {
    const d = await creerDemandeTest(base, PREFIXE, {
      email,
      objet: `Demande ${i + 1}`,
      decalage: `-${nombre - i} days`,
    });
    references.push(d.reference);
    creees.push(d);
  }
  return creees;
}

type Trouvee = { id: string; reference: string; cree_le: string; objet: string; statut: string };

async function chercher(client: SupabaseClient, email: string) {
  return client.rpc("chercher_demandes_demandeur", { p_email: email });
}

async function effacer(client: SupabaseClient, email: string, ids: string[]) {
  return client.rpc("effacer_demandeur", { p_email: email, p_ids: ids });
}

async function compter(table: "demandes" | "historique" | "notes", ids: string[]): Promise<number> {
  const colonne = table === "demandes" ? "id" : "demande_id";
  const { rows } = await base.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where ${colonne} = any($1::uuid[])`,
    [ids],
  );
  return rows[0].n;
}

async function dansRegistre(refs: string[]): Promise<string[]> {
  const { rows } = await base.query<{ reference: string }>(
    "select reference from public.effacements where reference = any($1::text[]) order by reference",
    [refs],
  );
  return rows.map((l) => l.reference);
}

async function journalEffacements(c: CompteTest) {
  const { rows } = await base.query<{
    id: string;
    type: string;
    auteur_type: string;
    auteur_id: string;
    details: Record<string, unknown>;
  }>(
    `select id, type, auteur_type, auteur_id, details from public.journal
      where auteur_id = $1 and details ->> 'evenement' = 'demandeur_efface'
      order by id`,
    [c.id],
  );
  return rows;
}

describe("droits", () => {
  const FONCTIONS = [
    "public.chercher_demandes_demandeur(text)",
    "public.effacer_demandeur(text, uuid[])",
  ];

  it("EXECUTE à authenticated seulement ; SECURITY DEFINER, search_path vide", async () => {
    const { rows } = await base.query<{ f: string; r: string; peut: boolean }>(
      `select f, r, has_function_privilege(r, f, 'EXECUTE') as peut
         from unnest($1::text[]) as f, unnest(array['anon', 'authenticated', 'service_role']) as r`,
      [FONCTIONS],
    );
    expect(rows).toHaveLength(FONCTIONS.length * 3);
    for (const l of rows) expect(l.peut, `${l.f} ${l.r}`).toBe(l.r === "authenticated");

    const { rows: definitions } = await base.query<{ nom: string; definer: boolean; config: string[] | null }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('chercher_demandes_demandeur', 'effacer_demandeur')`,
    );
    expect(definitions).toHaveLength(FONCTIONS.length);
    for (const d of definitions) {
      expect(d.definer, d.nom).toBe(true);
      expect(d.config, d.nom).toContain('search_path=""');
    }
  });

  it("visiteur (clé publiable) : refusé", async () => {
    const email = emailUnique();
    const [d] = await demandesDe(email, 1);
    for (const reponse of [
      await chercher(clientPubliableTest(), email),
      await effacer(clientPubliableTest(), email, [d.id]),
    ]) {
      expect(reponse.error).not.toBeNull();
      expect(reponse.data).toBeNull();
    }
    expect(await compter("demandes", [d.id])).toBe(1);
  });

  it("collaborateur : DROIT_INSUFFISANT pour chercher et effacer, rien n'est effacé", async () => {
    const email = emailUnique();
    const demandes = await demandesDe(email, 2);
    const ids = demandes.map((d) => d.id);
    expect((await chercher(clientCollaborateur, email)).error?.message).toBe("DROIT_INSUFFISANT");
    expect((await effacer(clientCollaborateur, email, ids)).error?.message).toBe("DROIT_INSUFFISANT");
    expect(await compter("demandes", ids)).toBe(2);
    expect(await dansRegistre(demandes.map((d) => d.reference))).toEqual([]);
    expect(await journalEffacements(collaborateur)).toEqual([]);
  });
});

describe("chercher_demandes_demandeur", () => {
  it("correspondance exacte après normalisation (majuscules, espaces), de la plus récente à la plus ancienne", async () => {
    const email = emailUnique();
    const demandes = await demandesDe(email, 3);
    // Une autre personne dont l'email CONTIENT le premier : jamais trouvée.
    await demandesDe(`autre.${email}`, 1);

    const { data, error } = await chercher(clientAdmin, `  ${email.toUpperCase()} `);
    expect(error).toBeNull();
    const trouvees = data as Trouvee[];
    expect(trouvees.map((t) => t.reference)).toEqual(demandes.map((d) => d.reference).reverse());
    expect(Object.keys(trouvees[0]).sort()).toEqual(["cree_le", "id", "objet", "reference", "statut"]);
    expect(trouvees[0]).toMatchObject({ id: demandes[2].id, objet: "Demande 3", statut: "nouvelle" });
  });

  it("aucune demande : liste vide", async () => {
    const { data, error } = await chercher(clientAdmin, emailUnique());
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each([["jean@dupont"], ["   "], ["sans-arobase.example.com"], [null]])(
    "email « %s » : DONNEES_INVALIDES",
    async (email) => {
      expect((await clientAdmin.rpc("chercher_demandes_demandeur", { p_email: email })).error?.message).toBe(
        "DONNEES_INVALIDES",
      );
    },
  );
});

describe("effacer_demandeur", () => {
  it("efface demandes, historique et notes ; références au registre ; journal « 3 demandes effacées » sans l'email", async () => {
    const email = emailUnique();
    const demandes = await demandesDe(email, 3);
    const ids = demandes.map((d) => d.id);
    const refs = demandes.map((d) => d.reference);
    await base.query(
      "insert into public.notes (demande_id, auteur_id, texte) values ($1, $2, 'Note de test 5.4')",
      [ids[0], admin.id],
    );
    expect(await compter("historique", ids)).toBeGreaterThanOrEqual(3);
    expect(await compter("notes", ids)).toBe(1);

    const { data, error } = await effacer(clientAdmin, ` ${email.toUpperCase()}`, [...ids].reverse());
    expect(error).toBeNull();
    expect(data).toEqual({ nombre: 3 });

    expect(await compter("demandes", ids)).toBe(0);
    expect(await compter("historique", ids)).toBe(0);
    expect(await compter("notes", ids)).toBe(0);
    expect(await dansRegistre(refs)).toEqual([...refs].sort());

    // Plus dans la liste (vue demandes_liste) ni dans la recherche.
    const { rows: liste } = await base.query(
      "select 1 from public.demandes_liste where reference = any($1::text[])",
      [refs],
    );
    expect(liste).toEqual([]);
    expect((await chercher(clientAdmin, email)).data).toEqual([]);
    for (const reference of refs) {
      const { data: ids } = await clientAdmin.rpc("ids_demandes_recherche", { p_texte: reference });
      expect(ids ?? []).toEqual([]);
    }

    // Journal : type donnees, au nom de l'administratrice, le nombre seulement.
    const lignes = await journalEffacements(admin);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ type: "donnees", auteur_type: "membre", auteur_id: admin.id });
    expect(lignes[0].details).toEqual({ evenement: "demandeur_efface", nombre: 3 });
    expect(TYPE_EVENEMENT_JOURNAL.demandeur_efface).toBe("donnees");
    expect(clesJournalValides("demandeur_efface", Object.keys(lignes[0].details))).toBe(true);
    expect(descriptionJournal(lignes[0].details)).toBe("3 demandes effacées (droit à l'effacement)");
    // Jamais l'email, le nom ni une référence dans le journal (AD-14).
    for (const valeur of [email, PREFIXE, ...refs]) {
      const { rows } = await base.query(
        "select id from public.journal where strpos(lower(details::text), lower($1)) > 0",
        [valeur],
      );
      expect(rows, valeur).toEqual([]);
    }
  });

  it("nouvelle demande arrivée depuis la recherche : DEMANDES_CHANGEES, rien n'est effacé", async () => {
    const email = emailUnique();
    const demandes = await demandesDe(email, 2);
    const vues = ((await chercher(clientAdmin, email)).data as Trouvee[]).map((t) => t.id);
    const nouvelle = (await demandesDe(email, 1))[0];

    const { data, error } = await effacer(clientAdmin, email, vues);
    expect(data).toBeNull();
    expect(error?.message).toBe("DEMANDES_CHANGEES");
    const tous = [...demandes.map((d) => d.id), nouvelle.id];
    expect(await compter("demandes", tous)).toBe(3);
    expect(await dansRegistre([...demandes, nouvelle].map((d) => d.reference))).toEqual([]);
  });

  it("identifiant d'une autre personne : DEMANDES_CHANGEES, rien n'est effacé", async () => {
    const email = emailUnique();
    const [mienne] = await demandesDe(email, 1);
    const [autre] = await demandesDe(emailUnique(), 1);
    expect((await effacer(clientAdmin, email, [mienne.id, autre.id])).error?.message).toBe(
      "DEMANDES_CHANGEES",
    );
    expect(await compter("demandes", [mienne.id, autre.id])).toBe(2);
  });

  it("liste vide ou email mal formé : DONNEES_INVALIDES", async () => {
    const email = emailUnique();
    const [d] = await demandesDe(email, 1);
    expect((await effacer(clientAdmin, email, [])).error?.message).toBe("DONNEES_INVALIDES");
    expect((await effacer(clientAdmin, "jean@dupont", [d.id])).error?.message).toBe("DONNEES_INVALIDES");
    expect(await compter("demandes", [d.id])).toBe(1);
  });

  it("une seule demande : journal « 1 demande effacée »", async () => {
    const email = emailUnique();
    const [d] = await demandesDe(email, 1);
    expect((await effacer(clientAdmin, email, [d.id])).data).toEqual({ nombre: 1 });
    const lignes = await journalEffacements(admin);
    const derniere = lignes[lignes.length - 1];
    expect(derniere.details).toEqual({ evenement: "demandeur_efface", nombre: 1 });
    expect(descriptionJournal(derniere.details)).toBe("1 demande effacée (droit à l'effacement)");
  });

  it("deux effacements simultanés : le second attend le premier, puis DEMANDES_CHANGEES", async () => {
    const email = emailUnique();
    const demandes = await demandesDe(email, 2);
    const ids = demandes.map((d) => d.id);
    const premiere = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    const seconde = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await premiere.connect();
    await seconde.connect();
    const enAdmin = async (c: Client) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: admin.id, role: "authenticated" }),
      ]);
    };
    try {
      await enAdmin(premiere);
      await enAdmin(seconde);
      const { rows } = await premiere.query<{ r: { nombre: number } }>(
        "select public.effacer_demandeur($1, $2::uuid[]) as r",
        [email, ids],
      );
      expect(rows[0].r).toEqual({ nombre: 2 });

      // La seconde attend le verrou de la première.
      let finie = false;
      const attente = seconde
        .query("select public.effacer_demandeur($1, $2::uuid[]) as r", [email, ids])
        .then(
          () => "réussite",
          (erreur: { message?: string }) => erreur.message ?? "erreur",
        )
        .finally(() => {
          finie = true;
        });
      await new Promise((resoudre) => setTimeout(resoudre, 500));
      expect(finie).toBe(false);

      await premiere.query("commit");
      expect(await attente).toBe("DEMANDES_CHANGEES");
      await seconde.query("rollback");

      expect(await compter("demandes", ids)).toBe(0);
      expect(await dansRegistre(demandes.map((d) => d.reference))).toEqual(
        demandes.map((d) => d.reference).sort(),
      );
    } finally {
      await premiere.query("rollback").catch(() => {});
      await seconde.query("rollback").catch(() => {});
      await premiere.end().catch(() => {});
      await seconde.end().catch(() => {});
    }
  }, 30_000);
});

describe("après une restauration (AD-30)", () => {
  // Le registre sert à réeffacer une demande remise par une sauvegarde.
  // Restauration simulée et rejeu dans une transaction ANNULÉE (rôle
  // service_role) : `rejouer_effacements()` agit sur toute la base partagée,
  // et un autre fichier (story 3.4) peut avoir une demande inscrite au
  // registre ; rien de ce que le rejeu supprime ici n'est donc gardé.
  it("une demande effacée puis restaurée avec la même référence est réeffacée par rejouer_effacements()", async () => {
    const email = emailUnique();
    const demandes = await demandesDe(email, 2);
    const restauree = demandes[0];
    const { rows: copie } = await base.query<{ ligne: Record<string, unknown> }>(
      "select to_jsonb(d) as ligne from public.demandes d where d.id = $1",
      [restauree.id],
    );

    const { data, error } = await effacer(clientAdmin, email, demandes.map((d) => d.id));
    expect(error).toBeNull();
    expect(data).toEqual({ nombre: 2 });
    expect(await dansRegistre([restauree.reference])).toEqual([restauree.reference]);

    // Colonnes écrites (sans les colonnes calculées, comme `recherche`).
    const { rows: colonnes } = await base.query<{ c: string }>(
      `select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as c
         from information_schema.columns
        where table_schema = 'public' and table_name = 'demandes' and is_generated = 'NEVER'`,
    );
    const c = colonnes[0].c;
    await base.query("begin");
    try {
      // Sauvegarde restaurée : la demande revient, même référence (ligne TEST-).
      await base.query(
        `insert into public.demandes (${c})
         select ${c} from jsonb_populate_record(null::public.demandes, $1::jsonb)`,
        [copie[0].ligne],
      );
      expect(await compter("demandes", [restauree.id])).toBe(1);

      await base.query("set local role service_role");
      const { rows } = await base.query<{ n: number }>("select public.rejouer_effacements() as n");
      await base.query("reset role");
      expect(rows[0].n).toBeGreaterThanOrEqual(1);
      expect(await compter("demandes", [restauree.id])).toBe(0);
      const { rows: parReference } = await base.query(
        "select 1 from public.demandes where reference = $1",
        [restauree.reference],
      );
      expect(parReference).toEqual([]);
    } finally {
      await base.query("rollback");
    }
  }, 30_000);
});
