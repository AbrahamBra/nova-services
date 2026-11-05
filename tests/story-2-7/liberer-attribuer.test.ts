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

// Story 2.7 — `liberer` et `attribuer` sur la vraie base (migrations
// 20261103000022 et 20261103000023) : matrice de la spec, une seule ligne d'historique par
// action, idempotence (double clic), appels simultanés, droits EXECUTE.
// Base partagée : données propres `TEST-2.7-…`, effacées à la fin.

const PREFIXE = `TEST-2.7-${randomUUID().slice(0, 8)}`;
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
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.7" });
  comptes.push(karim);
  nadia = await creerCompteTest({ role: "collaborateur", prenom: "Nadia", etiquette: "2.7" });
  comptes.push(nadia);
  claire = await creerCompteTest({ role: "administrateur", prenom: "Claire", etiquette: "2.7" });
  comptes.push(claire);
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.7" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", prenom: "Ines", etiquette: "2.7" });
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

type EtatDemande = { statut: string; responsable_id: string | null };

async function etat(d: DemandeTest): Promise<EtatDemande> {
  const { rows } = await base.query<EtatDemande>(
    "select statut, responsable_id from public.demandes where id = $1",
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

async function types(d: DemandeTest): Promise<string[]> {
  return (await historique(d)).map((l) => l.type);
}

function liberer(client: SupabaseClient, id: string) {
  return client.rpc("liberer", { p_demande_id: id });
}

function attribuer(client: SupabaseClient, id: string, membre: string) {
  return client.rpc("attribuer", { p_demande_id: id, p_membre_id: membre });
}

// --- liberer -----------------------------------------------------------------

describe("liberer — réussite", () => {
  it("responsable : Nouvelle, sans responsable, une ligne `liberation` (ancienne = l'ancien responsable)", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const { data, error } = await liberer(sessionKarim, d.id);
    expect(error).toBeNull();
    expect(data).toEqual({ id: d.id, statut: "nouvelle", responsable_id: null });
    expect(await etat(d)).toEqual({ statut: "nouvelle", responsable_id: null });
    expect(await historique(d)).toEqual([
      expect.objectContaining({ type: "creation" }),
      {
        type: "liberation",
        auteur_type: "membre",
        auteur_id: karim.id,
        ancienne_valeur: karim.id,
        nouvelle_valeur: null,
      },
    ]);
  });

  it("administratrice non responsable : même effet, elle est l'auteur", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const { error } = await liberer(sessionClaire, d.id);
    expect(error).toBeNull();
    expect(await etat(d)).toEqual({ statut: "nouvelle", responsable_id: null });
    const lignes = (await historique(d)).filter((l) => l.type === "liberation");
    expect(lignes).toEqual([
      expect.objectContaining({ auteur_id: claire.id, ancienne_valeur: karim.id, nouvelle_valeur: null }),
    ]);
  });

  it("par appeler() avec la session : { ok: true, donnees }", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: nadia.id });
    expect(await appeler(sessionNadia, "liberer", { p_demande_id: d.id })).toEqual({
      ok: true,
      donnees: { id: d.id, statut: "nouvelle", responsable_id: null },
    });
  });
});

describe("liberer — double clic", () => {
  it("deux appels de suite : réussite les deux fois, une seule ligne d'historique", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    expect((await liberer(sessionKarim, d.id)).error).toBeNull();
    const second = await liberer(sessionKarim, d.id);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ id: d.id, statut: "nouvelle", responsable_id: null });
    expect(await types(d)).toEqual(["creation", "liberation"]);
  });

  it("deux appels simultanés : une seule ligne d'historique", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const [a, b] = await Promise.all([liberer(sessionKarim, d.id), liberer(sessionKarim, d.id)]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(await types(d)).toEqual(["creation", "liberation"]);
  });
});

