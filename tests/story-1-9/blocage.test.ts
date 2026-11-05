import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, type DatabaseError } from "pg";
import { empreinteDeTest } from "../outils/ip-test";

// Story 1.9 — blocage de la connexion (migration 20261103000012).
//
// 1. Base : `commencer_connexion` et `terminer_connexion` appelées
//    directement, dans des transactions annulées (rien ne reste, pas même les
//    lignes de journal) : tous les cas de la matrice, journal unique, droits.
// 2. Action `connexion` de bout en bout sur la vraie base (clé secrète, comme
//    l'application), avec une IP de test propre à chaque test. Supabase Auth
//    est simulé : de vraies connexions en série dépassent la limite d'appels
//    d'Auth (429) et font échouer les autres tests ; les vraies connexions
//    sont couvertes par session.test.ts et connexion.spec.ts. Les comptes
//    simulés portent des noms `TEST-…`. Les tentatives et les lignes de
//    journal créées sont effacées à la fin.

type CompteSimule = { nom: string; email: string; motDePasse: string; etat: "actif" | "desactive" };

const simulation = vi.hoisted(() => ({
  ip: "test-initiale",
  appelsAuth: 0,
  /** Panne simulée : Auth répond 500, lève une exception, ou mon_profil échoue. */
  panne: null as null | "auth_500" | "auth_exception" | "profil",
  comptes: new Map<string, CompteSimule>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nova-ip-test": simulation.ip }),
  cookies: async () => ({ getAll: () => [], set: () => {}, delete: () => {} }),
}));

vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (adresse: string) => {
    throw Object.assign(new Error("REDIRECTION"), { adresse });
  },
}));

// Client serveur simulé : Auth (mot de passe) et `mon_profil` (membre actif
// ou non). Compte les appels transmis à Auth.
vi.mock("@/lib/supabase/serveur", () => ({
  creerClientServeur: async () => {
    let connecte: CompteSimule | null = null;
    return {
      auth: {
        signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
          simulation.appelsAuth += 1;
          // Réponse d'Auth un peu lente : les essais simultanés se chevauchent.
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (simulation.panne === "auth_500") {
            return { error: { code: "unexpected_failure", status: 500 } };
          }
          if (simulation.panne === "auth_exception") throw new Error("réseau coupé");
          const compte = simulation.comptes.get(email);
          if (compte && compte.motDePasse === password) {
            connecte = compte;
            return { error: null };
          }
          return { error: { code: "invalid_credentials", status: 400 } };
        },
        signOut: async () => {
          connecte = null;
          return { error: null };
        },
      },
      rpc: async (fonction: string) =>
        simulation.panne === "profil"
          ? { data: null, error: { code: "08006", message: "connexion perdue" } }
          : fonction === "mon_profil"
          ? {
              data:
                connecte?.etat === "actif"
                  ? { nom: connecte.nom, role: "collaborateur", etat: "actif" }
                  : null,
              error: null,
            }
          : { data: null, error: { code: "42883", message: "inconnue" } },
    };
  },
}));

import { connexion } from "@/lib/actions/comptes";
import { messageErreur } from "@/lib/erreurs";
import { empreinteEmail, empreinteIp } from "@/lib/server/empreintes";
import { ETAT_CONNEXION_INITIAL, type EtatConnexion } from "@/lib/schemas/connexion";

const BLOQUEE = "CONNEXION_BLOQUEE";

