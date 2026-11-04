import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client, type DatabaseError } from "pg";
import { empreinteDeTest } from "../outils/ip-test";

// Story 1.8 — limite d'envois dans `deposer_demande` (migration
// 20261103000011), sur le projet de développement : 5 envois en 10 minutes
// par empreinte d'IP, clé renvoyée non comptée, envois simultanés,
// effacement au-delà d'une heure, aucune IP en clair, droits.
//
// La plupart des cas tournent dans une transaction annulée. Ceux qui doivent
// être validés (envois simultanés, appel par l'API) créent des demandes
// `TEST-…` propres à cette exécution, effacées à la fin avec leurs empreintes.

const PREFIXE = `TEST-1.8-${crypto.randomUUID().slice(0, 8)}`;
const SIGNATURE =
  "public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean, text)";
const ANCIENNE_SIGNATURE =
  "public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean)";
const TROP = "TROP_D_ENVOIS";

function variable(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} manquant dans .env.local.`);
  return valeur;
}

let base: Client;
let categorieActive: string;
const empreintesUtilisees: string[] = [];

/** Empreinte propre à un test, effacée à la fin. */
function empreinte(): string {
  const valeur = empreinteDeTest();
  empreintesUtilisees.push(valeur);
  return valeur;
}

beforeAll(async () => {
  base = new Client({ connectionString: variable("SUPABASE_DB_URL") });
  await base.connect();
  const { rows } = await base.query<{ id: string }>(
    "select id from public.categories where actif order by ordre limit 1",
  );
  categorieActive = rows[0].id;
});

afterAll(async () => {
  if (base) {
    await base.query("delete from public.demandes where nom like $1", [`${PREFIXE}%`]);
    await base.query("delete from public.envois_formulaire where empreinte_ip = any($1::text[])", [
      empreintesUtilisees,
    ]);
    await base.end();
  }
});

type Reponse = { reference: string; jeton: string; nouvelle: boolean };

async function deposer(
  client: Client,
  empreinteIp: string | null,
  cle: string = crypto.randomUUID(),
): Promise<Reponse> {
  const { rows } = await client.query(
    `select public.deposer_demande($1, $2, 'sophie.garnier@example.com', null, null, $3,
                                   'Impression impossible', 'Description.', true, $4) as r`,
    [cle, `${PREFIXE} Sophie Garnier`, categorieActive, empreinteIp],
  );
  return rows[0].r;
}

async function dansTransactionAnnulee<T>(travail: () => Promise<T>): Promise<T> {
  await base.query("begin");
  try {
    return await travail();
  } finally {
    await base.query("rollback").catch(() => {});
  }
}

async function erreurDe(promesse: Promise<unknown>): Promise<DatabaseError> {
  try {
    await promesse;
  } catch (erreur) {
    return erreur as DatabaseError;
  }
  throw new Error("Une erreur était attendue.");
}

async function nombreEnvois(empreinteIp: string): Promise<number> {
  const { rows } = await base.query<{ n: number }>(
    "select count(*)::int as n from public.envois_formulaire where empreinte_ip = $1",
    [empreinteIp],
  );
  return rows[0].n;
}

async function demandeExiste(cle: string): Promise<boolean> {
  const { rowCount } = await base.query("select 1 from public.demandes where cle_envoi = $1", [
    cle,
  ]);
  return rowCount === 1;
}

function clientServeur() {
  return createClient(variable("NEXT_PUBLIC_SUPABASE_URL"), variable("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** `deposer_demande` par l'API, avec la clé secrète (comme l'action `deposer`). */
function appelApi(
  serveur: ReturnType<typeof clientServeur>,
  empreinteIp: string,
  objet: string,
  cle: string = crypto.randomUUID(),
) {
  return serveur.rpc("deposer_demande", {
    p_cle_envoi: cle,
    p_nom: `${PREFIXE} ${objet}`,
    p_email: "sophie.garnier@example.com",
    p_telephone: null,
    p_societe: null,
    p_categorie_id: categorieActive,
    p_objet: objet,
    p_description: "Description.",
    p_consentement: true,
    p_empreinte_ip: empreinteIp,
  });
}

describe("limite d'envois — 5 en 10 minutes par empreinte", () => {
  it("5 envois acceptés, le 6ᵉ refusé (TROP_D_ENVOIS) et rien n'est enregistré", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinte();
      for (let i = 0; i < 5; i += 1) {
        const r = await deposer(base, ip);
        expect(r.nouvelle).toBe(true);
      }
      expect(await nombreEnvois(ip)).toBe(5);

      const cle = crypto.randomUUID();
      await base.query("savepoint sixieme");
      const erreur = await erreurDe(deposer(base, ip, cle));
      await base.query("rollback to savepoint sixieme");
      expect(erreur.code).toBe("P0001");
      expect(erreur.message).toBe(TROP);
      expect(await demandeExiste(cle)).toBe(false);
      expect(await nombreEnvois(ip)).toBe(5);
    });
  });

  it("autre empreinte → acceptée, même après la limite de la première", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinte();
      for (let i = 0; i < 5; i += 1) await deposer(base, ip);
      const autre = await deposer(base, empreinte());
      expect(autre.nouvelle).toBe(true);
    });
  });

  it("envois de plus de 10 minutes → plus comptés", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinte();
      await base.query(
        `insert into public.envois_formulaire (empreinte_ip, cle_envoi, cree_le)
         select $1, gen_random_uuid(), now() - interval '10 minutes 1 second'
           from generate_series(1, 5)`,
        [ip],
      );
      const r = await deposer(base, ip);
      expect(r.nouvelle).toBe(true);
    });
  });

  it("envois de moins de 10 minutes → comptés", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinte();
      await base.query(
        `insert into public.envois_formulaire (empreinte_ip, cle_envoi, cree_le)
         select $1, gen_random_uuid(), now() - interval '9 minutes'
           from generate_series(1, 5)`,
        [ip],
      );
      const erreur = await erreurDe(deposer(base, ip));
      expect(erreur.message).toBe(TROP);
    });
  });

  it("même cle_envoi renvoyée → pas comptée une seconde fois", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinte();
      const cle = crypto.randomUUID();
      const premier = await deposer(base, ip, cle);
      for (let i = 0; i < 6; i += 1) {
        const renvoi = await deposer(base, ip, cle);
        expect(renvoi).toMatchObject({ reference: premier.reference, nouvelle: false });
      }
      expect(await nombreEnvois(ip)).toBe(1);
      // Les 4 envois restants sont toujours permis.
      for (let i = 0; i < 4; i += 1) await deposer(base, ip);
      expect((await erreurDe(deposer(base, ip))).message).toBe(TROP);
    });
  });

  it("au-delà de la limite, un renvoi de la même clé rend encore la demande existante", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinte();
      const cle = crypto.randomUUID();
      const premier = await deposer(base, ip, cle);
      for (let i = 0; i < 4; i += 1) await deposer(base, ip);
      const renvoi = await deposer(base, ip, cle);
      expect(renvoi).toMatchObject({ reference: premier.reference, nouvelle: false });
    });
  });

  it("empreinte absente ou mal formée (IP en clair) → DONNEES_INVALIDES", async () => {
    for (const valeur of [null, "", "127.0.0.1", "A".repeat(64), "0".repeat(63)]) {
      const erreur = await dansTransactionAnnulee(() => erreurDe(deposer(base, valeur)));
      expect(erreur.message, String(valeur)).toBe("DONNEES_INVALIDES");
    }
  });
});

describe("limite d'envois — envois simultanés", () => {
  // Par l'API (clé secrète) : chaque appel est sa propre transaction, comme
  // en production, sans ouvrir 10 connexions directes (le pooler de l'offre
  // gratuite en limite le nombre, partagé avec les autres fichiers de test).
  it("10 envois en parallèle, même empreinte → exactement 5 enregistrés", async () => {
    const serveur = clientServeur();
    const ip = empreinte();
    const resultats = await Promise.all(
      Array.from({ length: 10 }, () => appelApi(serveur, ip, "Envoi simultané")),
    );
    const acceptes = resultats.filter((r) => r.error === null);
    const refuses = resultats.filter((r) => r.error !== null);
    expect(acceptes).toHaveLength(5);
    expect(refuses).toHaveLength(5);
    for (const refus of refuses) expect(refus.error).toMatchObject({ code: "P0001", message: TROP });
    expect(await nombreEnvois(ip)).toBe(5);
  });
});

describe("limite d'envois — même clé en attente du verrou", () => {
  it("le second appel, débloqué après le premier, rend la demande existante (pas TROP_D_ENVOIS)", async () => {
    const ip = empreinte();
    // 4 envois validés : le premier appel fait le 5ᵉ, le second serait le 6ᵉ.
    await base.query(
      `insert into public.envois_formulaire (empreinte_ip, cle_envoi)
       select $1, gen_random_uuid() from generate_series(1, 4)`,
      [ip],
    );
    const a = new Client({ connectionString: variable("SUPABASE_DB_URL") });
    const b = new Client({ connectionString: variable("SUPABASE_DB_URL") });
    await Promise.all([a.connect(), b.connect()]);
    try {
      const cle = crypto.randomUUID();
      await a.query("begin");
      const premier = await deposer(a, ip, cle);
      expect(premier.nouvelle).toBe(true);

      // B : même clé, même empreinte ; bloqué par le verrou tant que A n'a pas validé.
      const { rows: pid } = await b.query<{ pid: number }>("select pg_backend_pid() as pid");
      const second = deposer(b, ip, cle);
      second.catch(() => {}); // évite un rejet non suivi avant l'attente
      for (let essai = 0; ; essai += 1) {
        const { rows } = await base.query<{ attente: string | null }>(
          "select wait_event_type as attente from pg_stat_activity where pid = $1",
          [pid[0].pid],
        );
        if (rows[0]?.attente === "Lock") break;
        if (essai > 100) throw new Error("Le second appel n'attend pas le verrou.");
        await new Promise((r) => setTimeout(r, 50));
      }

      await a.query("commit");
      const resultat = await second;
      expect(resultat).toMatchObject({ reference: premier.reference, nouvelle: false });
      expect(await nombreEnvois(ip)).toBe(5);
    } finally {
      await a.query("rollback").catch(() => {});
      await Promise.all([a.end(), b.end()]);
    }
  });
});

describe("empreintes de plus d'une heure", () => {
  it("effacées à l'envoi suivant ; celles de moins d'une heure restent", async () => {
    await dansTransactionAnnulee(async () => {
      const ancienne = empreinte();
      const recente = empreinte();
      await base.query(
        `insert into public.envois_formulaire (empreinte_ip, cle_envoi, cree_le)
         values ($1, gen_random_uuid(), now() - interval '1 hour 1 second'),
                ($2, gen_random_uuid(), now() - interval '59 minutes')`,
        [ancienne, recente],
      );
      await deposer(base, empreinte());
      expect(await nombreEnvois(ancienne)).toBe(0);
      expect(await nombreEnvois(recente)).toBe(1);
      const { rows } = await base.query<{ n: number }>(
        "select count(*)::int as n from public.envois_formulaire where cree_le < now() - interval '1 hour'",
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe("envois_formulaire — aucune IP en clair", () => {
  it("colonnes : identifiant, empreinte, clé d'envoi, date ; rien d'autre", async () => {
    const { rows } = await base.query<{ colonne: string }>(
      `select column_name as colonne from information_schema.columns
        where table_schema = 'public' and table_name = 'envois_formulaire'
        order by ordinal_position`,
    );
    expect(rows.map((r) => r.colonne)).toEqual(["id", "empreinte_ip", "cle_envoi", "cree_le"]);
  });

  it("une IP en clair est refusée par la base", async () => {
    for (const ip of ["127.0.0.1", "2001:db8::1", "test-ip"]) {
      const erreur = await dansTransactionAnnulee(() =>
        erreurDe(
          base.query(
            "insert into public.envois_formulaire (empreinte_ip, cle_envoi) values ($1, gen_random_uuid())",
            [ip],
          ),
        ),
      );
      expect(erreur.code).toBe("23514");
    }
  });

  it("toutes les lignes présentes sont des empreintes", async () => {
    const { rows } = await base.query<{ n: number }>(
      "select count(*)::int as n from public.envois_formulaire where empreinte_ip !~ '^[0-9a-f]{64}$'",
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("droits (AD-2, AD-15)", () => {
  it("envois_formulaire : RLS activée, aucune règle, aucun droit pour personne", async () => {
    const { rows: rls } = await base.query<{ active: boolean; regles: number }>(
      `select c.relrowsecurity as active,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'public' and p.tablename = 'envois_formulaire') as regles
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'envois_formulaire'`,
    );
    expect(rls).toEqual([{ active: true, regles: 0 }]);

    const { rows } = await base.query<{ droit: string }>(
      `select r.role || ':' || d.droit as droit
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
        cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as d(droit)
        where has_table_privilege(r.role, 'public.envois_formulaire', d.droit)`,
    );
    expect(rows).toEqual([]);
  });

  it("deposer_demande : nouvelle signature pour service_role seul, ancienne supprimée", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r.role, has_function_privilege(r.role, $1, 'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
        order by r.role`,
      [SIGNATURE],
    );
    expect(rows).toEqual([
      { role: "anon", peut: false },
      { role: "authenticated", peut: false },
      { role: "service_role", peut: true },
    ]);
    const { rows: ancienne } = await base.query<{ existe: boolean }>(
      "select to_regprocedure($1) is not null as existe",
      [ANCIENNE_SIGNATURE],
    );
    expect(ancienne[0].existe).toBe(false);
  });

  it("appel direct avec la clé secrète, au-delà de la limite → refusé par la base", async () => {
    const serveur = clientServeur();
    const ip = empreinte();
    const appel = (cle?: string) => appelApi(serveur, ip, "Appel direct", cle);

    for (let i = 0; i < 5; i += 1) {
      const { error } = await appel();
      expect(error).toBeNull();
    }
    const cle = crypto.randomUUID();
    const { data, error } = await appel(cle);
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "P0001", message: TROP });
    expect(await demandeExiste(cle)).toBe(false);
  });

  it("appel direct sans empreinte (ancienne signature) → refusé, rien d'enregistré", async () => {
    const serveur = clientServeur();
    const cle = crypto.randomUUID();
    const { data, error } = await serveur.rpc("deposer_demande", {
      p_cle_envoi: cle,
      p_nom: `${PREFIXE} Ancien appel`,
      p_email: "sophie.garnier@example.com",
      p_telephone: null,
      p_societe: null,
      p_categorie_id: categorieActive,
      p_objet: "Ancien appel",
      p_description: "Description.",
      p_consentement: true,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST202");
    expect(await demandeExiste(cle)).toBe(false);
  });
});
