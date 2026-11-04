import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { appeler } from "@/lib/server/appeler";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 2.1 — `prendre_en_charge` sur la vraie base (migration
// 20261103000014) : tous les cas de la matrice, prise simultanée par deux
// sessions, une seule ligne d'historique, droits EXECUTE.
// Base partagée : données propres `TEST-2.1-…`, effacées à la fin.

const PREFIXE = `TEST-2.1-${randomUUID().slice(0, 8)}`;
const PERMISSION_REFUSEE = "42501";

const comptes: CompteTest[] = [];
let karim: CompteTest; // collaborateur
let nadia: CompteTest; // second collaborateur
let claire: CompteTest; // administratrice
let desactive: CompteTest;
let invite: CompteTest;
let sessionKarim: SupabaseClient;
let sessionNadia: SupabaseClient;
let sessionClaire: SupabaseClient;
const sessions: SupabaseClient[] = [];

let base: Client;

beforeAll(async () => {
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.1" });
  comptes.push(karim);
  nadia = await creerCompteTest({ role: "collaborateur", prenom: "Nadia", etiquette: "2.1" });
  comptes.push(nadia);
  claire = await creerCompteTest({ role: "administrateur", prenom: "Claire", etiquette: "2.1" });
  comptes.push(claire);
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.1" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", prenom: "Ines", etiquette: "2.1" });
  comptes.push(invite);

  sessionKarim = await clientConnecte(karim);
  sessionNadia = await clientConnecte(nadia);
  sessionClaire = await clientConnecte(claire);
  sessions.push(sessionKarim, sessionNadia, sessionClaire);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  // Demandes d'abord : l'historique (qui cite les comptes) part en cascade.
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

type EtatDemande = {
  statut: string;
  responsable_id: string | null;
  mis_a_jour_le: Date;
};

async function etat(d: DemandeTest): Promise<EtatDemande> {
  const { rows } = await base.query<EtatDemande>(
    "select statut, responsable_id, mis_a_jour_le from public.demandes where id = $1",
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
};

async function historique(d: DemandeTest): Promise<LigneHistorique[]> {
  const { rows } = await base.query<LigneHistorique>(
    `select type, auteur_type, auteur_id, ancienne_valeur, nouvelle_valeur
       from public.historique where demande_id = $1 order by cree_le, id`,
    [d.id],
  );
  return rows;
}

function prendre(client: SupabaseClient, id: string) {
  return client.rpc("prendre_en_charge", { p_demande_id: id });
}

describe("prendre_en_charge — réussite", () => {
  it("collaborateur actif : En cours, responsable, une seule ligne d'historique", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);

    const { data, error } = await prendre(sessionKarim, d.id);
    expect(error).toBeNull();
    expect(data).toEqual({ id: d.id, statut: "en_cours", responsable_id: karim.id });

    const apres = await etat(d);
    expect(apres.statut).toBe("en_cours");
    expect(apres.responsable_id).toBe(karim.id);
    expect(apres.mis_a_jour_le.getTime()).toBeGreaterThanOrEqual(avant.mis_a_jour_le.getTime());

    // Création + UNE ligne de prise en charge (règle 6 du PRD).
    expect(await historique(d)).toEqual([
      expect.objectContaining({ type: "creation", auteur_type: "demandeur" }),
      {
        type: "prise_en_charge",
        auteur_type: "membre",
        auteur_id: karim.id,
        ancienne_valeur: "nouvelle",
        nouvelle_valeur: "en_cours",
      },
    ]);
  });

  it("administrateur actif : même effet", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await prendre(sessionClaire, d.id);
    expect(error).toBeNull();
    expect(await etat(d)).toMatchObject({ statut: "en_cours", responsable_id: claire.id });
  });

  it("par appeler() avec la session : { ok: true, donnees }", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const resultat = await appeler<{ responsable_id: string }>(sessionNadia, "prendre_en_charge", {
      p_demande_id: d.id,
    });
    expect(resultat).toEqual({
      ok: true,
      donnees: { id: d.id, statut: "en_cours", responsable_id: nadia.id },
    });
  });
});