describe("liberer — refus", () => {
  it("collaborateur non responsable : DROIT_INSUFFISANT, rien ne change", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const { data, error } = await liberer(sessionNadia, d.id);
    expect(data).toBeNull();
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DROIT_INSUFFISANT");
    expect(await etat(d)).toEqual({ statut: "en_cours", responsable_id: karim.id });
    expect(await types(d)).toEqual(["creation"]);
  });

  it("Traitée : PASSAGE_INTERDIT, même pour le responsable", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: karim.id });
    const { error } = await liberer(sessionKarim, d.id);
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    const admin = await liberer(sessionClaire, d.id);
    expect(admin.error?.message).toBe("PASSAGE_INTERDIT");
    expect(await etat(d)).toEqual({ statut: "traitee", responsable_id: karim.id });
    expect(await types(d)).toEqual(["creation"]);
  });

  it("identifiant inconnu : DEMANDE_INTROUVABLE", async () => {
    const { error } = await liberer(sessionKarim, randomUUID());
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
  });

  it("collaborateur sur une Nouvelle libérée par un autre : PASSAGE_INTERDIT, pas de réussite", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    expect((await liberer(sessionKarim, d.id)).error).toBeNull();
    const { data, error } = await liberer(sessionNadia, d.id);
    expect(data).toBeNull();
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    // L'auteur de la libération et un administrateur gardent la réussite.
    expect((await liberer(sessionKarim, d.id)).error).toBeNull();
    expect((await liberer(sessionClaire, d.id)).error).toBeNull();
    expect(await etat(d)).toEqual({ statut: "nouvelle", responsable_id: null });
    expect(await types(d)).toEqual(["creation", "liberation"]);
  });

  it("collaborateur sur une Nouvelle jamais libérée : PASSAGE_INTERDIT", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await liberer(sessionKarim, d.id);
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect(await types(d)).toEqual(["creation"]);
  });

  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ])("compte %s : DROIT_INSUFFISANT", async (_nom, compte) => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const client = await clientConnecte(compte());
    try {
      const { error } = await liberer(client, d.id);
      expect(error?.message).toBe("DROIT_INSUFFISANT");
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    expect(await etat(d)).toEqual({ statut: "en_cours", responsable_id: karim.id });
  });

  it("visiteur et clé secrète : droit refusé", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    expect((await liberer(clientPubliableTest(), d.id)).error?.code).toBe(PERMISSION_REFUSEE);
    expect((await liberer(clientServiceTest(), d.id)).error?.code).toBe(PERMISSION_REFUSEE);
    expect(await etat(d)).toEqual({ statut: "en_cours", responsable_id: karim.id });
  });
});

// --- attribuer ---------------------------------------------------------------

describe("attribuer — réussite", () => {
  it("Nouvelle → En cours, cible responsable, UNE ligne `attribution` (ancienne null)", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { data, error } = await attribuer(sessionClaire, d.id, karim.id);
    expect(error).toBeNull();
    expect(data).toEqual({ id: d.id, statut: "en_cours", responsable_id: karim.id });
    expect(await etat(d)).toEqual({ statut: "en_cours", responsable_id: karim.id });
    expect(await historique(d)).toEqual([
      expect.objectContaining({ type: "creation" }),
      {
        type: "attribution",
        auteur_type: "membre",
        auteur_id: claire.id,
        ancienne_valeur: null,
        nouvelle_valeur: karim.id,
      },
    ]);
  });

  it("réattribution d'une demande En cours d'un autre : nouvelle cible, une ligne", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const { error } = await attribuer(sessionClaire, d.id, nadia.id);
    expect(error).toBeNull();
    expect(await etat(d)).toEqual({ statut: "en_cours", responsable_id: nadia.id });
    expect((await historique(d)).filter((l) => l.type === "attribution")).toEqual([
      expect.objectContaining({ auteur_id: claire.id, ancienne_valeur: karim.id, nouvelle_valeur: nadia.id }),
    ]);
  });

  it("à elle-même : l'administratrice devient responsable", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    expect((await attribuer(sessionClaire, d.id, claire.id)).error).toBeNull();
    expect(await etat(d)).toEqual({ statut: "en_cours", responsable_id: claire.id });
  });

  it("par appeler() avec la session : { ok: true, donnees }", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    expect(
      await appeler(sessionClaire, "attribuer", { p_demande_id: d.id, p_membre_id: nadia.id }),
    ).toEqual({ ok: true, donnees: { id: d.id, statut: "en_cours", responsable_id: nadia.id } });
  });
});

