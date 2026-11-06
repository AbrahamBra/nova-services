import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 3.4 — registre `effacements` et `rejouer_effacements()` sur la base
// de développement (migration 20261103000027, AD-15, AD-30). Base partagée :
// demandes et compte `TEST-3.4-…`, référence du registre retirée à la fin.

const PREFIXE = `TEST-3.4-${randomUUID().slice(0, 8)}`;

let base: Client;
let membre: CompteTest | undefined;
let effacee: DemandeTest;
let gardee: DemandeTest;
const references: string[] = [];

async function compter(table: string, demandeId: string): Promise<number> {
  const colonne = table === "demandes" ? "id" : "demande_id";
  const { rows } = await base.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where ${colonne} = $1`,
    [demandeId],
  );
  return rows[0].n;
}

/** Garde-fou avant chaque appel : aucune référence étrangère au test dans le registre. */
async function registreLimiteAuTest(): Promise<void> {
  const { rows } = await base.query<{ n: number }>(
    "select count(*)::int as n from public.effacements where reference <> all($1::text[])",
    [references],
  );
  if (rows[0].n > 0) {
    throw new Error(
      `Registre effacements non vide hors de ce test (${rows[0].n} ligne(s)) : rejeu refusé sur la base partagée.`,
    );
  }
}

beforeAll(async () => {
  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  membre = await creerCompteTest({ prenom: "Nadia", etiquette: "3.4" });

  effacee = await creerDemandeTest(base, PREFIXE, { objet: "Demande à effacer" });
  gardee = await creerDemandeTest(base, PREFIXE, { objet: "Demande à garder" });
  references.push(effacee.reference);

  // Une note sur la demande effacée (insérée directement : ajouter_note
  // demande une session et écrirait au journal).
  await base.query(
    "insert into public.notes (demande_id, auteur_id, texte) values ($1, $2, 'Note de test')",
    [effacee.id, membre.id],
  );
  // Le registre ne sera rempli que par effacer_demandeur (epic 5) : inscrit
  // ici directement.
  await base.query("insert into public.effacements (reference) values ($1)", [effacee.reference]);
}, 60_000);

afterAll(async () => {
  try {
    if (base) {
      // Nos lignes du registre d'abord, même si un test a échoué ; puis les demandes.
      try {
        await base.query("delete from public.effacements where reference = any($1::text[])", [
          references,
        ]);
      } finally {
        await supprimerDemandesTest(base, PREFIXE);
      }
    }
  } finally {
    await base?.end().catch(() => {});
    if (membre) await supprimerComptesTest([membre]);
  }
}, 60_000);

describe("rejouer_effacements() (AD-30)", () => {
  // La fonction efface pour toute la base (partagée) : on ne l'appelle que si
  // le registre ne contient que les références de ce test.
  it("le registre ne contient que les références de ce test", async () => {
    const { rows } = await base.query<{ reference: string }>(
      "select reference from public.effacements where reference <> all($1::text[])",
      [references],
    );
    expect(
      rows.map((l) => l.reference),
      "Registre effacements de la base de développement non vide (hors ce test) : rejeu refusé, il effacerait des demandes d'une autre session. Videz les lignes restantes avant de relancer.",
    ).toEqual([]);
  });

  it("avant le rejeu : demande, historique et note présents", async () => {
    expect(await compter("demandes", effacee.id)).toBe(1);
    expect(await compter("historique", effacee.id)).toBeGreaterThan(0);
    expect(await compter("notes", effacee.id)).toBe(1);
  });

  it("avec la clé secrète : supprime la demande inscrite, son historique et ses notes ; compteur à 1", async () => {
    await registreLimiteAuTest();
    const { data, error } = await clientServiceTest().rpc("rejouer_effacements");
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect(await compter("demandes", effacee.id)).toBe(0);
    expect(await compter("historique", effacee.id)).toBe(0);
    expect(await compter("notes", effacee.id)).toBe(0);
  });

  it("ne touche pas aux demandes absentes du registre, et garde le registre", async () => {
    expect(await compter("demandes", gardee.id)).toBe(1);
    expect(await compter("historique", gardee.id)).toBeGreaterThan(0);
    const { rows } = await base.query("select 1 from public.effacements where reference = $1", [
      effacee.reference,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("un second rejeu ne supprime plus rien", async () => {
    await registreLimiteAuTest();
    const { rows } = await base.query<{ n: number }>("select public.rejouer_effacements() as n");
    expect(rows[0].n).toBe(0);
  });
});

describe("droits (AD-15)", () => {
  it("EXECUTE : service_role seulement", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r.role, has_function_privilege(r.role, 'public.rejouer_effacements()', 'EXECUTE') as peut
       from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
       order by r.role`,
    );
    expect(rows).toEqual([
      { role: "anon", peut: false },
      { role: "authenticated", peut: false },
      { role: "service_role", peut: true },
    ]);
  });

  it("appel direct avec la clé publiable : refusé", async () => {
    const { data, error } = await clientPubliableTest().rpc("rejouer_effacements");
    expect(data).toBeNull();
    expect(["42501", "PGRST202"]).toContain(error?.code);
  });

  it("fonction verrouillée : SECURITY DEFINER et search_path vide", async () => {
    const { rows } = await base.query<{ definer: boolean; config: string[] | null }>(
      `select prosecdef as definer, proconfig as config
       from pg_proc where oid = 'public.rejouer_effacements()'::regprocedure`,
    );
    expect(rows[0].definer).toBe(true);
    expect(rows[0].config).toContain('search_path=""');
  });

  it("table effacements : RLS activée, aucun droit direct pour anon, authenticated ni service_role", async () => {
    const { rows: rls } = await base.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'public.effacements'::regclass",
    );
    expect(rls[0].rls).toBe(true);
    const { rows } = await base.query<{ droit: string }>(
      `select r.role || ':' || d.droit as droit
       from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
       cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as d(droit)
       where has_table_privilege(r.role, 'public.effacements', d.droit)`,
    );
    expect(rows).toEqual([]);
  });

  it("table effacements : seulement la référence et la date", async () => {
    const { rows } = await base.query<{ colonne: string }>(
      `select attname as colonne from pg_attribute
       where attrelid = 'public.effacements'::regclass and attnum > 0 and not attisdropped
       order by attnum`,
    );
    expect(rows.map((l) => l.colonne)).toEqual(["reference", "efface_le"]);
  });
});
