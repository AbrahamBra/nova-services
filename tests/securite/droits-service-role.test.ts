import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// La clé secrète (`service_role`) contourne RLS : elle ne doit avoir aucun
// droit direct sur les tables métier, qui ne changent que par les fonctions
// SQL en SECURITY DEFINER (AD-4, AD-5, AD-6 ; migrations 20261103000004 et 0005).

const TABLES = ["demandes", "historique", "compteurs_reference", "categories", "parametres", "membres"];
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

  it("aucun usage direct de la séquence de l'historique", async () => {
    const { rows } = await client.query<{ peut: boolean }>(
      `select has_sequence_privilege('service_role', 'public.historique_id_seq', 'USAGE')
              or has_sequence_privilege('service_role', 'public.historique_id_seq', 'UPDATE') as peut`,
    );
    expect(rows[0].peut).toBe(false);
  });
});