describe("attribuer — double clic", () => {
  it("cible déjà responsable : réussite sans nouvelle ligne", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    expect((await attribuer(sessionClaire, d.id, karim.id)).error).toBeNull();
    const second = await attribuer(sessionClaire, d.id, karim.id);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ id: d.id, statut: "en_cours", responsable_id: karim.id });
    expect(await types(d)).toEqual(["creation", "attribution"]);
  });

  it("deux appels simultanés : une seule ligne d'historique", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const [a, b] = await Promise.all([
      attribuer(sessionClaire, d.id, karim.id),
      attribuer(sessionClaire, d.id, karim.id),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(await types(d)).toEqual(["creation", "attribution"]);
  });

  it("attribution et prise en charge simultanées : un seul responsable, une ligne par changement", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const [a, p] = await Promise.all([
      attribuer(sessionClaire, d.id, karim.id),
      sessionNadia.rpc("prendre_en_charge", { p_demande_id: d.id }),
    ]);
    expect(a.error).toBeNull();
    const final = await etat(d);
    expect(final.statut).toBe("en_cours");
    const lignes = await historique(d);
    if (p.error === null) {
      // Prise en charge d'abord, puis réattribution à Karim.
      expect(lignes.map((l) => l.type)).toEqual(["creation", "prise_en_charge", "attribution"]);
    } else {
      expect(p.error.message).toBe("DEJA_PRISE");
      expect(lignes.map((l) => l.type)).toEqual(["creation", "attribution"]);
    }
    expect(final.responsable_id).toBe(karim.id);
  });
});

describe("attribuer — refus", () => {
  it("collaborateur : DROIT_INSUFFISANT, rien ne change", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { data, error } = await attribuer(sessionKarim, d.id, karim.id);
    expect(data).toBeNull();
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DROIT_INSUFFISANT");
    expect(await etat(d)).toEqual({ statut: "nouvelle", responsable_id: null });
    expect(await types(d)).toEqual(["creation"]);
  });

  it("droit vérifié en premier : collaborateur sur une demande inconnue → DROIT_INSUFFISANT", async () => {
    const { error } = await attribuer(sessionKarim, randomUUID(), randomUUID());
    expect(error?.message).toBe("DROIT_INSUFFISANT");
  });

  it.each([
    ["désactivé", () => desactive.id],
    ["invité", () => invite.id],
    ["inconnu", () => randomUUID()],
  ])("cible %s : MEMBRE_INVALIDE, rien ne change", async (_nom, cible) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const { error } = await attribuer(sessionClaire, d.id, cible());
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("MEMBRE_INVALIDE");
    expect(await etat(d)).toEqual({ statut: "nouvelle", responsable_id: null });
    expect(await types(d)).toEqual(["creation"]);
  });

  it("Traitée : PASSAGE_INTERDIT, rien ne change", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: karim.id });
    const { error } = await attribuer(sessionClaire, d.id, nadia.id);
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect(await etat(d)).toEqual({ statut: "traitee", responsable_id: karim.id });
    expect(await types(d)).toEqual(["creation"]);
  });

  it("Traitée avec une cible inactive : PASSAGE_INTERDIT (le statut est vérifié avant le membre)", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: karim.id });
    const { error } = await attribuer(sessionClaire, d.id, desactive.id);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("PASSAGE_INTERDIT");
    expect(await etat(d)).toEqual({ statut: "traitee", responsable_id: karim.id });
    expect(await types(d)).toEqual(["creation"]);
  });

  it("identifiant inconnu : DEMANDE_INTROUVABLE", async () => {
    const { error } = await attribuer(sessionClaire, randomUUID(), karim.id);
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
  });

  it("administrateur désactivé : DROIT_INSUFFISANT", async () => {
    const ancien = await creerCompteTest({
      role: "administrateur",
      etat: "desactive",
      prenom: "Paul",
      etiquette: "2.7",
    });
    comptes.push(ancien);
    const d = await creerDemandeTest(base, PREFIXE);
    const client = await clientConnecte(ancien);
    try {
      expect((await attribuer(client, d.id, karim.id)).error?.message).toBe("DROIT_INSUFFISANT");
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    expect(await etat(d)).toEqual({ statut: "nouvelle", responsable_id: null });
  });

  it("visiteur et clé secrète : droit refusé", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    expect((await attribuer(clientPubliableTest(), d.id, karim.id)).error?.code).toBe(PERMISSION_REFUSEE);
    expect((await attribuer(clientServiceTest(), d.id, karim.id)).error?.code).toBe(PERMISSION_REFUSEE);
    expect(await etat(d)).toEqual({ statut: "nouvelle", responsable_id: null });
  });
});

