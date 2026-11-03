import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// Vérifie dans le catalogue PostgreSQL du projet de développement que les
// rôles `anon` et `authenticated` n'ont aucun droit en dehors de la liste
// attendue (AD-2, AD-15). Connexion directe via SUPABASE_DB_URL.

// Droits explicitement accordés par les stories, sous la forme
// « role:type:schema.objet:droit ». Vide à la story 1.1.
const DROITS_ATTENDUS: string[] = [];

const ROLES = ["anon", "authenticated"];

let client: Client;

beforeAll(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL manquant : renseignez l'adresse de connexion du projet de développement dans .env.local.",
    );
  }
  client = new Client({ connectionString: url });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

async function droitsAccordes(): Promise<string[]> {
  const { rows } = await client.query<{ droit: string }>(
    `
    with roles(rolname) as (select unnest($1::text[]))
    -- Tables, vues, vues matérialisées, tables étrangères et partitionnées
    select r.rolname || ':table:' || n.nspname || '.' || c.relname || ':' || p.priv as droit
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join roles r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
    where n.nspname in ('public', 'prive')
      and c.relkind in ('r', 'v', 'm', 'f', 'p')
      and has_table_privilege(r.rolname, c.oid, p.priv)
    union all
    -- Séquences
    select r.rolname || ':sequence:' || n.nspname || '.' || c.relname || ':' || p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join roles r
    cross join unnest(array['USAGE','SELECT','UPDATE']) p(priv)
    where n.nspname in ('public', 'prive')
      and c.relkind = 'S'
      and has_sequence_privilege(r.rolname, c.oid, p.priv)
    union all
    -- Fonctions et procédures
    select r.rolname || ':fonction:' || n.nspname || '.' || f.proname
           || '(' || pg_get_function_identity_arguments(f.oid) || '):EXECUTE'
    from pg_proc f
    join pg_namespace n on n.oid = f.pronamespace
    cross join roles r
    where n.nspname in ('public', 'prive')
      and has_function_privilege(r.rolname, f.oid, 'EXECUTE')
    union all
    -- Schéma prive : aucun accès
    select r.rolname || ':schema:prive:' || p.priv
    from pg_namespace n
    cross join roles r
    cross join unnest(array['USAGE','CREATE']) p(priv)
    where n.nspname = 'prive'
      and has_schema_privilege(r.rolname, n.oid, p.priv)
    order by 1
    `,
    [ROLES],
  );
  return rows.map((ligne) => ligne.droit);
}

describe("sécurité — droits de anon et authenticated", () => {
  it("le schéma prive existe (migration appliquée)", async () => {
    const { rowCount } = await client.query(
      "select 1 from pg_namespace where nspname = 'prive'",
    );
    expect(rowCount).toBe(1);
  });

  it("aucun droit sur public ni prive en dehors de la liste attendue", async () => {
    expect(await droitsAccordes()).toEqual(DROITS_ATTENDUS);
  });

  it("un objet créé après la migration ne donne aucun droit (droits par défaut retirés)", async () => {
    // Création dans une transaction annulée : rien ne reste en base.
    await client.query("begin");
    try {
      await client.query(
        "create table public.test_verrou_droits (id bigint generated always as identity primary key)",
      );
      await client.query(
        "create function public.test_verrou_droits_f() returns int language sql as 'select 1'",
      );
      await client.query("create table prive.test_verrou_droits (id int)");
      await client.query(
        "create function prive.test_verrou_droits_f() returns int language sql as 'select 1'",
      );
      expect(await droitsAccordes()).toEqual(DROITS_ATTENDUS);
    } finally {
      await client.query("rollback");
    }
  });
});