function variable(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} manquant dans .env.local.`);
  return valeur;
}

let base: Client;

beforeAll(async () => {
  base = new Client({ connectionString: variable("SUPABASE_DB_URL") });
  await base.connect();
});

afterAll(async () => {
  await base?.end();
});

async function erreurDe(promesse: Promise<unknown>): Promise<DatabaseError> {
  try {
    await promesse;
  } catch (erreur) {
    return erreur as DatabaseError;
  }
  throw new Error("Une erreur était attendue.");
}

async function dansTransactionAnnulee<T>(travail: () => Promise<T>): Promise<T> {
  await base.query("begin");
  try {
    return await travail();
  } finally {
    await base.query("rollback").catch(() => {});
  }
}

// --- 1. Base ---------------------------------------------------------------

/** `commencer_connexion` isolée par un point de sauvegarde : un refus n'annule pas la transaction. */
async function commencer(email: string, ip: string): Promise<string> {
  await base.query("savepoint tentative");
  try {
    const { rows } = await base.query<{ id: string }>(
      "select public.commencer_connexion($1, $2) as id",
      [email, ip],
    );
    await base.query("release savepoint tentative");
    return rows[0].id;
  } catch (erreur) {
    await base.query("rollback to savepoint tentative");
    throw erreur;
  }
}

async function terminer(id: string, reussie: boolean | null): Promise<{ bloquee: boolean }> {
  const { rows } = await base.query<{ r: { bloquee: boolean } }>(
    "select public.terminer_connexion($1, $2) as r",
    [id, reussie],
  );
  return rows[0].r;
}

/** Une tentative complète ; renvoie `bloquee`. */
async function essai(email: string, ip: string, reussie = false): Promise<boolean> {
  return (await terminer(await commencer(email, ip), reussie)).bloquee;
}

/** Lignes `connexion` écrites dans la transaction en cours (même `now()`). */
async function journalDeLaTransaction(): Promise<{ details: Record<string, unknown>; auteur_type: string; auteur_id: string | null }[]> {
  const { rows } = await base.query(
    `select details, auteur_type, auteur_id from public.journal
      where type = 'connexion' and cree_le = now() order by id`,
  );
  return rows;
}

/** Échecs (ou réussites) déjà anciens, insérés directement. */
async function inserer(email: string, ip: string, nombre: number, age: string, reussie = false) {
  await base.query(
    `insert into public.tentatives_connexion (empreinte_email, empreinte_ip, reussie, cree_le)
     select $1, $2, $3, now() - $4::interval from generate_series(1, $5)`,
    [email, ip, reussie, age, nombre],
  );
}

describe("base — blocage après 5 échecs de suite en 15 minutes", () => {
  it("4 échecs : pas de blocage ; 5ᵉ échec : bloqué, une ligne de journal système sans donnée", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      for (let i = 0; i < 4; i += 1) expect(await essai(email, ip)).toBe(false);
      expect(await journalDeLaTransaction()).toEqual([]);

      expect(await essai(email, ip)).toBe(true);
      const journal = await journalDeLaTransaction();
      expect(journal).toEqual([
        {
          details: { evenement: "connexion_bloquee", bloque: "email_et_ip", duree_minutes: 15 },
          auteur_type: "systeme",
          auteur_id: null,
        },
      ]);
      expect(JSON.stringify(journal)).not.toContain(email);
      expect(JSON.stringify(journal)).not.toContain(ip);
    });
  });

  it("pendant le blocage : même le bon mot de passe est refusé avant Auth, sans nouvelle ligne de journal", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      for (let i = 0; i < 5; i += 1) await essai(email, ip);
      const { rows: avant } = await base.query(
        "select count(*)::int as n from public.tentatives_connexion where empreinte_email = $1",
        [email],
      );

      for (let i = 0; i < 3; i += 1) {
        const erreur = await erreurDe(commencer(email, ip));
        expect(erreur.code).toBe("P0001");
        expect(erreur.message).toBe(BLOQUEE);
      }
      // Refus : aucune tentative enregistrée, aucune ligne de journal de plus.
      const { rows: apres } = await base.query(
        "select count(*)::int as n from public.tentatives_connexion where empreinte_email = $1",
        [email],
      );
      expect(apres[0].n).toBe(avant[0].n);
      expect(await journalDeLaTransaction()).toHaveLength(1);
    });
  });

  it("3 échecs, une réussite, puis 3 échecs : pas de blocage", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      await inserer(email, ip, 3, "3 minutes");
      await inserer(email, ip, 1, "2 minutes", true);
      for (let i = 0; i < 3; i += 1) expect(await essai(email, ip)).toBe(false);
      // Encore une tentative possible : seuls 3 échecs comptent depuis la réussite.
      expect(await commencer(email, ip)).toMatch(/^\d+$/);
      expect(await journalDeLaTransaction()).toEqual([]);
    });
  });

  it("email bloqué : refusé aussi depuis une autre IP", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      for (let i = 0; i < 5; i += 1) await essai(email, empreinteDeTest());
      const journal = await journalDeLaTransaction();
      expect(journal).toHaveLength(1);
      expect(journal[0].details.bloque).toBe("email");

      const erreur = await erreurDe(commencer(email, empreinteDeTest()));
      expect(erreur.message).toBe(BLOQUEE);
    });
  });

  it("5 échecs sur des emails différents depuis une IP : l'IP est bloquée", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinteDeTest();
      for (let i = 0; i < 4; i += 1) expect(await essai(empreinteDeTest(), ip)).toBe(false);
      expect(await essai(empreinteDeTest(), ip)).toBe(true);
      const journal = await journalDeLaTransaction();
      expect(journal).toHaveLength(1);
      expect(journal[0].details.bloque).toBe("ip");

      const erreur = await erreurDe(commencer(empreinteDeTest(), ip));
      expect(erreur.message).toBe(BLOQUEE);
    });
  });

  it("échecs de plus de 15 minutes : connexion à nouveau possible", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      await inserer(email, ip, 5, "15 minutes 1 second");
      expect(await commencer(email, ip)).toMatch(/^\d+$/);
    });
  });

  it("échecs de moins de 15 minutes : toujours bloqué", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      await inserer(email, ip, 5, "14 minutes");
      const erreur = await erreurDe(commencer(email, ip));
      expect(erreur.message).toBe(BLOQUEE);
    });
  });

  it("une tentative en cours (sans réponse d'Auth) compte comme un échec", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      for (let i = 0; i < 5; i += 1) await commencer(email, ip);
      const erreur = await erreurDe(commencer(email, ip));
      expect(erreur.message).toBe(BLOQUEE);
    });
  });

  it("une réussite après des échecs n'est pas un blocage et n'écrit rien au journal", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      await inserer(email, ip, 4, "1 minute");
      expect(await essai(email, ip, true)).toBe(false);
      expect(await journalDeLaTransaction()).toEqual([]);
    });
  });

  it("seul le premier résultat compte ; données invalides refusées", async () => {
    await dansTransactionAnnulee(async () => {
      const id = await commencer(empreinteDeTest(), empreinteDeTest());
      await terminer(id, false);
      await base.query("savepoint second");
      const second = await erreurDe(terminer(id, true));
      await base.query("rollback to savepoint second");
      expect(second.message).toBe("DONNEES_INVALIDES");

      for (const [email, ip] of [
        ["karim.benali@example.com", empreinteDeTest()],
        [empreinteDeTest(), "203.0.113.42"],
        [null, empreinteDeTest()],
      ]) {
        const erreur = await erreurDe(commencer(email as string, ip as string));
        expect(erreur.message).toBe("DONNEES_INVALIDES");
      }
      await base.query("savepoint inconnue");
      const inconnue = await erreurDe(terminer("999999999999", false));
      await base.query("rollback to savepoint inconnue");
      expect(inconnue.message).toBe("DONNEES_INVALIDES");
    });
  });

  it("IP : une réussite n'efface que les échecs du même email (A, B, C, D échouent, E réussit, F échoue → IP bloquée)", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinteDeTest();
      for (let i = 0; i < 4; i += 1) expect(await essai(empreinteDeTest(), ip)).toBe(false);
      expect(await essai(empreinteDeTest(), ip, true)).toBe(false);
      expect(await essai(empreinteDeTest(), ip)).toBe(true);
      const journal = await journalDeLaTransaction();
      expect(journal).toHaveLength(1);
      expect(journal[0].details.bloque).toBe("ip");
      const erreur = await erreurDe(commencer(empreinteDeTest(), ip));
      expect(erreur.message).toBe(BLOQUEE);
    });
  });

  it("IP : une réussite efface les échecs antérieurs du même email depuis cette IP", async () => {
    await dansTransactionAnnulee(async () => {
      const ip = empreinteDeTest();
      const email = empreinteDeTest();
      await inserer(email, ip, 4, "3 minutes");
      await inserer(email, ip, 1, "2 minutes", true);
      expect(await essai(empreinteDeTest(), ip)).toBe(false);
    });
  });

  it("le blocage dure 15 minutes à partir de l'échec qui l'a déclenché, même si les échecs sont plus anciens", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      // 4 échecs presque au bout de la fenêtre, puis le 5ᵉ maintenant : blocage.
      await inserer(email, ip, 4, "14 minutes 50 seconds");
      expect(await essai(email, ip)).toBe(true);

      /** Recule toutes les dates des tentatives de cet email. */
      const reculer = (duree: string) =>
        base.query(
          `update public.tentatives_connexion
              set cree_le = cree_le - $2::interval,
                  bloque_email_le = bloque_email_le - $2::interval,
                  bloque_ip_le = bloque_ip_le - $2::interval
            where empreinte_email = $1`,
          [email, duree],
        );

      // 1 minute plus tard : les 4 premiers échecs ont plus de 15 minutes,
      // mais le blocage court toujours.
      await reculer("1 minute");
      expect((await erreurDe(commencer(email, ip))).message).toBe(BLOQUEE);
      // 14 min 59 s après le déclenchement : toujours bloqué.
      await reculer("13 minutes 59 seconds");
      expect((await erreurDe(commencer(email, ip))).message).toBe(BLOQUEE);
      // Plus de 15 minutes après : connexion à nouveau possible.
      await reculer("2 seconds");
      expect(await commencer(email, ip)).toMatch(/^\d+$/);
    });
  });

  it("une ligne de journal par épisode : après la fin d'un blocage, 5 nouveaux échecs bloquent à nouveau", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      for (let i = 0; i < 5; i += 1) await essai(email, ip);
      expect(await journalDeLaTransaction()).toHaveLength(1);

      await base.query(
        `update public.tentatives_connexion
            set cree_le = cree_le - interval '15 minutes 1 second',
                bloque_email_le = bloque_email_le - interval '15 minutes 1 second',
                bloque_ip_le = bloque_ip_le - interval '15 minutes 1 second'
          where empreinte_email = $1`,
        [email],
      );
      for (let i = 0; i < 4; i += 1) expect(await essai(email, ip)).toBe(false);
      expect(await essai(email, ip)).toBe(true);
      expect(await journalDeLaTransaction()).toHaveLength(2);
      expect((await erreurDe(commencer(email, ip))).message).toBe(BLOQUEE);
    });
    // Une vingtaine d'allers-retours avec la base : plus de 5 s depuis la CI.
  }, 20_000);

  it("erreur serveur : terminer_connexion(id, null) supprime la tentative, qui ne compte pas", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      for (let i = 0; i < 6; i += 1) {
        const id = await commencer(email, ip);
        expect(await terminer(id, null)).toEqual({ bloquee: false });
      }
      const { rows } = await base.query(
        "select count(*)::int as n from public.tentatives_connexion where empreinte_email = $1",
        [email],
      );
      expect(rows[0].n).toBe(0);
      expect(await essai(email, ip)).toBe(false);
    });
  });

  it("la table n'accepte que des empreintes", async () => {
    await dansTransactionAnnulee(async () => {
      await base.query("savepoint clair");
      const erreur = await erreurDe(
        base.query(
          "insert into public.tentatives_connexion (empreinte_email, empreinte_ip) values ($1, $2)",
          ["karim.benali@example.com", "203.0.113.42"],
        ),
      );
      await base.query("rollback to savepoint clair");
      expect(erreur.code).toBe("23514");
    });
  });

  it("les tentatives de plus d'un jour sont effacées au passage", async () => {
    await dansTransactionAnnulee(async () => {
      const email = empreinteDeTest();
      const ip = empreinteDeTest();
      await inserer(email, ip, 2, "1 day 1 minute");
      await inserer(email, ip, 1, "23 hours");
      await commencer(empreinteDeTest(), empreinteDeTest());
      const { rows } = await base.query(
        "select count(*)::int as n from public.tentatives_connexion where empreinte_email = $1",
        [email],
      );
      expect(rows[0].n).toBe(1);
    });
  });
});

describe("base — droits", () => {
  it("les deux fonctions sont réservées à service_role", async () => {
    const { rows } = await base.query<{ role: string; fonction: string; peut: boolean }>(
      `select r.role, f.fonction, has_function_privilege(r.role, f.fonction, 'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role', 'public']) as r(role)
        cross join unnest(array['public.commencer_connexion(text, text)',
                                'public.terminer_connexion(bigint, boolean)']) as f(fonction)
        where r.role <> 'public'
        order by 1, 2`,
    );
    for (const ligne of rows) {
      expect(ligne.peut, `${ligne.role} ${ligne.fonction}`).toBe(ligne.role === "service_role");
    }
  });

  it("les utilitaires prive ne sont exécutables par aucun rôle de l'API", async () => {
    const { rows } = await base.query<{ peut: boolean }>(
      `select bool_or(has_function_privilege(r.role, f.fonction, 'EXECUTE')) as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
        cross join unnest(array['prive.verrouiller_tentatives(text, text)',
                                'prive.echecs_de_suite(text, text)',
                                'prive.blocage_actif(text, text)']) as f(fonction)`,
    );
    expect(rows[0].peut).toBe(false);
  });

  it("tentatives_connexion : RLS activée, aucun droit pour personne", async () => {
    const { rows } = await base.query<{ rls: boolean; droits: string[] | null }>(
      `select c.relrowsecurity as rls,
              (select array_agg(r.role || ':' || d.droit)
                 from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
                cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as d(droit)
                where has_table_privilege(r.role, c.oid, d.droit)) as droits
         from pg_class c
        where c.oid = 'public.tentatives_connexion'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, droits: null });
  });
});