// --- liberer et attribuer simultanés -----------------------------------------

describe("liberer et attribuer simultanés", () => {
  it("même demande En cours : état final cohérent, une ligne par changement réel", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: karim.id });
    const [l, a] = await Promise.all([
      liberer(sessionKarim, d.id),
      attribuer(sessionClaire, d.id, nadia.id),
    ]);
    expect(a.error).toBeNull();
    // Dans les deux ordres, Nadia finit responsable d'une demande En cours.
    expect(await etat(d)).toEqual({ statut: "en_cours", responsable_id: nadia.id });
    const lignes = await historique(d);
    if (l.error === null) {
      // Libération d'abord, puis attribution depuis Nouvelle.
      expect(lignes.map((x) => x.type)).toEqual(["creation", "liberation", "attribution"]);
      expect(lignes[2]).toEqual(
        expect.objectContaining({ ancienne_valeur: null, nouvelle_valeur: nadia.id }),
      );
    } else {
      // Attribution d'abord : Karim n'est plus responsable.
      expect(l.error.message).toBe("DROIT_INSUFFISANT");
      expect(lignes.map((x) => x.type)).toEqual(["creation", "attribution"]);
      expect(lignes[1]).toEqual(
        expect.objectContaining({ ancienne_valeur: karim.id, nouvelle_valeur: nadia.id }),
      );
    }
  });
});

// --- Droits --------------------------------------------------------------------

describe("liberer et attribuer — droits EXECUTE", () => {
  it.each(["public.liberer(uuid)", "public.attribuer(uuid, uuid)"])(
    "%s accordée à authenticated seulement",
    async (fonction) => {
      const { rows } = await base.query<{ role: string; peut: boolean }>(
        `select r as role, has_function_privilege(r, $1, 'EXECUTE') as peut
           from unnest(array['anon', 'authenticated', 'service_role']) as r`,
        [fonction],
      );
      expect(Object.fromEntries(rows.map((l) => [l.role, l.peut]))).toEqual({
        anon: false,
        authenticated: true,
        service_role: false,
      });
    },
  );

  it("SECURITY DEFINER, search_path vide", async () => {
    const { rows } = await base.query<{ nom: string; definer: boolean; config: string[] | null }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('liberer', 'attribuer')
        order by p.proname`,
    );
    expect(rows.map((r) => r.nom)).toEqual(["attribuer", "liberer"]);
    for (const r of rows) {
      expect(r.definer).toBe(true);
      expect(r.config).toContain('search_path=""');
    }
  });
});
