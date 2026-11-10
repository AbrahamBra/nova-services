import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { CLES_DETAILS_JOURNAL, TYPE_EVENEMENT_JOURNAL } from "@/lib/journal";
import {
  clientPubliableTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest } from "@/tests/outils/demandes";

// Story 5.2 — fonctions SQL des catégories sur le projet de développement
// (migration 20261103000031) : droits (authenticated seulement, SECURITY
// DEFINER, search_path vide), administrateur actif seulement, nom unique sans
// majuscules, accents, tirets ni apostrophes (toutes catégories, actives ou
// non, y compris une course sur l'index unique), dernière catégorie active
// (transaction ANNULÉE : les 5 vraies catégories ne sont jamais
// désactivées), désactivation sans toucher aux demandes, `changer_categorie`
// refusant une catégorie désactivée, infos publiques, journal.
// Base partagée : catégories, demandes et comptes `TEST-5.2-…` jetables,
// supprimés à la fin avec leurs lignes de journal.

const CODE = randomUUID().slice(0, 8);
const PREFIXE = `TEST-5.2-${CODE}`;

const comptes: CompteTest[] = [];
/** Catégories de test à supprimer à la fin. */
const categories: string[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let base: Client;

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.2", ...options });
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
  // Demandes d'abord (elles citent les catégories), puis les catégories, le
  // journal (écrit par les comptes de test) et les comptes.
  try {
    if (base) {
      await supprimerDemandesTest(base, PREFIXE);
      if (categories.length > 0) {
        await base.query(
          `delete from public.categories
            where (id = any($1::uuid[]) or nom like $2) and nom like 'TEST-5.2-%'`,
          [categories, `${PREFIXE}%`],
        );
      }
    }
  } catch (erreur) {
    console.error(`Nettoyage des catégories impossible : ${String(erreur)}`);
  }
  await base?.end().catch(() => {});
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
}, 60_000);

// Après un échec ou un délai dépassé, la connexion partagée ne garde jamais
// une transaction ouverte (25P02) ni un verrou pour le test suivant.
afterEach(async () => {
  await base?.query("rollback").catch(() => {});
});

/** Délai des tests qui créent des demandes ou ouvrent plusieurs connexions (CI chargée). */
const LONG = 30_000;

/** Connexion propre à un test, fermée par `fermer` dans un `finally`. */
async function connexion(): Promise<Client> {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  return c;
}

/**
 * Ferme une connexion de test : la base annule sa transaction en cours et
 * libère ses verrous, même si une requête y attend encore.
 */
async function fermer(c: Client | null): Promise<void> {
  await c?.end().catch(() => {});
}

async function pidDe(c: Client): Promise<number> {
  const { rows } = await c.query<{ pid: number }>("select pg_backend_pid() as pid");
  return rows[0].pid;
}

/** Vrai dès que la session `pid` attend un verrou (du type donné), au plus 15 s. */
async function attendVerrou(pid: number, typeVerrou: string | null = null): Promise<boolean> {
  const limite = Date.now() + 15_000;
  while (Date.now() < limite) {
    const { rowCount } = await base.query(
      "select 1 from pg_locks where pid = $1 and not granted and ($2::text is null or locktype = $2)",
      [pid, typeVerrou],
    );
    if (rowCount) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

type ErreurPg = { message: string; detail?: string };

/** Erreur d'un appel : son code prévu et son détail, ou null s'il réussit. */
async function erreurDe(promesse: Promise<unknown>): Promise<ErreurPg | null> {
  try {
    await promesse;
    return null;
  } catch (erreur) {
    const e = erreur as { message?: string; detail?: string };
    return { message: e.message ?? String(erreur), detail: e.detail };
  }
}

async function codeDe(promesse: Promise<unknown>): Promise<string | null> {
  return (await erreurDe(promesse))?.message ?? null;
}

/** Passe la transaction en cours sous la session simulée de `c`. */
async function sessionDe(c: CompteTest, connexion = base) {
  await connexion.query("set local role authenticated");
  await connexion.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: c.id, role: "authenticated" }),
  ]);
}