describe("base — verrou sur les empreintes", () => {
  it("deux tentatives simultanées pour un email à 4 échecs : la seconde attend la première, puis est refusée", async () => {
    const email = empreinteDeTest();
    const a = new Client({ connectionString: variable("SUPABASE_DB_URL") });
    const b = new Client({ connectionString: variable("SUPABASE_DB_URL") });
    await a.connect();
    await b.connect();
    try {
      // 4 échecs validés, chacun depuis une IP différente.
      await base.query(
        `insert into public.tentatives_connexion (empreinte_email, empreinte_ip, reussie)
         select $1, md5(random()::text) || md5(random()::text), false from generate_series(1, 4)`,
        [email],
      );
      const { rows } = await b.query<{ pid: number }>("select pg_backend_pid() as pid");
      const pidB = rows[0].pid;

      // A : 5ᵉ tentative, transaction encore ouverte (verrou tenu).
      await a.query("begin");
      await a.query("select public.commencer_connexion($1, $2)", [email, empreinteDeTest()]);

      // B : même email, autre IP ; doit attendre le verrou de A.
      const appelB = b
        .query("select public.commencer_connexion($1, $2)", [email, empreinteDeTest()])
        .then(
          () => null,
          (erreur: DatabaseError) => erreur,
        );
      let enAttente = false;
      for (let i = 0; i < 100 && !enAttente; i += 1) {
        const { rowCount } = await base.query(
          "select 1 from pg_locks where pid = $1 and not granted and locktype = 'advisory'",
          [pidB],
        );
        enAttente = (rowCount ?? 0) > 0;
        if (!enAttente) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(enAttente).toBe(true);

      await a.query("commit");
      const erreur = await appelB;
      expect(erreur?.code).toBe("P0001");
      expect(erreur?.message).toBe(BLOQUEE);
    } finally {
      await a.query("rollback").catch(() => {});
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await base.query("delete from public.tentatives_connexion where empreinte_email = $1", [email]);
    }
  }, 30_000);
});

// --- 2. Action `connexion` de bout en bout ---------------------------------

const ipsUtilisees: string[] = [];
const emailsUtilises: string[] = [];
let dernierJournal = 0;

/** Compte simulé `TEST-…`, actif par défaut. */
function compte(etat: CompteSimule["etat"] = "actif"): CompteSimule {
  const code = randomUUID().slice(0, 8);
  const c: CompteSimule = {
    nom: `TEST-1.9-${code} Karim Benali`,
    email: `test-1-9-${code}@example.com`,
    motDePasse: randomUUID(),
    etat,
  };
  simulation.comptes.set(c.email, c);
  emailsUtilises.push(c.email);
  return c;
}

/** IP de test propre à un test (en-tête x-nova-ip-test). */
function nouvelleIp(): string {
  const ip = `test-1-9-${randomUUID()}`;
  ipsUtilisees.push(ip);
  return ip;
}

function formulaire(email: string, motDePasse: string): FormData {
  const donnees = new FormData();
  donnees.set("email", email);
  donnees.set("mot_de_passe", motDePasse);
  donnees.set("retour", "/equipe");
  return donnees;
}

/** Résultat d'une connexion : message du bandeau, ou « REDIRECTION ». */
async function seConnecter(email: string, motDePasse: string): Promise<string> {
  try {
    const etat: EtatConnexion = await connexion(ETAT_CONNEXION_INITIAL, formulaire(email, motDePasse));
    return etat.erreurGenerale?.message ?? "AUCUN MESSAGE";
  } catch (erreur) {
    if (erreur instanceof Error && erreur.message === "REDIRECTION") return "REDIRECTION";
    throw erreur;
  }
}

async function lignesDeJournalDepuis(id: number): Promise<{ details: Record<string, unknown> }[]> {
  const { rows } = await base.query(
    `select details from public.journal
      where id > $1 and type = 'connexion' and details ->> 'evenement' = 'connexion_bloquee'
      order by id`,
    [id],
  );
  return rows;
}

const REFUS = messageErreur("CONNEXION_REFUSEE");
const TROP = messageErreur("CONNEXION_BLOQUEE");

describe("action connexion — vraie base, Auth simulé", () => {
  beforeAll(async () => {
    process.env.IP_DE_TEST_AUTORISEE = "1";
    const { rows } = await base.query<{ id: string | null }>("select max(id) as id from public.journal");
    dernierJournal = Number(rows[0].id ?? 0);
  });

  afterAll(async () => {
    delete process.env.IP_DE_TEST_AUTORISEE;
    if (!base) return;
    const empreintesIp = ipsUtilisees.map((ip) => empreinteIp(ip));
    const empreintesEmail = emailsUtilises.map((email) => empreinteEmail(email));
    await base.query(
      `delete from public.tentatives_connexion
        where empreinte_ip = any($1::text[]) or empreinte_email = any($2::text[])`,
      [empreintesIp, empreintesEmail],
    );
    // Lignes de journal de ces tests : effacées par le drapeau de purge
    // (le journal refuse sinon tout effacement).
    await base.query("begin");
    await base.query("select set_config('nova.purge_journal', 'on', true)");
    await base.query(
      `delete from public.journal
        where id > $1 and type = 'connexion' and details ->> 'evenement' = 'connexion_bloquee'`,
      [dernierJournal],
    );
    await base.query("commit");
  }, 60_000);

  it("4 échecs : « Email ou mot de passe incorrect. » ; 5ᵉ : « Trop de tentatives… » ; puis le bon mot de passe est refusé sans appeler Auth", async () => {
    const c = compte();
    const premiereIp = nouvelleIp();
    simulation.ip = premiereIp;
    const debutJournal = (await lignesDeJournalDepuis(dernierJournal)).length;

    for (let i = 0; i < 4; i += 1) {
      expect(await seConnecter(c.email, "mauvais-mot-de-passe")).toBe(REFUS);
    }
    expect(await seConnecter(c.email, "mauvais-mot-de-passe")).toBe(TROP);
    expect((await lignesDeJournalDepuis(dernierJournal)).length).toBe(debutJournal + 1);

    const appelsAvant = simulation.appelsAuth;
    // Majuscules et espaces : même empreinte (email normalisé).
    expect(await seConnecter(`  ${c.email.toUpperCase()} `, c.motDePasse)).toBe(TROP);
    // Autre IP, même email : refusé aussi.
    simulation.ip = nouvelleIp();
    expect(await seConnecter(c.email, c.motDePasse)).toBe(TROP);
    expect(simulation.appelsAuth).toBe(appelsAvant);
    expect((await lignesDeJournalDepuis(dernierJournal)).length).toBe(debutJournal + 1);

    // Base inspectée : empreintes seulement, ni email ni IP en clair.
    const { rows } = await base.query(
      `select t::text as ligne from public.tentatives_connexion t where t.empreinte_email = $1`,
      [empreinteEmail(c.email)],
    );
    expect(rows).toHaveLength(5);
    for (const { ligne } of rows) {
      expect(ligne).not.toContain(c.email);
      expect(ligne).not.toContain(premiereIp);
      expect(ligne).not.toContain(simulation.ip);
    }
    const journal = JSON.stringify(await lignesDeJournalDepuis(dernierJournal));
    expect(journal).not.toContain(c.email);
    expect(journal).not.toContain(premiereIp);
    expect(journal).not.toContain(empreinteIp(premiereIp));
    expect(journal).not.toContain(empreinteEmail(c.email));
  }, 60_000);

  it("3 échecs, une réussite, puis 3 échecs : pas de blocage", async () => {
    const c = compte();
    simulation.ip = nouvelleIp();
    for (let i = 0; i < 3; i += 1) expect(await seConnecter(c.email, "mauvais")).toBe(REFUS);
    expect(await seConnecter(c.email, c.motDePasse)).toBe("REDIRECTION");
    for (let i = 0; i < 3; i += 1) expect(await seConnecter(c.email, "mauvais")).toBe(REFUS);
    expect(await seConnecter(c.email, c.motDePasse)).toBe("REDIRECTION");
  }, 60_000);

  it("un compte désactivé compte comme un échec, même avec le bon mot de passe", async () => {
    const c = compte("desactive");
    simulation.ip = nouvelleIp();
    for (let i = 0; i < 4; i += 1) expect(await seConnecter(c.email, c.motDePasse)).toBe(REFUS);
    expect(await seConnecter(c.email, c.motDePasse)).toBe(TROP);
  }, 60_000);

  for (const panne of ["auth_500", "auth_exception", "profil"] as const) {
    it(`erreur serveur (${panne}) : « Le serveur ne répond pas », la tentative ne compte pas`, async () => {
      const c = compte();
      simulation.ip = nouvelleIp();
      simulation.panne = panne;
      try {
        for (let i = 0; i < 6; i += 1) {
          expect(await seConnecter(c.email, c.motDePasse)).toBe(messageErreur("ERREUR_INATTENDUE"));
        }
      } finally {
        simulation.panne = null;
      }
      const { rows } = await base.query(
        "select count(*)::int as n from public.tentatives_connexion where empreinte_email = $1",
        [empreinteEmail(c.email)],
      );
      expect(rows[0].n).toBe(0);
      // Après la panne : un mauvais mot de passe compte normalement, sans blocage.
      expect(await seConnecter(c.email, "mauvais")).toBe(REFUS);
      expect(await seConnecter(c.email, c.motDePasse)).toBe("REDIRECTION");
    }, 60_000);
  }

  it("10 essais simultanés sur le même email : au plus 5 transmis à Auth, les autres refusés", async () => {
    const c = compte();
    const appelsAvant = simulation.appelsAuth;
    const essais: Promise<string>[] = [];
    for (let i = 0; i < 10; i += 1) {
      // Une IP différente par essai : seul l'email est commun.
      simulation.ip = nouvelleIp();
      essais.push(seConnecter(c.email, "mauvais-mot-de-passe"));
    }
    const resultats = await Promise.all(essais);
    expect(simulation.appelsAuth - appelsAvant).toBeLessThanOrEqual(5);
    expect(resultats.filter((r) => r === TROP).length).toBeGreaterThanOrEqual(5);
    expect(resultats.every((r) => r === TROP || r === REFUS)).toBe(true);
    expect(await seConnecter(c.email, c.motDePasse)).toBe(TROP);
  }, 60_000);
});