describe("prendre_en_charge — idempotente pour le responsable", () => {
  it("le responsable la reprend (onglet ancien, double clic) : réussite, aucune nouvelle ligne", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const premier = await prendre(sessionKarim, d.id);
    expect(premier.error).toBeNull();

    const second = await prendre(sessionKarim, d.id);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ id: d.id, statut: "en_cours", responsable_id: karim.id });
    expect(await etat(d)).toMatchObject({ statut: "en_cours", responsable_id: karim.id });
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation", "prise_en_charge"]);
  });

  it("deux clics simultanés du même membre : une seule ligne d'historique", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const [a, b] = await Promise.all([prendre(sessionKarim, d.id), prendre(sessionKarim, d.id)]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect((await historique(d)).filter((l) => l.type === "prise_en_charge")).toHaveLength(1);
  });
});

describe("prendre_en_charge — refus", () => {
  it("déjà En cours (prise par Karim) : DEJA_PRISE avec le nom dans le détail, rien ne change", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const { data, error } = await prendre(sessionNadia, d.id);
    expect(data).toBeNull();
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DEJA_PRISE");
    expect(JSON.parse(error?.details ?? "null")).toEqual({ responsable: karim.nom });

    // Lu par appeler() : code, message de repli et détail.
    const resultat = await appeler(sessionNadia, "prendre_en_charge", { p_demande_id: d.id });
    expect(resultat).toMatchObject({ ok: false, code: "DEJA_PRISE", detail: { responsable: karim.nom } });

    expect(await etat(d)).toMatchObject({ statut: "en_cours", responsable_id: karim.id });
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });


  it("Traitée : PASSAGE_INTERDIT, rien ne change", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: karim.id });
    const { error } = await prendre(sessionNadia, d.id);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect(await etat(d)).toMatchObject({ statut: "traitee", responsable_id: karim.id });
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it("Traitée sans responsable (classée sans suite) : PASSAGE_INTERDIT", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee" });
    const { error } = await prendre(sessionNadia, d.id);
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect(await etat(d)).toMatchObject({ statut: "traitee", responsable_id: null });
  });

  it("identifiant inconnu : DEMANDE_INTROUVABLE", async () => {
    const { error } = await prendre(sessionKarim, randomUUID());
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
  });

  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ])("compte %s : DROIT_INSUFFISANT, rien ne change", async (_nom, compte) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const client = await clientConnecte(compte());
    try {
      const { error } = await prendre(client, d.id);
      expect(error?.code).toBe("P0001");
      expect(error?.message).toBe("DROIT_INSUFFISANT");
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    expect(await etat(d)).toMatchObject({ statut: "nouvelle", responsable_id: null });
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it("visiteur (clé publiable sans session) : droit refusé", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await prendre(clientPubliableTest(), d.id);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
    expect(await etat(d)).toMatchObject({ statut: "nouvelle", responsable_id: null });
  });

  it("clé secrète : droit refusé (jamais utilisée pour le traitement)", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await prendre(clientServiceTest(), d.id);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
    expect(await etat(d)).toMatchObject({ statut: "nouvelle", responsable_id: null });
  });
});

describe("prendre_en_charge — simultanéité", () => {
  it("deux membres en même temps : un seul responsable, une seule ligne, DEJA_PRISE pour l'autre", async () => {
    // Plusieurs essais, pour que les deux appels se chevauchent vraiment.
    for (let essai = 0; essai < 3; essai++) {
      const d = await creerDemandeTest(base, PREFIXE);
      const [a, b] = await Promise.all([prendre(sessionKarim, d.id), prendre(sessionNadia, d.id)]);
      const reussites = [a, b].filter((r) => r.error === null);
      const refus = [a, b].filter((r) => r.error !== null);
      expect(reussites).toHaveLength(1);
      expect(refus).toHaveLength(1);
      expect(refus[0].error?.message).toBe("DEJA_PRISE");

      const gagnant = a.error === null ? karim : nadia;
      expect(JSON.parse(refus[0].error?.details ?? "null")).toEqual({ responsable: gagnant.nom });
      expect(await etat(d)).toMatchObject({ statut: "en_cours", responsable_id: gagnant.id });
      const lignes = (await historique(d)).filter((l) => l.type === "prise_en_charge");
      expect(lignes).toHaveLength(1);
      expect(lignes[0].auteur_id).toBe(gagnant.id);
    }
  });
});

describe("prendre_en_charge — droits EXECUTE", () => {
  it("accordée à authenticated seulement dans le catalogue", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r as role,
              has_function_privilege(r, 'public.prendre_en_charge(uuid)', 'EXECUTE') as peut
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
        where n.nspname = 'public' and p.proname = 'prendre_en_charge'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].definer).toBe(true);
    expect(rows[0].config).toContain('search_path=""');
  });
});
