import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { TYPE_EVENEMENT_JOURNAL, clesJournalValides, descriptionJournal } from "@/lib/journal";
import { formaterDuree } from "@/lib/format";
import {
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 5.5 — `compter_expirees` et `purger_expirees` sur le projet de
// développement (migration 20261103000034) : droits (authenticated
// seulement, SECURITY DEFINER, search_path vide), administrateur actif
// seulement, règle (Traitée depuis plus que la durée réglée, dernier passage
// à Traitée), demande rouverte puis traitée récemment, demandes jamais
// traitées, durée réglée, suppression complète (historique, notes),
// registre `effacements`, journal, EXPIREES_CHANGEES (rien n'est supprimé).
//
// Base partagée, deux règles :
//   1. la purge touche TOUTES les demandes expirées de nova-dev (données
//      d'essai comprises) : elle n'est appelée que dans une transaction
//      ANNULÉE ;
//   2. aucun verrou partagé ne doit rester pris longtemps (les autres
//      fichiers créent des demandes — compteur des références — et
//      enregistrent les paramètres) : les demandes `TEST-5.5-…` sont créées
//      et datées par de courtes étapes VALIDÉES (lignes de test seulement,
//      effacées après chaque test), et la transaction annulée ne contient
//      que le comptage, la purge, les vérifications et, au besoin, la durée
//      réglée.
// `traitee_le` est posée par le déclencheur `demandes_dates` : elle est
// forcée dans le passé avec les déclencheurs suspendus le temps d'une seule
// mise à jour (`session_replication_role`, local à une courte transaction).

const PREFIXE = `TEST-5.5-${randomUUID().slice(0, 8)}`;
const LONG = 60_000;

const comptes: CompteTest[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let base: Client;
/** Durée de conservation réglée (lue au départ ; jamais changée hors transaction annulée). */
let duree: number;

beforeAll(async () => {
  admin = await creerCompteTest({ etiquette: "5.5", role: "administrateur", prenom: "Claire" });
  comptes.push(admin);
  collaborateur = await creerCompteTest({ etiquette: "5.5", role: "collaborateur", prenom: "Karim" });
  comptes.push(collaborateur);
  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  const { rows } = await base.query<{ d: number }>(
    "select duree_conservation_mois as d from public.parametres",
  );
  duree = rows[0].d;
}, LONG);

afterEach(async () => {
  // Demandes de test du test qui s'achève (validées), même en échec.
  await base.query("rollback").catch(() => {});
  await supprimerDemandesTest(base, PREFIXE);
}, LONG);

afterAll(async () => {
  try {
    if (base) {
      await supprimerDemandesTest(base, PREFIXE).catch((erreur) =>
        console.error(`Nettoyage des demandes impossible : ${String(erreur)}`),
      );
    }
  } finally {
    await base?.end().catch(() => {});
    await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
      console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
    );
    await supprimerComptesTest(comptes);
  }
}, LONG);

/**
 * Courte transaction toujours ANNULÉE : rien d'autre que `travail` pendant
 * qu'elle est ouverte. Attente de verrou bornée.
 */
async function annulee<T>(travail: () => Promise<T>): Promise<T> {
  await base.query("begin");
  try {
    await base.query("set local lock_timeout = '10s'");
    return await travail();
  } finally {
    await base.query("rollback");
  }
}

/** Appel SQL au nom d'un membre (rôle authenticated), DANS une transaction ouverte. */
async function enTantQue<T>(c: CompteTest, appel: string, valeurs: unknown[] = []): Promise<T> {
  await base.query("savepoint appel");
  try {
    await base.query("set local role authenticated");
    await base.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: c.id, role: "authenticated" }),
    ]);
    const { rows } = await base.query<{ r: T }>(`select ${appel} as r`, valeurs);
    await base.query("reset role");
    await base.query("release savepoint appel");
    return rows[0].r;
  } catch (erreur) {
    // Erreur prévue : la transaction reste utilisable, rien de l'appel ne reste.
    await base.query("rollback to savepoint appel");
    await base.query("reset role");
    throw erreur;
  }
}

/** Code de l'erreur levée par l'appel (ou « réussite »), DANS une transaction ouverte. */
async function codeDe(c: CompteTest, appel: string, valeurs: unknown[] = []): Promise<string> {
  try {
    await enTantQue(c, appel, valeurs);
    return "réussite";
  } catch (erreur) {
    return (erreur as { message?: string }).message ?? "erreur";
  }
}

type Compte = { nombre: number; duree_mois: number };
const compter = (c: CompteTest = admin) => enTantQue<Compte>(c, "public.compter_expirees()");
const purger = (nombre: number | null, c: CompteTest = admin) =>
  enTantQue<{ nombre: number }>(c, "public.purger_expirees($1)", [nombre]);

/** Nombre de demandes expirées, lu dans sa propre courte transaction annulée. */
const compterSeul = () => annulee(() => compter());

/** Change le statut d'une demande de test (validé ; le déclencheur pose les dates). */
async function statut(d: DemandeTest, valeur: "en_cours" | "traitee") {
  await base.query("update public.demandes set statut = $2 where id = $1", [d.id, valeur]);
}

