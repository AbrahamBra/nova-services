import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// La clé secrète (`service_role`) contourne RLS : elle ne doit avoir aucun
// droit direct sur les tables métier, qui ne changent que par les fonctions
// SQL en SECURITY DEFINER (AD-4, AD-5, AD-6 ; migrations 20261103000004 et 0005).

const TABLES = [
  "demandes",
  "historique",
  "compteurs_reference",
  "categories",
  "parametres",
  "membres",
  // Story 1.5 : vue de la liste, lue seulement avec la session d'un membre.
  "demandes_liste",
  // Story 1.7 : journal, écrit seulement par prive.ecrire_journal.
  "journal",
];
const DROITS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

let client: Client;

beforeAll(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL manquant dans .env.local.");
  client = new Client({ connectionString: url });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

describe("sécurité — droits de service_role sur les tables", () => {
  it("aucun droit direct sur les tables métier", async () => {
    const { rows } = await client.query<{ droit: string }>(
      `select t.nom || ':' || d.droit as droit
       from unnest($1::text[]) as t(nom)
       cross join unnest($2::text[]) as d(droit)
       where has_table_privilege('service_role', 'public.' || t.nom, d.droit)
       order by 1`,
      [TABLES, DROITS],
    );
    expect(rows.map((ligne) => ligne.droit)).toEqual([]);
  });

  it("aucun droit par colonne sur les tables métier ni sur la vue", async () => {
    const { rows } = await client.query<{ droit: string }>(
      `select c.relname || '.' || a.attname || ':' || d.droit as droit
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) as d(droit)
       where c.relname = any($1::text[])
         and has_column_privilege('service_role', c.oid, a.attnum, d.droit)
       order by 1`,
      [TABLES],
    );
    expect(rows.map((ligne) => ligne.droit)).toEqual([]);
  });

  it("aucun usage direct des séquences de l'historique et du journal", async () => {
    for (const sequence of ["public.historique_id_seq", "public.journal_id_seq"]) {
      const { rows } = await client.query<{ peut: boolean }>(
        `select has_sequence_privilege('service_role', $1, 'USAGE')
                or has_sequence_privilege('service_role', $1, 'UPDATE') as peut`,
        [sequence],
      );
      expect(rows[0].peut, sequence).toBe(false);
    }
  });
});
