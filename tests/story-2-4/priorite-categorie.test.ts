import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { appeler } from "@/lib/server/appeler";
import { lireCategoriesAvec } from "@/lib/categories";
import { lireDetailAvec } from "@/lib/detail-demande";
import type { Priorite, Statut } from "@/lib/domaine";
import { phraseLigneHistorique } from "@/components/nova/historique";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 2.4 — `changer_priorite` et `changer_categorie` sur la vraie base
// (migration 20261103000017) : cas de la matrice, date écrite par le
// déclencheur (AD-22), une ligne d'historique (codes ou identifiants), même
// valeur sans ligne, quel que soit le statut, catégorie désactivée, droits.
// Base partagée : données propres `TEST-2.4-…`, effacées à la fin. Les
// catégories partagées ne sont jamais modifiées : la catégorie « désactivée »
// est une catégorie `TEST-…` jetable, créée inactive.

const CODE = randomUUID().slice(0, 8);
const PREFIXE = `TEST-2.4-${CODE}`;
const PERMISSION_REFUSEE = "42501";

const comptes: CompteTest[] = [];
let karim: CompteTest;
let desactive: CompteTest;
let invite: CompteTest;
let sessionKarim: SupabaseClient;
const sessions: SupabaseClient[] = [];

let base: Client;
type Categorie = { id: string; nom: string };
let information: Categorie; // première catégorie active (celle des demandes de test)
let technique: Categorie; // deuxième catégorie active
let desactivee: Categorie; // catégorie TEST- jetable, inactive

beforeAll(async () => {
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.4" });
  comptes.push(karim);
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.4" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", prenom: "Ines", etiquette: "2.4" });
  comptes.push(invite);

  sessionKarim = await clientConnecte(karim);
  sessions.push(sessionKarim);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();

  const { rows } = await base.query<Categorie>(
    "select id, nom from public.categories where actif order by ordre, nom limit 2",
  );
  if (rows.length < 2) throw new Error("Deux catégories actives sont nécessaires.");
  [information, technique] = rows;
  const { rows: creee } = await base.query<Categorie>(
    `insert into public.categories (nom, actif, ordre) values ($1, false, 999)
     returning id, nom`,
    [`${PREFIXE} Ancienne`],
  );
  desactivee = creee[0];
}, 60_000);

