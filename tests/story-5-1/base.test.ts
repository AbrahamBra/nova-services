import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { TYPES_JOURNAL } from "@/lib/domaine";
import { TAILLE_PAGE_JOURNAL } from "@/lib/filtres";
import { CLES_DETAILS_JOURNAL, TYPE_EVENEMENT_JOURNAL } from "@/lib/journal";
import {
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest } from "@/tests/outils/demandes";

// Story 5.1 — `lire_journal(p_type, p_page)` sur le projet de développement
// (migration 20261103000030) : droits (authenticated seulement, SECURITY
// DEFINER, search_path vide), administrateur actif seulement, type inconnu
// refusé, tri `cree_le desc, id desc`, 50 lignes par page, filtre par type,
// auteur (nom actuel, système). AD-14 : chaque événement connu n'a que les
// clés attendues (liste fermée de lib/journal.ts), et aucune ligne ne cite le
// nom, l'email, le téléphone ou la société d'une demande de test créée pour
// l'occasion.
// Base partagée : jamais de nombre total exact supposé. Les lignes du tri et
// de la pagination sont insérées dans une transaction ANNULÉE (datées dans le
// futur pour passer en tête) ; les autres viennent des vraies fonctions et
// sont effacées à la fin (comptes, demande et journal `TEST-5.1-…`).

const PREFIXE = `TEST-5.1-${randomUUID().slice(0, 8)}`;

const comptes: CompteTest[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let base: Client;
/** Références des demandes de test dont la ligne `echec_confirmation` est à effacer. */
const references: string[] = [];

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.1", ...options });
  comptes.push(c);
  return c;
}

beforeAll(async () => {
  admin = await compte({ role: "administrateur", prenom: "Claire" });
  collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  if (references.length > 0) {
    try {
      await base.query("begin");
      await base.query("select set_config('nova.purge_journal', 'on', true)");
      await base.query(
        `delete from public.journal
          where type = 'email' and auteur_type = 'systeme'
            and details ->> 'evenement' = 'echec_confirmation'
            and details ->> 'reference' = any($1::text[])`,
        [references],
      );
      await base.query("commit");
    } catch (erreur) {
      await base.query("rollback").catch(() => {});
      console.error(`Nettoyage du journal des emails impossible : ${String(erreur)}`);
    }
  }
  await supprimerDemandesTest(base, PREFIXE).catch((erreur) =>
    console.error(`Nettoyage des demandes impossible : ${String(erreur)}`),
  );
  await base?.end().catch(() => {});
  await supprimerComptesTest(comptes);
}, 60_000);

/** Erreur d'un appel : son code prévu (message P0001), sinon l'erreur. */
async function codeDe(promesse: Promise<unknown>): Promise<string | null> {
  try {
    await promesse;
    return null;
  } catch (erreur) {
    return (erreur as { message?: string }).message ?? String(erreur);
  }
}

/** Passe la transaction en cours sous la session simulée de `c`. */
async function sessionDe(c: CompteTest) {
  await base.query("set local role authenticated");
  await base.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: c.id, role: "authenticated" }),
  ]);
}

/** Appelle une fonction avec la session simulée de `c`, dans sa propre transaction (validée). */
async function enTantQue<T = unknown>(c: CompteTest, sql: string, parametres: unknown[] = []): Promise<T> {
  await base.query("begin");
  try {
    await sessionDe(c);
    const { rows } = await base.query<{ r: T }>(`select ${sql} as r`, parametres);
    await base.query("commit");
    return rows[0].r;
  } catch (erreur) {
    await base.query("rollback").catch(() => {});
    throw erreur;
  }
}

type LigneLue = {
  id: number;
  cree_le: string;
  type: string;
  auteur_type: string;
  auteur_nom: string | null;
  details: Record<string, unknown>;
};
type PageLue = { total: number; lignes: LigneLue[] };