/** Appelle une fonction avec la session simulée de `c`, dans sa propre transaction (validée). */
async function enTantQue<T = unknown>(
  c: CompteTest,
  sql: string,
  parametres: unknown[] = [],
  connexion = base,
): Promise<T> {
  await connexion.query("begin");
  try {
    await sessionDe(c, connexion);
    const { rows } = await connexion.query<{ r: T }>(`select ${sql} as r`, parametres);
    await connexion.query("commit");
    return rows[0].r;
  } catch (erreur) {
    await connexion.query("rollback").catch(() => {});
    throw erreur;
  }
}

type Ajoutee = { id: string; nom: string; actif: boolean; ordre: number };

/** Ajoute une catégorie de test par la vraie fonction ; elle sera supprimée à la fin. */
async function ajouter(suffixe: string): Promise<Ajoutee> {
  const ajoutee = await enTantQue<Ajoutee>(admin, "public.ajouter_categorie($1)", [
    `${PREFIXE} ${suffixe}`,
  ]);
  categories.push(ajoutee.id);
  return ajoutee;
}

async function categorie(id: string) {
  const { rows } = await base.query<{ nom: string; actif: boolean; ordre: number }>(
    "select nom, actif, ordre from public.categories where id = $1",
    [id],
  );
  return rows[0];
}

async function journal(id: string) {
  const { rows } = await base.query<{
    type: string;
    auteur_id: string;
    details: Record<string, unknown>;
  }>(
    `select type, auteur_id, details from public.journal
      where details ->> 'categorie_id' = $1
      order by id`,
    [id],
  );
  return rows;
}

async function nomsPublics(): Promise<string[]> {
  const { rows } = await base.query<{ r: { categories: { nom: string }[] } }>(
    "select public.infos_publiques() as r",
  );
  return rows[0].r.categories.map((c) => c.nom);
}

const FONCTIONS = [
  "public.lister_categories_admin()",
  "public.ajouter_categorie(text)",
  "public.renommer_categorie(uuid, text)",
  "public.desactiver_categorie(uuid)",
  "public.activer_categorie(uuid)",
];