/**
 * Demande `TEST-5.5-…` VALIDÉE, créée il y a `creeIlYa` ; si `traiteeIlYa`,
 * Traitée à cette date (déclencheurs suspendus pour cette seule mise à jour,
 * dans une courte transaction validée). Sinon le statut donné.
 */
async function demande(options: {
  creeIlYa: string;
  traiteeIlYa?: string;
  statut?: "nouvelle" | "en_cours";
}): Promise<DemandeTest> {
  const d = await creerDemandeTest(base, PREFIXE, {
    decalage: `-${options.creeIlYa}`,
    statut: options.traiteeIlYa ? "traitee" : (options.statut ?? "nouvelle"),
  });
  if (options.traiteeIlYa) {
    await base.query("begin");
    try {
      await base.query("set local session_replication_role = replica");
      await base.query("update public.demandes set traitee_le = now() - $2::interval where id = $1", [
        d.id,
        options.traiteeIlYa,
      ]);
      await base.query("commit");
    } catch (erreur) {
      await base.query("rollback");
      throw erreur;
    }
  }
  return d;
}

/** Il y a `mois` mois. */
const ilYa = (mois: number) => `${mois} months`;

async function existent(demandes: DemandeTest[]): Promise<string[]> {
  const { rows } = await base.query<{ reference: string }>(
    "select reference from public.demandes where id = any($1::uuid[]) order by reference",
    [demandes.map((d) => d.id)],
  );
  return rows.map((l) => l.reference);
}

async function dansRegistre(demandes: DemandeTest[]): Promise<string[]> {
  const { rows } = await base.query<{ reference: string }>(
    "select reference from public.effacements where reference = any($1::text[]) order by reference",
    [demandes.map((d) => d.reference)],
  );
  return rows.map((l) => l.reference);
}

async function journalPurges(c: CompteTest) {
  const { rows } = await base.query<{
    id: string;
    type: string;
    auteur_type: string;
    auteur_id: string;
    details: Record<string, unknown>;
  }>(
    `select id, type, auteur_type, auteur_id, details from public.journal
      where auteur_id = $1 and details ->> 'evenement' = 'expirees_supprimees'
      order by id`,
    [c.id],
  );
  return rows;
}

const refs = (demandes: DemandeTest[]) => demandes.map((d) => d.reference).sort();

