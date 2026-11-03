import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

// Permet de remplacer le client service le temps d'un test (base injoignable).
const surcharge = vi.hoisted(() => ({ client: null as unknown, leve: false }));
vi.mock("@/lib/server/supabase-service", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/server/supabase-service")>();
  return {
    creerClientService: () => {
      if (surcharge.leve) throw new Error("variables d'environnement manquantes");
      return surcharge.client ?? reel.creerClientService();
    },
  };
});

import { lireInfosPubliques } from "@/lib/infos-publiques";

// Story 1.2 — `infos_publiques()` sur le projet de développement (AD-15).

const CATEGORIES_DE_DEPART = [
  "Demande d'information",
  "Problème technique",
  "Demande de rendez-vous",
  "Question administrative",
  "Autre",
];

function variable(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} manquant dans .env.local.`);
  return valeur;
}

describe("infos_publiques — avec la clé secrète (serveur)", () => {
  it("renvoie les 5 catégories de départ dans l'ordre et les paramètres", async () => {
    const resultat = await lireInfosPubliques();

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.categories.map((c) => c.nom)).toEqual(CATEGORIES_DE_DEPART);
    for (const categorie of resultat.donnees.categories) {
      expect(categorie.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(resultat.donnees.nomAffiche).toBe("Nova Services");
    expect(resultat.donnees.emailContact).toBe("contact@nova-services.example");
    expect(resultat.donnees.dureeConservationMois).toBe(24);
  });
});

describe("infos_publiques — avec la clé publiable (visiteur)", () => {
  it("refuse l'appel : pas de droit EXECUTE", async () => {
    const client = createClient(
      variable("NEXT_PUBLIC_SUPABASE_URL"),
      variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await client.rpc("infos_publiques");

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // 42501 : permission refusée (ou fonction masquée par PostgREST).
    expect(["42501", "PGRST202"]).toContain(error?.code);
  });
});

describe("infos_publiques — règles d'affichage (SQL, transaction annulée)", () => {
  let base: Client;

  beforeAll(async () => {
    base = new Client({ connectionString: variable("SUPABASE_DB_URL") });
    await base.connect();
  });

  afterAll(async () => {
    await base?.end();
  });

  async function dansTransactionAnnulee(
    modification: string,
  ): Promise<{ categories: { nom: string }[]; duree_conservation_mois: number }> {
    await base.query("begin");
    try {
      await base.query(modification);
      const { rows } = await base.query("select public.infos_publiques() as infos");
      return rows[0].infos;
    } finally {
      await base.query("rollback").catch(() => {});
    }
  }

  it("EXECUTE accordé à service_role seulement", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r.role, has_function_privilege(r.role, 'public.infos_publiques()', 'EXECUTE') as peut
       from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
       order by r.role`,
    );
    expect(rows).toEqual([
      { role: "anon", peut: false },
      { role: "authenticated", peut: false },
      { role: "service_role", peut: true },
    ]);
  });

  it("n'affiche pas une catégorie désactivée", async () => {
    const infos = await dansTransactionAnnulee(
      "update public.categories set actif = false where nom = 'Problème technique'",
    );
    expect(infos.categories.map((c) => c.nom)).toEqual(
      CATEGORIES_DE_DEPART.filter((nom) => nom !== "Problème technique"),
    );
  });

  it("renvoie la durée modifiée (18 mois)", async () => {
    const infos = await dansTransactionAnnulee(
      "update public.parametres set duree_conservation_mois = 18",
    );
    expect(infos.duree_conservation_mois).toBe(18);
  });

  it("refuse une durée hors bornes (6 à 60 mois)", async () => {
    await expect(
      dansTransactionAnnulee("update public.parametres set duree_conservation_mois = 61"),
    ).rejects.toThrow(/check/i);
  });

  it("refuse une seconde ligne de paramètres", async () => {
    await expect(
      dansTransactionAnnulee(
        "insert into public.parametres (id, nom_affiche, email_contact, duree_conservation_mois) values (false, 'X', 'x@y.example', 24)",
      ),
    ).rejects.toThrow(/check/i);
  });
});

describe("lib/infos-publiques — base injoignable", () => {
  async function avecClient(client: unknown) {
    surcharge.client = client;
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      return await lireInfosPubliques();
    } finally {
      surcharge.client = null;
      silence.mockRestore();
    }
  }

  it("renvoie ERREUR_INATTENDUE si la fonction échoue", async () => {
    const resultat = await avecClient({
      rpc: () =>
        Promise.resolve({ data: null, error: { code: "08006", message: "connexion perdue" } }),
    });
    expect(resultat).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
  });

  it("renvoie ERREUR_INATTENDUE si le client service ne peut pas être créé", async () => {
    surcharge.client = null;
    surcharge.leve = true;
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await lireInfosPubliques()).toEqual({
        ok: false,
        code: "ERREUR_INATTENDUE",
        message: expect.any(String),
      });
    } finally {
      surcharge.leve = false;
      silence.mockRestore();
    }
  });

  it("renvoie ERREUR_INATTENDUE si la réponse est vide (paramètres absents)", async () => {
    const resultat = await avecClient({
      rpc: () => Promise.resolve({ data: null, error: null }),
    });
    expect(resultat).toMatchObject({ ok: false, code: "ERREUR_INATTENDUE" });
  });
});