describe("droits", () => {
  it("lire_journal : authenticated seulement, SECURITY DEFINER, search_path vide ; index (type, cree_le desc)", async () => {
    const { rows } = await base.query<{ r: string; peut: boolean }>(
      `select r, has_function_privilege(r, 'public.lire_journal(text, integer)', 'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(rows).toHaveLength(3);
    for (const l of rows) expect(l.peut, l.r).toBe(l.r === "authenticated");

    const { rows: definitions } = await base.query<{ definer: boolean; config: string[] | null }>(
      `select p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'lire_journal'`,
    );
    expect(definitions).toHaveLength(1);
    expect(definitions[0].definer).toBe(true);
    expect(definitions[0].config).toContain('search_path=""');

    const { rows: index } = await base.query<{ def: string }>(
      "select indexdef as def from pg_indexes where schemaname = 'public' and tablename = 'journal'",
    );
    expect(index.map((i) => i.def)).toContainEqual(expect.stringMatching(/\(type, cree_le DESC\)/));

    // Le journal lui-même reste sans aucun droit direct.
    const { rows: table } = await base.query<{ peut: boolean }>(
      `select bool_or(has_table_privilege(r, 'public.journal', 'SELECT')) as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(table[0].peut).toBe(false);
  });

  it("visiteur (clé publiable) : refusé", async () => {
    const { data, error } = await clientPubliableTest().rpc("lire_journal", {});
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("collaborateur : DROIT_INSUFFISANT", async () => {
    expect(await codeDe(enTantQue(collaborateur, "public.lire_journal()"))).toBe("DROIT_INSUFFISANT");
    expect(await codeDe(enTantQue(collaborateur, "public.lire_journal('compte', 1)"))).toBe(
      "DROIT_INSUFFISANT",
    );
  });

  it("administrateur désactivé : DROIT_INSUFFISANT", async () => {
    const ancien = await compte({ role: "administrateur", prenom: "Paul", etat: "desactive" });
    expect(await codeDe(enTantQue(ancien, "public.lire_journal()"))).toBe("DROIT_INSUFFISANT");
  });

  it("chaque type de TYPES_JOURNAL est accepté par lire_journal", async () => {
    for (const type of TYPES_JOURNAL) {
      const page = await enTantQue<PageLue>(admin, "public.lire_journal($1, 1)", [type]);
      expect(Array.isArray(page.lignes), type).toBe(true);
      for (const l of page.lignes) expect(l.type, type).toBe(type);
    }
  });

  it("type inconnu ou page invalide : DONNEES_INVALIDES", async () => {
    for (const sql of [
      "public.lire_journal('xyz', 1)",
      "public.lire_journal('', 1)",
      "public.lire_journal('Compte', 1)",
      "public.lire_journal(null, 0)",
      "public.lire_journal(null, null)",
    ]) {
      expect(await codeDe(enTantQue(admin, sql)), sql).toBe("DONNEES_INVALIDES");
    }
  });
});

describe("lecture", () => {
  it("tri du plus récent au plus ancien, 50 par page, filtre par type, auteur", async () => {
    await base.query("begin");
    try {
      const avant = await base.query<{ n: string }>(
        "select count(*) as n from public.journal where type = 'parametre'",
      );
      // 51 lignes `parametre` datées dans le futur (en tête), la plus récente
      // en dernier ; deux à la même date (départagées par l'id) ; une ligne
      // `categorie` plus récente encore, absente du filtre.
      const { rows: inserees } = await base.query<{ id: string; rang: number }>(
        `insert into public.journal (type, details, auteur_type, auteur_id, cree_le)
         select 'parametre', jsonb_build_object('evenement', 'test_5_1', 'rang', i),
                case when i % 2 = 0 then 'systeme' else 'membre' end,
                case when i % 2 = 0 then null else $1::uuid end,
                now() + interval '100 years' + make_interval(secs => least(i, 50))
           from generate_series(1, 51) as i
         returning id, (details ->> 'rang')::int as rang`,
        [admin.id],
      );
      expect(inserees).toHaveLength(51);
      await base.query(
        `insert into public.journal (type, details, auteur_type, auteur_id, cree_le)
         values ('categorie', '{"evenement": "test_5_1"}', 'systeme', null,
                 now() + interval '100 years' + interval '1 hour')`,
      );
      await sessionDe(admin);

      const page1 = (
        await base.query<{ r: PageLue }>("select public.lire_journal('parametre', 1) as r")
      ).rows[0].r;
      const page2 = (
        await base.query<{ r: PageLue }>("select public.lire_journal('parametre', 2) as r")
      ).rows[0].r;
      const tous = (await base.query<{ r: PageLue }>("select public.lire_journal() as r")).rows[0].r;

      expect(page1.total).toBe(Number(avant.rows[0].n) + 51);
      expect(page2.total).toBe(page1.total);
      expect(page1.lignes).toHaveLength(TAILLE_PAGE_JOURNAL);
      // Rangs 50 et 51 à la même date : l'id le plus grand (51) d'abord.
      const rangs = page1.lignes.map((l) => l.details.rang);
      expect(rangs).toEqual(Array.from({ length: TAILLE_PAGE_JOURNAL }, (_, i) => 51 - i));
      expect(page2.lignes[0].details.rang).toBe(1);
      for (const l of [...page1.lignes, ...page2.lignes]) expect(l.type).toBe("parametre");
      for (let i = 1; i < page1.lignes.length; i++) {
        const [a, b] = [page1.lignes[i - 1], page1.lignes[i]];
        expect(new Date(a.cree_le) >= new Date(b.cree_le)).toBe(true);
      }

      // Auteur : nom actuel du membre, null pour le système.
      const parRang = new Map(page1.lignes.map((l) => [l.details.rang, l]));
      expect(parRang.get(51)).toMatchObject({ auteur_type: "membre", auteur_nom: admin.nom });
      expect(parRang.get(50)).toMatchObject({ auteur_type: "systeme", auteur_nom: null });
      expect(Object.keys(page1.lignes[0]).sort()).toEqual(
        ["auteur_nom", "auteur_type", "cree_le", "details", "id", "type"].sort(),
      );

      // Sans filtre : la ligne `categorie`, plus récente, en tête.
      expect(tous.lignes[0]).toMatchObject({ type: "categorie", auteur_type: "systeme" });
      expect(tous.total).toBeGreaterThanOrEqual(page1.total + 1);
      expect(tous.lignes).toHaveLength(50);

      // Au-delà de la fin : aucune ligne, total inchangé.
      const loin = (
        await base.query<{ r: PageLue }>("select public.lire_journal('parametre', 100000) as r")
      ).rows[0].r;
      expect(loin).toEqual({ total: page1.total, lignes: [] });
    } finally {
      await base.query("rollback");
    }
  });
});

describe("AD-14 : aucune donnée de demandeur, clés en liste fermée", () => {
  it("événements réels de comptes et d'email : clés attendues, demandeur jamais cité", async () => {
    const service = clientServiceTest();

    // Compte créé par l'administrateur (comme l'action `inviter`).
    const code = randomUUID().slice(0, 8);
    const leo: CompteTest = {
      id: "",
      nom: `TEST-5.1-${code} Léo Martin`,
      email: `test-5-1-${code}@example.com`,
      motDePasse: randomBytes(18).toString("base64url"),
      role: "collaborateur",
      etat: "actif",
    };
    const { data, error } = await service.auth.admin.createUser({
      email: leo.email,
      password: leo.motDePasse,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`Compte Auth : ${error?.code ?? error?.status}`);
    leo.id = data.user.id;
    comptes.push(leo);
    const { error: erreurMembre } = await service.rpc("creer_membre", {
      p_id: leo.id,
      p_nom: leo.nom,
      p_email: leo.email,
      p_role: "collaborateur",
      p_etat: "actif",
      p_auteur_id: admin.id,
    });
    expect(erreurMembre).toBeNull();

    // Les autres événements de comptes, par les vraies fonctions.
    await enTantQue(admin, "public.modifier_membre($1, $2, 'administrateur')", [leo.id, `${leo.nom}e`]);
    await enTantQue(admin, "public.desactiver_membre($1)", [leo.id]);
    await enTantQue(admin, "public.reactiver_membre($1)", [leo.id]);
    await enTantQue(admin, "public.noter_lien_mot_de_passe($1)", [leo.id]);
    const invite = await compte({ prenom: "Ines", etat: "invite" });
    await enTantQue(admin, "public.noter_renvoi_invitation($1)", [invite.id]);
    await enTantQue(admin, "public.annuler_invitation($1)", [invite.id]);

    // Demande de test aux coordonnées reconnaissables, puis échec de son email.
    const marque = randomUUID().slice(0, 8);
    const demandeur = {
      nom: `Jean Dupont-${marque}`,
      email: `jean.dupont.${marque}@example.com`,
      telephone: `06 ${marque.slice(0, 2)} 12 34 56`.replace(/[a-f]/g, "7"),
      societe: `Société ${marque}`,
    };
    const demande = await creerDemandeTest(base, PREFIXE, {
      nomDemandeur: demandeur.nom,
      email: demandeur.email,
      telephone: demandeur.telephone,
      societe: demandeur.societe,
    });
    references.push(demande.reference);
    await base.query("select public.noter_resultat_email($1, 'echec', 'invalid_api_key')", [demande.id]);

    // Les lignes attendues sont bien là (sinon la vérification ne prouverait rien).
    const { rows: miennes } = await base.query<{ evenement: string }>(
      `select details ->> 'evenement' as evenement from public.journal
        where auteur_id = $1
           or (details ->> 'reference' = $2)`,
      [admin.id, demande.reference],
    );
    expect(new Set(miennes.map((l) => l.evenement))).toEqual(
      new Set([
        "compte_cree",
        "compte_modifie",
        "compte_desactive",
        "compte_reactive",
        "lien_mot_de_passe_genere",
        "invitation_renvoyee",
        "invitation_annulee",
        "echec_confirmation",
      ]),
    );

    // Toute la base : chaque ligne a un événement connu, son type de ligne
    // et exactement ses clés.
    const { rows: toutes } = await base.query<{
      id: string;
      type: string;
      details: Record<string, unknown>;
    }>("select id, type, details from public.journal");
    for (const { id, type, details } of toutes) {
      const evenement = details.evenement;
      expect(
        typeof evenement === "string" && Object.hasOwn(CLES_DETAILS_JOURNAL, evenement),
        `ligne ${id} : événement inconnu « ${String(evenement)} » — ajoutez-le dans lib/journal.ts ` +
          "(CLES_DETAILS_JOURNAL, TYPE_EVENEMENT_JOURNAL et PHRASES_JOURNAL)",
      ).toBe(true);
      expect(type, `ligne ${id} : ${String(evenement)} écrit avec le type « ${type} »`).toBe(
        TYPE_EVENEMENT_JOURNAL[evenement as string],
      );
      expect(Object.keys(details).sort(), `ligne ${id} : clés de ${String(evenement)}`).toEqual(
        [...CLES_DETAILS_JOURNAL[evenement as string]].sort(),
      );
    }

    // Aucune ligne ne cite le demandeur de test (insensible à la casse).
    const nomComplet = `${PREFIXE} ${demandeur.nom}`;
    for (const valeur of [nomComplet, demandeur.nom, demandeur.email, demandeur.telephone, demandeur.societe]) {
      const { rows } = await base.query(
        "select id from public.journal where strpos(lower(details::text), lower($1)) > 0",
        [valeur],
      );
      expect(rows, valeur).toEqual([]);
    }
  }, 60_000);
});