describe("droits", () => {
  it("EXECUTE à authenticated seulement ; SECURITY DEFINER, search_path vide ; index unique normalisé", async () => {
    const { rows } = await base.query<{ f: string; r: string; peut: boolean }>(
      `select f, r, has_function_privilege(r, f, 'EXECUTE') as peut
         from unnest($1::text[]) as f, unnest(array['anon', 'authenticated', 'service_role']) as r`,
      [FONCTIONS],
    );
    expect(rows).toHaveLength(FONCTIONS.length * 3);
    for (const l of rows) expect(l.peut, `${l.f} ${l.r}`).toBe(l.r === "authenticated");

    const { rows: definitions } = await base.query<{
      nom: string;
      definer: boolean;
      config: string[] | null;
    }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('lister_categories_admin', 'ajouter_categorie', 'renommer_categorie',
                            'desactiver_categorie', 'activer_categorie')`,
    );
    expect(definitions).toHaveLength(FONCTIONS.length);
    for (const d of definitions) {
      expect(d.definer, d.nom).toBe(true);
      expect(d.config, d.nom).toContain('search_path=""');
    }

    const { rows: index } = await base.query<{ def: string }>(
      "select indexdef as def from pg_indexes where schemaname = 'public' and tablename = 'categories'",
    );
    expect(index.map((i) => i.def)).toContainEqual(
      expect.stringMatching(/UNIQUE INDEX categories_nom_normalise_key .*prive\.normaliser\(nom\)/),
    );
  });

  it("visiteur (clé publiable) : refusé", async () => {
    const { data, error } = await clientPubliableTest().rpc("ajouter_categorie", {
      p_nom: `${PREFIXE} Visiteur`,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("collaborateur : DROIT_INSUFFISANT partout, rien ne change", async () => {
    const cible = await ajouter("Cible collaborateur");
    const nom = `${PREFIXE} Collaborateur`;
    for (const [sql, parametres] of [
      ["public.lister_categories_admin()", []],
      ["public.ajouter_categorie($1)", [nom]],
      ["public.renommer_categorie($1, $2)", [cible.id, nom]],
      ["public.desactiver_categorie($1)", [cible.id]],
      ["public.activer_categorie($1)", [cible.id]],
    ] as const) {
      expect(await codeDe(enTantQue(collaborateur, sql, [...parametres])), sql).toBe(
        "DROIT_INSUFFISANT",
      );
    }
    expect(await categorie(cible.id)).toMatchObject({ nom: cible.nom, actif: true });
    const { rowCount } = await base.query("select 1 from public.categories where nom = $1", [nom]);
    expect(rowCount).toBe(0);
  });

  it("administrateur désactivé : DROIT_INSUFFISANT", async () => {
    const ancien = await compte({ role: "administrateur", prenom: "Paul", etat: "desactive" });
    expect(await codeDe(enTantQue(ancien, "public.lister_categories_admin()"))).toBe("DROIT_INSUFFISANT");
    expect(await codeDe(enTantQue(ancien, "public.ajouter_categorie($1)", [`${PREFIXE} Ancien`]))).toBe(
      "DROIT_INSUFFISANT",
    );
  });
});

describe("ajouter", () => {
  it("active, en dernière position, nom sans espaces aux extrémités ; formulaire public ; journal", async () => {
    const { rows } = await base.query<{ max: number }>("select max(ordre) as max from public.categories");
    const ajoutee = await enTantQue<Ajoutee>(admin, "public.ajouter_categorie($1)", [
      `  ${PREFIXE} Formation \t`,
    ]);
    categories.push(ajoutee.id);
    expect(ajoutee).toMatchObject({ nom: `${PREFIXE} Formation`, actif: true });
    expect(ajoutee.ordre).toBeGreaterThan(rows[0].max);
    expect(await categorie(ajoutee.id)).toEqual({
      nom: `${PREFIXE} Formation`,
      actif: true,
      ordre: ajoutee.ordre,
    });

    // Aussitôt proposée par le formulaire public.
    expect(await nomsPublics()).toContain(`${PREFIXE} Formation`);

    expect(await journal(ajoutee.id)).toEqual([
      {
        type: "categorie",
        auteur_id: admin.id,
        details: {
          evenement: "categorie_ajoutee",
          categorie_id: ajoutee.id,
          nom: `${PREFIXE} Formation`,
        },
      },
    ]);
  });

  it("nom vide, blanc ou de plus de 80 caractères : DONNEES_INVALIDES", async () => {
    for (const nom of [null, "", "   ", "x".repeat(81)]) {
      expect(await codeDe(enTantQue(admin, "public.ajouter_categorie($1)", [nom])), String(nom)).toBe(
        "DONNEES_INVALIDES",
      );
    }
  });
});

describe("nom unique (prive.normaliser)", () => {
  it("majuscules, accents, tirets, apostrophes : NOM_CATEGORIE_PRIS, catégorie existante active", async () => {
    await ajouter("Formation initiale");
    const variantes = [
      `${PREFIXE} formation initiale`,
      `${PREFIXE} Formatión Initiale`,
      `${PREFIXE.toLowerCase()} FORMATION INITIALE`,
      `${PREFIXE.replace("TEST-", "TEST ")} Formation-initiale`,
      `${PREFIXE} Formation initiale`.replace("TEST-", "TEST'"),
    ];
    for (const nom of variantes) {
      const erreur = await erreurDe(enTantQue(admin, "public.ajouter_categorie($1)", [nom]));
      expect(erreur?.message, nom).toBe("NOM_CATEGORIE_PRIS");
      expect(JSON.parse(erreur?.detail ?? "null"), nom).toEqual({ desactivee: false });
    }
  });

  it("catégorie existante désactivée : NOM_CATEGORIE_PRIS avec desactivee = true", async () => {
    const existante = await ajouter("Atelier");
    await enTantQue(admin, "public.desactiver_categorie($1)", [existante.id]);
    const erreur = await erreurDe(
      enTantQue(admin, "public.ajouter_categorie($1)", [`${PREFIXE} atelier`]),
    );
    expect(erreur?.message).toBe("NOM_CATEGORIE_PRIS");
    expect(JSON.parse(erreur?.detail ?? "null")).toEqual({ desactivee: true });

    // Même refus pour un renommage.
    const autre = await ajouter("Autre atelier");
    const renommage = await erreurDe(
      enTantQue(admin, "public.renommer_categorie($1, $2)", [autre.id, `${PREFIXE} Atélier`]),
    );
    expect(renommage?.message).toBe("NOM_CATEGORIE_PRIS");
    expect(JSON.parse(renommage?.detail ?? "null")).toEqual({ desactivee: true });

    // Réactivation : aucun doublon ne peut exister, elle passe.
    await enTantQue(admin, "public.activer_categorie($1)", [existante.id]);
    expect((await categorie(existante.id)).actif).toBe(true);
  });

  it("vraie catégorie : son nom en minuscules est refusé", async () => {
    const { rows } = await base.query<{ nom: string }>(
      "select nom from public.categories where nom = 'Autre'",
    );
    if (rows.length === 0) return; // catégorie renommée sur cette base : rien à prouver ici
    expect(await codeDe(enTantQue(admin, "public.ajouter_categorie('autre')"))).toBe(
      "NOM_CATEGORIE_PRIS",
    );
  });

  it("course : le même nom ajouté en même temps par deux sessions, une seule réussit", async () => {
    let a: Client | null = null;
    let b: Client | null = null;
    try {
      a = await connexion();
      b = await connexion();
      const pidB = await pidDe(b);
      // Première session : ajout non encore validé.
      await a.query("begin");
      await sessionDe(admin, a);
      const { rows } = await a.query<{ r: Ajoutee }>("select public.ajouter_categorie($1) as r", [
        `${PREFIXE} Course`,
      ]);
      categories.push(rows[0].r.id);
      // Seconde session : attend la fin de la première sur l'index unique.
      const seconde = erreurDe(enTantQue(admin, "public.ajouter_categorie($1)", [`${PREFIXE} course`], b));
      expect(await attendVerrou(pidB)).toBe(true);
      await a.query("commit");
      const erreur = await seconde;
      expect(erreur?.message).toBe("NOM_CATEGORIE_PRIS");
      expect(JSON.parse(erreur?.detail ?? "null")).toEqual({ desactivee: false });
    } finally {
      await fermer(b);
      await fermer(a);
    }
  }, LONG);
});

describe("renommer", () => {
  it("course : deux renommages vers le même nom en même temps, le second reçoit NOM_CATEGORIE_PRIS", async () => {
    const premiere = await ajouter("Course renommage A");
    const seconde = await ajouter("Course renommage B");
    let a: Client | null = null;
    let b: Client | null = null;
    try {
      a = await connexion();
      b = await connexion();
      const pidB = await pidDe(b);
      // Première session : renommage non encore validé.
      await a.query("begin");
      await sessionDe(admin, a);
      await a.query("select public.renommer_categorie($1, $2)", [premiere.id, `${PREFIXE} Course cible`]);
      // Seconde session : ne voit pas encore le nouveau nom, puis attend sur
      // l'index unique ; le gestionnaire unique_violation répond.
      const perdant = erreurDe(
        enTantQue(admin, "public.renommer_categorie($1, $2)", [seconde.id, `${PREFIXE} course CIBLE`], b),
      );
      expect(await attendVerrou(pidB)).toBe(true);
      await a.query("commit");
      const erreur = await perdant;
      expect(erreur?.message).toBe("NOM_CATEGORIE_PRIS");
      expect(JSON.parse(erreur?.detail ?? "null")).toEqual({ desactivee: false });
      expect((await categorie(seconde.id)).nom).toBe(`${PREFIXE} Course renommage B`);
    } finally {
      await fermer(b);
      await fermer(a);
    }
  }, LONG);

  it("nouveau nom lu partout, y compris sur une ancienne demande ; journal avec l'ancien nom", async () => {
    const cible = await ajouter("Conseil");
    const demande = await creerDemandeTest(base, PREFIXE, { categorieId: cible.id });

    const r = await enTantQue<{ modifie: boolean }>(admin, "public.renommer_categorie($1, $2)", [
      cible.id,
      ` ${PREFIXE} Conseils `,
    ]);
    expect(r.modifie).toBe(true);
    expect((await categorie(cible.id)).nom).toBe(`${PREFIXE} Conseils`);

    const { rows } = await base.query<{ categorie_nom: string }>(
      "select categorie_nom from public.demandes_liste where id = $1",
      [demande.id],
    );
    expect(rows[0].categorie_nom).toBe(`${PREFIXE} Conseils`);
    expect(await nomsPublics()).toContain(`${PREFIXE} Conseils`);

    expect((await journal(cible.id)).map((l) => l.details)).toContainEqual({
      evenement: "categorie_renommee",
      categorie_id: cible.id,
      nom: `${PREFIXE} Conseils`,
      ancien_nom: `${PREFIXE} Conseil`,
    });
  }, LONG);

  it("seulement les majuscules de son propre nom : permis ; nom identique : rien n'est écrit", async () => {
    const cible = await ajouter("Logistique");
    await enTantQue(admin, "public.renommer_categorie($1, $2)", [cible.id, `${PREFIXE} LOGISTIQUE`]);
    expect((await categorie(cible.id)).nom).toBe(`${PREFIXE} LOGISTIQUE`);

    const avant = (await journal(cible.id)).length;
    const r = await enTantQue<{ modifie: boolean }>(admin, "public.renommer_categorie($1, $2)", [
      cible.id,
      `${PREFIXE} LOGISTIQUE`,
    ]);
    expect(r.modifie).toBe(false);
    expect(await journal(cible.id)).toHaveLength(avant);
  });

  it("vers le nom d'une autre catégorie : NOM_CATEGORIE_PRIS ; id inconnu : DONNEES_INVALIDES", async () => {
    const premiere = await ajouter("Transport");
    const seconde = await ajouter("Stockage");
    expect(
      await codeDe(
        enTantQue(admin, "public.renommer_categorie($1, $2)", [seconde.id, `${PREFIXE} transport`]),
      ),
    ).toBe("NOM_CATEGORIE_PRIS");
    expect((await categorie(premiere.id)).nom).toBe(`${PREFIXE} Transport`);
    expect((await categorie(seconde.id)).nom).toBe(`${PREFIXE} Stockage`);
    expect(
      await codeDe(
        enTantQue(admin, "public.renommer_categorie($1, $2)", [randomUUID(), `${PREFIXE} Inconnue`]),
      ),
    ).toBe("DONNEES_INVALIDES");
  });
});

describe("désactiver et réactiver", () => {
  it("les 3 demandes la gardent ; plus proposée ; changer_categorie refusé ; puis réactivée", async () => {
    const cible = await ajouter("Formation continue");
    const demandes = [];
    for (let i = 0; i < 3; i++) {
      demandes.push(await creerDemandeTest(base, PREFIXE, { categorieId: cible.id }));
    }
    const autre = await creerDemandeTest(base, PREFIXE);

    const liste = await enTantQue<{ id: string; demandes: number; actif: boolean }[]>(
      admin,
      "public.lister_categories_admin()",
    );
    expect(liste.find((c) => c.id === cible.id)).toMatchObject({ demandes: 3, actif: true });

    const { rows: avant } = await base.query<{ mis_a_jour_le: string }>(
      "select mis_a_jour_le from public.demandes where id = any($1::uuid[]) order by id",
      [demandes.map((d) => d.id)],
    );

    await enTantQue(admin, "public.desactiver_categorie($1)", [cible.id]);
    expect((await categorie(cible.id)).actif).toBe(false);

    // Les demandes gardent la catégorie, sans être modifiées.
    const { rows: apres } = await base.query<{ categorie_id: string; mis_a_jour_le: string }>(
      "select categorie_id, mis_a_jour_le from public.demandes where id = any($1::uuid[]) order by id",
      [demandes.map((d) => d.id)],
    );
    expect(apres.map((l) => l.categorie_id)).toEqual([cible.id, cible.id, cible.id]);
    expect(apres.map((l) => String(l.mis_a_jour_le))).toEqual(avant.map((l) => String(l.mis_a_jour_le)));

    // Plus proposée par le formulaire public ; changer_categorie la refuse.
    expect(await nomsPublics()).not.toContain(cible.nom);
    expect(
      await codeDe(enTantQue(admin, "public.changer_categorie($1, $2)", [autre.id, cible.id])),
    ).toBe("CATEGORIE_INVALIDE");

    // Toujours dans la liste de l'administrateur, avec ses 3 demandes.
    const listeApres = await enTantQue<{ id: string; demandes: number; actif: boolean }[]>(
      admin,
      "public.lister_categories_admin()",
    );
    expect(listeApres.find((c) => c.id === cible.id)).toMatchObject({ demandes: 3, actif: false });

    // Déjà désactivée.
    expect(await codeDe(enTantQue(admin, "public.desactiver_categorie($1)", [cible.id]))).toBe(
      "ETAT_CATEGORIE_INVALIDE",
    );

    // Réactivée : de nouveau proposée ; déjà active ensuite.
    await enTantQue(admin, "public.activer_categorie($1)", [cible.id]);
    expect(await nomsPublics()).toContain(cible.nom);
    expect(await codeDe(enTantQue(admin, "public.activer_categorie($1)", [cible.id]))).toBe(
      "ETAT_CATEGORIE_INVALIDE",
    );

    expect((await journal(cible.id)).map((l) => [l.type, l.auteur_id, l.details])).toEqual([
      ["categorie", admin.id, { evenement: "categorie_ajoutee", categorie_id: cible.id, nom: cible.nom }],
      ["categorie", admin.id, { evenement: "categorie_desactivee", categorie_id: cible.id, nom: cible.nom }],
      ["categorie", admin.id, { evenement: "categorie_reactivee", categorie_id: cible.id, nom: cible.nom }],
    ]);
  }, LONG);

  // Prouver DERNIERE_CATEGORIE en base demanderait de désactiver (même dans
  // une transaction annulée) les vraies catégories : verrous sur des lignes
  // partagées avec les autres fichiers de test, lancés en parallèle. La règle
  // est donc prouvée par l'action simulée (action.test.ts) et ici par le
  // corps de la fonction : verrou, puis contrôle, puis seulement la mise à jour.
  it("dernière catégorie active : contrôle DERNIERE_CATEGORIE sous verrou, avant la mise à jour", async () => {
    const { rows } = await base.query<{ def: string }>(
      "select pg_get_functiondef('public.desactiver_categorie(uuid)'::regprocedure) as def",
    );
    const def = rows[0].def.replace(/\s+/g, " ");
    const verrou = def.indexOf("pg_advisory_xact_lock(hashtextextended('categories:actives', 0))");
    const controle = def.indexOf(
      "if not exists ( select 1 from public.categories c where c.id <> p_id and c.actif ) then raise exception using errcode = 'P0001', message = 'DERNIERE_CATEGORIE';",
    );
    const miseAJour = def.indexOf("set actif = false");
    expect(verrou).toBeGreaterThan(0);
    expect(controle).toBeGreaterThan(verrou);
    expect(miseAJour).toBeGreaterThan(controle);
  });

  it("verrou consultatif : une seconde désactivation attend la première (transactions annulées)", async () => {
    const x = await ajouter("Verrou X");
    const y = await ajouter("Verrou Y");
    let a: Client | null = null;
    let b: Client | null = null;
    try {
      a = await connexion();
      b = await connexion();
      const pidB = await pidDe(b);
      // A : désactivation de X, laissée ouverte (verrou tenu).
      await a.query("begin");
      await sessionDe(admin, a);
      await a.query("select public.desactiver_categorie($1)", [x.id]);
      // B : désactivation de Y, qui doit attendre le verrou consultatif.
      await b.query("begin");
      await sessionDe(admin, b);
      void b.query("select public.desactiver_categorie($1)", [y.id]).catch(() => {});
      expect(await attendVerrou(pidB, "advisory")).toBe(true);
    } finally {
      // B d'abord (sa désactivation n'est jamais faite), puis A : les deux
      // transactions sont annulées par la fermeture.
      await fermer(b);
      await fermer(a);
    }
    // Rien n'a changé.
    expect((await categorie(x.id)).actif).toBe(true);
    expect((await categorie(y.id)).actif).toBe(true);
  }, LONG);

  it("id inconnu ou absent : DONNEES_INVALIDES", async () => {
    for (const sql of ["public.desactiver_categorie($1)", "public.activer_categorie($1)"]) {
      expect(await codeDe(enTantQue(admin, sql, [randomUUID()])), sql).toBe("DONNEES_INVALIDES");
      expect(await codeDe(enTantQue(admin, sql, [null])), sql).toBe("DONNEES_INVALIDES");
    }
  });
});

describe("liste et journal", () => {
  it("lister_categories_admin : ordre puis nom, toutes catégories, nombre de demandes", async () => {
    const liste = await enTantQue<
      { id: string; nom: string; actif: boolean; ordre: number; demandes: number }[]
    >(admin, "public.lister_categories_admin()");
    // Base partagée : d'autres tests ajoutent un instant des catégories
    // « TEST-… » ; seules les vraies catégories (actives ou non) sont comparées.
    const { rows } = await base.query<{ id: string }>(
      "select id from public.categories where nom not like 'TEST-%' order by ordre, nom, id",
    );
    expect(liste.filter((c) => !c.nom.startsWith("TEST-")).map((c) => c.id)).toEqual(
      rows.map((r) => r.id),
    );
    for (let i = 1; i < liste.length; i++) {
      expect(liste[i - 1].ordre).toBeLessThanOrEqual(liste[i].ordre);
    }
    for (const c of liste) {
      expect(Object.keys(c).sort()).toEqual(["actif", "demandes", "id", "nom", "ordre"]);
      expect(Number.isInteger(c.demandes) && c.demandes >= 0).toBe(true);
    }
  });

  it("chaque ligne de catégorie a le type « categorie » et exactement ses clés (AD-14)", async () => {
    const { rows } = await base.query<{ type: string; details: Record<string, unknown> }>(
      "select type, details from public.journal where auteur_id = $1",
      [admin.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { type, details } of rows) {
      const evenement = String(details.evenement);
      expect(TYPE_EVENEMENT_JOURNAL[evenement], evenement).toBe("categorie");
      expect(type).toBe("categorie");
      expect(Object.keys(details).sort(), evenement).toEqual([...CLES_DETAILS_JOURNAL[evenement]].sort());
    }
  });
});