describe("droits", () => {
  const FONCTIONS = ["public.compter_expirees()", "public.purger_expirees(integer)"];

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
        where n.nspname = 'public' and p.proname in ('compter_expirees', 'purger_expirees')`,
    );
    expect(definitions).toHaveLength(FONCTIONS.length);
    for (const d of definitions) {
      expect(d.definer, d.nom).toBe(true);
      expect(d.config, d.nom).toContain('search_path=""');
    }
  }, LONG);

  it("collaborateur : DROIT_INSUFFISANT pour compter et supprimer, rien n'est supprimé", async () => {
    const expiree = await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree + 1) });
    const { nombre } = await compterSeul();
    await annulee(async () => {
      expect(await codeDe(collaborateur, "public.compter_expirees()")).toBe("DROIT_INSUFFISANT");
      expect(await codeDe(collaborateur, "public.purger_expirees($1)", [nombre])).toBe("DROIT_INSUFFISANT");
      expect(await existent([expiree])).toEqual([expiree.reference]);
      expect(await journalPurges(collaborateur)).toEqual([]);
    });
  }, LONG);
});

describe("règle : Traitée depuis plus que la durée réglée (dernier passage à Traitée)", () => {
  it("seules les demandes traitées depuis plus que la durée sont comptées et supprimées, avec historique et notes ; registre et journal", async () => {
    const expirees = [
      await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree + 1) }),
      await demande({ creeIlYa: ilYa(duree + 24), traiteeIlYa: ilYa(duree + 16) }),
    ];
    // Rouverte puis traitée récemment : créée et traitée il y a longtemps,
    // rouverte puis retraitée (le déclencheur pose traitee_le à maintenant).
    const rouverte = await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree + 12) });
    await statut(rouverte, "en_cours");
    await statut(rouverte, "traitee");
    const restent = [
      rouverte,
      // Jamais traitées, très anciennes.
      await demande({ creeIlYa: "10 years", statut: "nouvelle" }),
      await demande({ creeIlYa: "10 years", statut: "en_cours" }),
      // Traitée depuis un peu moins que la durée.
      await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree - 1) }),
    ];
    await base.query(
      "insert into public.notes (demande_id, auteur_id, texte) values ($1, $2, 'Note de test 5.5')",
      [expirees[0].id, admin.id],
    );

    await annulee(async () => {
      const avant = await compter();
      expect(avant.duree_mois).toBe(duree);
      expect(avant.nombre).toBeGreaterThanOrEqual(2);

      expect(await purger(avant.nombre)).toEqual({ nombre: avant.nombre });

      expect(await existent(expirees)).toEqual([]);
      expect(await existent(restent)).toEqual(refs(restent));
      const ids = expirees.map((d) => d.id);
      for (const table of ["historique", "notes"]) {
        const { rows } = await base.query(
          `select 1 from public.${table} where demande_id = any($1::uuid[])`,
          [ids],
        );
        expect(rows, table).toEqual([]);
      }
      expect(await dansRegistre(expirees)).toEqual(refs(expirees));
      expect(await dansRegistre(restent)).toEqual([]);
      expect(await compter()).toEqual({ nombre: 0, duree_mois: duree });

      // Journal : type donnees, au nom de l'administratrice, nombre et durée.
      const lignes = await journalPurges(admin);
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toMatchObject({ type: "donnees", auteur_type: "membre", auteur_id: admin.id });
      expect(lignes[0].details).toEqual({
        evenement: "expirees_supprimees",
        nombre: avant.nombre,
        duree_mois: duree,
      });
      expect(TYPE_EVENEMENT_JOURNAL.expirees_supprimees).toBe("donnees");
      expect(clesJournalValides("expirees_supprimees", Object.keys(lignes[0].details))).toBe(true);
      expect(descriptionJournal(lignes[0].details)).toMatch(
        new RegExp(`^\\d+ demandes? expirées? supprimées? \\(traitées? depuis plus de ${formaterDuree(duree)}\\)$`),
      );
      // Jamais une référence, un nom ni un email (AD-14).
      for (const valeur of [PREFIXE, ...refs(expirees)]) {
        const { rows } = await base.query(
          "select id from public.journal where strpos(lower(details::text), lower($1)) > 0",
          [valeur],
        );
        expect(rows, valeur).toEqual([]);
      }

      // Plus rien à supprimer : DONNEES_INVALIDES.
      expect(await codeDe(admin, "public.purger_expirees(0)")).toBe("DONNEES_INVALIDES");
    });
    // Annulée : rien n'a été supprimé pour de bon.
    expect(await existent(expirees)).toEqual(refs(expirees));
  }, LONG);

  it("le calcul suit la durée réglée", async () => {
    // Deux durées à 12 mois d'écart, dans les bornes (6 à 60 mois).
    const courte = duree + 12 <= 60 ? duree : duree - 12;
    const longue = courte + 12;
    const entreLesDeux = await demande({ creeIlYa: ilYa(longue + 12), traiteeIlYa: ilYa(courte + 6) });
    const auDela = await demande({ creeIlYa: ilYa(longue + 12), traiteeIlYa: ilYa(longue + 1) });

    await annulee(async () => {
      await base.query("update public.parametres set duree_conservation_mois = $1", [longue]);
      const { nombre, duree_mois } = await compter();
      expect(duree_mois).toBe(longue);
      expect(await purger(nombre)).toEqual({ nombre });
      // À la durée longue, la demande traitée entre les deux durées reste.
      expect(await existent([entreLesDeux, auDela])).toEqual([entreLesDeux.reference]);
      const [ligne] = await journalPurges(admin);
      expect(ligne.details).toEqual({ evenement: "expirees_supprimees", nombre, duree_mois: longue });

      // À la durée courte, elle expire à son tour.
      await base.query("update public.parametres set duree_conservation_mois = $1", [courte]);
      expect((await compter()).nombre).toBeGreaterThanOrEqual(1);
      const { nombre: restantes } = await compter();
      expect(await purger(restantes)).toEqual({ nombre: restantes });
      expect(await existent([entreLesDeux])).toEqual([]);
    });
  }, LONG);
});

describe("nombre annoncé = nombre supprimé", () => {
  it("une demande expire depuis l'affichage : EXPIREES_CHANGEES, rien n'est supprimé", async () => {
    const premiere = await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree + 1) });
    const { nombre } = await compterSeul();
    const seconde = await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree + 2) });

    await annulee(async () => {
      expect(await codeDe(admin, "public.purger_expirees($1)", [nombre])).toBe("EXPIREES_CHANGEES");
      expect(await existent([premiere, seconde])).toEqual(refs([premiere, seconde]));
      expect(await dansRegistre([premiere, seconde])).toEqual([]);
      expect(await journalPurges(admin)).toEqual([]);
    });
  }, LONG);

  it("une demande est rouverte depuis l'affichage : EXPIREES_CHANGEES, rien n'est supprimé", async () => {
    const a = await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree + 1) });
    const b = await demande({ creeIlYa: ilYa(duree + 12), traiteeIlYa: ilYa(duree + 1) });
    const { nombre } = await compterSeul();
    await statut(a, "en_cours");

    await annulee(async () => {
      expect(await codeDe(admin, "public.purger_expirees($1)", [nombre])).toBe("EXPIREES_CHANGEES");
      expect(await existent([a, b])).toEqual(refs([a, b]));
      expect(await dansRegistre([a, b])).toEqual([]);
    });
  }, LONG);

  it("nombre absent ou négatif : DONNEES_INVALIDES", async () => {
    await annulee(async () => {
      expect(await codeDe(admin, "public.purger_expirees(null)")).toBe("DONNEES_INVALIDES");
      expect(await codeDe(admin, "public.purger_expirees(-1)")).toBe("DONNEES_INVALIDES");
    });
  }, LONG);
});