afterAll(async () => {
  // Demandes d'abord (historique en cascade), puis la catégorie jetable.
  let demandesNettoyees = !base;
  try {
    if (base) {
      await supprimerDemandesTest(base, PREFIXE);
      demandesNettoyees = true;
      await base.query("delete from public.categories where nom like $1", [`${PREFIXE}%`]);
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

type Etat = { priorite: Priorite; categorie_id: string; statut: Statut; mis_a_jour_le: Date };

async function etat(d: DemandeTest): Promise<Etat> {
  const { rows } = await base.query<Etat>(
    "select priorite, categorie_id, statut, mis_a_jour_le from public.demandes where id = $1",
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
       from public.historique where demande_id = $1 order by id`,
    [d.id],
  );
  return rows;
}

function priorite(client: SupabaseClient, id: string, valeur: unknown) {
  return client.rpc("changer_priorite", { p_demande_id: id, p_priorite: valeur });
}

function categorie(client: SupabaseClient, id: string, valeur: unknown) {
  return client.rpc("changer_categorie", { p_demande_id: id, p_categorie_id: valeur });
}

describe("changer_priorite", () => {
  it("Normale → Haute : une ligne d'historique (codes), date par le déclencheur", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    expect(avant.priorite).toBe("normale");

    const { data, error } = await priorite(sessionKarim, d.id, "haute");
    expect(error).toBeNull();
    expect(data).toEqual({ id: d.id, priorite: "haute", modifiee: true });

    const apres = await etat(d);
    expect(apres.priorite).toBe("haute");
    expect(apres.mis_a_jour_le.getTime()).toBeGreaterThan(avant.mis_a_jour_le.getTime());

    const lignes = await historique(d);
    expect(lignes.map((l) => l.type)).toEqual(["creation", "changement_priorite"]);
    expect(lignes[1]).toEqual({
      type: "changement_priorite",
      auteur_type: "membre",
      auteur_id: karim.id,
      ancienne_valeur: "normale",
      nouvelle_valeur: "haute",
    });
  });

  it("même valeur (Haute → Haute) : rien ne change, aucune ligne", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { priorite: "haute" });
    const avant = await etat(d);
    const { data, error } = await priorite(sessionKarim, d.id, "haute");
    expect(error).toBeNull();
    expect(data).toEqual({ id: d.id, priorite: "haute", modifiee: false });
    expect(await etat(d)).toEqual(avant);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it.each(["urgente", "Haute", "", null])(
    "priorité inconnue (%j) : DONNEES_INVALIDES, rien ne change",
    async (valeur) => {
      const d = await creerDemandeTest(base, PREFIXE);
      const avant = await etat(d);
      const { error } = await priorite(sessionKarim, d.id, valeur);
      expect(error?.code).toBe("P0001");
      expect(error?.message).toBe("DONNEES_INVALIDES");
      expect(await etat(d)).toEqual(avant);
      expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
    },
  );

  it.each(["nouvelle", "en_cours", "traitee"] as const)(
    "demande %s : accepté (quel que soit le statut)",
    async (statut) => {
      const d = await creerDemandeTest(base, PREFIXE, {
        statut,
        responsableId: statut === "nouvelle" ? null : karim.id,
      });
      const { error } = await priorite(sessionKarim, d.id, "basse");
      expect(error).toBeNull();
      expect(await etat(d)).toMatchObject({ statut, priorite: "basse" });
    },
  );

  it("demande inconnue : DEMANDE_INTROUVABLE", async () => {
    const { error } = await priorite(sessionKarim, randomUUID(), "haute");
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
  });

  it("par appeler() avec la session : { ok: true, donnees }", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    expect(
      await appeler(sessionKarim, "changer_priorite", { p_demande_id: d.id, p_priorite: "haute" }),
    ).toEqual({ ok: true, donnees: { id: d.id, priorite: "haute", modifiee: true } });
  });

  it("deux changements simultanés : deux lignes qui s'enchaînent, dans l'ordre d'écriture", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const session2 = await clientConnecte(karim);
    try {
      const resultats = await Promise.all([
        priorite(sessionKarim, d.id, "haute"),
        priorite(session2, d.id, "basse"),
      ]);
      expect(resultats.map((r) => r.error)).toEqual([null, null]);
    } finally {
      await session2.auth.signOut({ scope: "local" }).catch(() => {});
    }
    const lignes = (await historique(d)).filter((l) => l.type === "changement_priorite");
    expect(lignes).toHaveLength(2);
    // La seconde part de la valeur écrite par la première.
    expect(lignes[0].ancienne_valeur).toBe("normale");
    expect(lignes[1].ancienne_valeur).toBe(lignes[0].nouvelle_valeur);
    expect((await etat(d)).priorite).toBe(lignes[1].nouvelle_valeur);

    // Même ordre à l'affichage (la transaction bloquée a un `now()` antérieur).
    const detail = await lireDetailAvec(sessionKarim, d.reference);
    if (!detail.ok || detail.donnees === null) throw new Error("détail attendu");
    const affichees = detail.donnees.historique
      .filter((l) => l.type === "changement_priorite")
      .map((l) => [l.ancienneValeur, l.nouvelleValeur]);
    expect(affichees).toEqual(lignes.map((l) => [l.ancienne_valeur, l.nouvelle_valeur]));
  });
});

describe("changer_categorie", () => {
  it("Information → Problème technique : une ligne d'historique (identifiants), noms à l'affichage", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    expect(avant.categorie_id).toBe(information.id);

    const { data, error } = await categorie(sessionKarim, d.id, technique.id);
    expect(error).toBeNull();
    expect(data).toEqual({ id: d.id, categorie_id: technique.id, modifiee: true });

    const apres = await etat(d);
    expect(apres.categorie_id).toBe(technique.id);
    expect(apres.mis_a_jour_le.getTime()).toBeGreaterThan(avant.mis_a_jour_le.getTime());

    const lignes = await historique(d);
    expect(lignes[1]).toEqual({
      type: "changement_categorie",
      auteur_type: "membre",
      auteur_id: karim.id,
      ancienne_valeur: information.id,
      nouvelle_valeur: technique.id,
    });

    const detail = await lireDetailAvec(sessionKarim, d.reference);
    if (!detail.ok || detail.donnees === null) throw new Error("détail attendu");
    const ligne = detail.donnees.historique[1];
    expect(phraseLigneHistorique(ligne, detail.donnees)).toBe(
      `${karim.nom} a changé la catégorie : ${information.nom} → ${technique.nom}`,
    );
  });

  it("même valeur : rien ne change, aucune ligne", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    const { data, error } = await categorie(sessionKarim, d.id, information.id);
    expect(error).toBeNull();
    expect(data).toEqual({ id: d.id, categorie_id: information.id, modifiee: false });
    expect(await etat(d)).toEqual(avant);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it.each([
    ["désactivée", () => desactivee.id],
    ["inconnue", () => randomUUID()],
    ["absente (null)", () => null],
  ])("catégorie %s : CATEGORIE_INVALIDE, rien ne change", async (_cas, valeur) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    const { error } = await categorie(sessionKarim, d.id, valeur());
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("CATEGORIE_INVALIDE");
    expect(await etat(d)).toEqual(avant);
    expect((await historique(d)).map((l) => l.type)).toEqual(["creation"]);
  });

  it("demande d'une catégorie désactivée : la garde (même valeur acceptée), peut en changer", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    await base.query("update public.demandes set categorie_id = $2 where id = $1", [
      d.id,
      desactivee.id,
    ]);
    const memeValeur = await categorie(sessionKarim, d.id, desactivee.id);
    expect(memeValeur.error).toBeNull();
    expect(memeValeur.data).toMatchObject({ modifiee: false });
    // Priorité modifiable sans toucher à la catégorie (règle 9).
    expect((await priorite(sessionKarim, d.id, "haute")).error).toBeNull();
    expect((await etat(d)).categorie_id).toBe(desactivee.id);

    expect((await categorie(sessionKarim, d.id, technique.id)).error).toBeNull();
    expect((await etat(d)).categorie_id).toBe(technique.id);
    // Une fois quittée, elle ne peut plus être reprise.
    expect((await categorie(sessionKarim, d.id, desactivee.id)).error?.message).toBe(
      "CATEGORIE_INVALIDE",
    );
  });

  it("catégorie renommée : l'ancienne ligne d'historique affiche le nom actuel", async () => {
    const d = await creerDemandeTest(base, PREFIXE);
    await base.query("update public.demandes set categorie_id = $2 where id = $1", [
      d.id,
      desactivee.id,
    ]);
    expect((await categorie(sessionKarim, d.id, technique.id)).error).toBeNull();
    const nouveauNom = `${PREFIXE} Renommée`;
    await base.query("update public.categories set nom = $2 where id = $1", [
      desactivee.id,
      nouveauNom,
    ]);
    try {
      const detail = await lireDetailAvec(sessionKarim, d.reference);
      if (!detail.ok || detail.donnees === null) throw new Error("détail attendu");
      const ligne = detail.donnees.historique.find((l) => l.type === "changement_categorie")!;
      expect(phraseLigneHistorique(ligne, detail.donnees)).toBe(
        `${karim.nom} a changé la catégorie : ${nouveauNom} → ${technique.nom}`,
      );
    } finally {
      await base.query("update public.categories set nom = $2 where id = $1", [
        desactivee.id,
        desactivee.nom,
      ]);
    }
  });

  it("demande Traitée : accepté", async () => {
    const d = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: karim.id });
    expect((await categorie(sessionKarim, d.id, technique.id)).error).toBeNull();
    expect(await etat(d)).toMatchObject({ statut: "traitee", categorie_id: technique.id });
  });

  it("demande inconnue : DEMANDE_INTROUVABLE", async () => {
    const { error } = await categorie(sessionKarim, randomUUID(), technique.id);
    expect(error?.message).toBe("DEMANDE_INTROUVABLE");
  });
});

describe("lireCategoriesAvec (session)", () => {
  it("catégories actives dans l'ordre des formulaires, catégorie actuelle avec son état réel", async () => {
    const { rows } = await base.query<Categorie>(
      "select id, nom from public.categories where actif and nom not like 'TEST-%' order by ordre, nom",
    );
    // Base partagée : d'autres tests (story 5.2…) ajoutent un instant des
    // catégories « TEST-… » actives ; seules les vraies catégories sont comparées.
    const reelles = (liste: Categorie[]) => liste.filter((c) => !c.nom.startsWith("TEST-"));
    const active = await lireCategoriesAvec(sessionKarim, technique.id);
    if (!active.ok) throw new Error("lecture attendue");
    expect(reelles(active.donnees.actives)).toEqual(rows);
    expect(active.donnees.actuelle).toEqual({ ...technique, actif: true });
    const inactive = await lireCategoriesAvec(sessionKarim, desactivee.id);
    if (!inactive.ok) throw new Error("lecture attendue");
    expect(reelles(inactive.donnees.actives)).toEqual(rows);
    expect(inactive.donnees.actuelle).toEqual({ ...desactivee, actif: false });
  });

  it("compte désactivé : aucune catégorie (RLS)", async () => {
    const client = await clientConnecte(desactive);
    try {
      expect(await lireCategoriesAvec(client, technique.id)).toEqual({
        ok: true,
        donnees: { actives: [], actuelle: null },
      });
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
  });
});

describe("droits", () => {
  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ])("compte %s : DROIT_INSUFFISANT pour les deux fonctions, rien ne change", async (_nom, compte) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    const client = await clientConnecte(compte());
    try {
      expect((await priorite(client, d.id, "haute")).error?.message).toBe("DROIT_INSUFFISANT");
      expect((await categorie(client, d.id, technique.id)).error?.message).toBe("DROIT_INSUFFISANT");
    } finally {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    expect(await etat(d)).toEqual(avant);
  });

  it.each([
    ["visiteur (clé publiable sans session)", () => clientPubliableTest()],
    ["clé secrète", () => clientServiceTest()],
  ])("%s : droit refusé", async (_nom, client) => {
    const d = await creerDemandeTest(base, PREFIXE);
    const avant = await etat(d);
    expect((await priorite(client(), d.id, "haute")).error?.code).toBe(PERMISSION_REFUSEE);
    expect((await categorie(client(), d.id, technique.id)).error?.code).toBe(PERMISSION_REFUSEE);
    expect(await etat(d)).toEqual(avant);
  });

  it.each(["changer_priorite(uuid, text)", "changer_categorie(uuid, uuid)"])(
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

  it("aucune des deux fonctions n'écrit elle-même mis_a_jour_le (AD-22)", async () => {
    const { rows } = await base.query<{ nom: string }>(
      `select p.proname as nom from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('changer_priorite', 'changer_categorie')
          and pg_get_functiondef(p.oid) ~* '(traitee_le|mis_a_jour_le)'`,
    );
    expect(rows).toEqual([]);
  });
});
