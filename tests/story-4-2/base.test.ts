import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest } from "@/tests/outils/demandes";

// Story 4.2 — fonctions SQL sur le projet de développement (migration
// 20261103000026) : `modifier_membre`, `desactiver_membre`,
// `reactiver_membre` (droits, PROPRE_COMPTE, ETAT_COMPTE_INVALIDE, journal),
// verrou et DERNIER_ADMIN en parallèle, demandes En cours remises en
// Nouvelle avec historique, `lister_comptes` (demandes_en_cours),
// `verifier_email_libre` (COMPTE_DESACTIVE), attribuer et rouvrir avec un
// compte désactivé, session ouverte refusée, blocage Auth.
// Les sessions sont simulées dans une transaction (rôle `authenticated` et
// `sub` du compte), comme PostgREST, sauf pour la session ouverte de Léo.
// Base partagée : comptes `TEST-4.2-…` et demandes `TEST-4.2-…` jetables.

const PREFIXE = `TEST-4.2-${randomUUID().slice(0, 8)}`;

const comptes: CompteTest[] = [];
const sessions: SupabaseClient[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let base: Client;

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "4.2", ...options });
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
  // Demandes d'abord (l'historique cite les comptes), puis le journal.
  try {
    if (base) await supprimerDemandesTest(base, PREFIXE);
  } catch (erreur) {
    console.error(`Nettoyage des demandes impossible : ${String(erreur)}`);
  }
  await base?.end().catch(() => {});
  for (const session of sessions) await session.auth.signOut({ scope: "local" }).catch(() => {});
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  const service = clientServiceTest();
  for (const c of comptes) {
    await service.auth.admin.updateUserById(c.id, { ban_duration: "none" }).catch(() => {});
  }
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

/** Appelle une fonction avec la session simulée de `c`, dans sa propre transaction (validée). */
async function enTantQue<T = unknown>(c: CompteTest, sql: string, parametres: unknown[] = [], connexion = base): Promise<T> {
  await connexion.query("begin");
  try {
    await connexion.query("set local role authenticated");
    await connexion.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: c.id, role: "authenticated" }),
    ]);
    const { rows } = await connexion.query<{ r: T }>(`select ${sql} as r`, parametres);
    await connexion.query("commit");
    return rows[0].r;
  } catch (erreur) {
    await connexion.query("rollback").catch(() => {});
    throw erreur;
  }
}

async function membre(id: string) {
  const { rows } = await base.query<{ nom: string; role: string; etat: string }>(
    "select nom, role, etat from public.membres where id = $1",
    [id],
  );
  return rows[0];
}

async function journal(membreId: string) {
  const { rows } = await base.query<{ details: Record<string, unknown>; auteur_id: string }>(
    `select details, auteur_id from public.journal
      where type = 'compte' and details ->> 'membre_id' = $1
      order by id`,
    [membreId],
  );
  return rows;
}

describe("droits", () => {
  it("EXECUTE à authenticated seulement ; SECURITY DEFINER, search_path vide", async () => {
    const fonctions = [
      "public.modifier_membre(uuid, text, text)",
      "public.desactiver_membre(uuid)",
      "public.reactiver_membre(uuid)",
    ];
    const { rows } = await base.query<{ f: string; r: string; peut: boolean }>(
      `select f, r, has_function_privilege(r, f, 'EXECUTE') as peut
         from unnest($1::text[]) as f
        cross join unnest(array['anon', 'authenticated', 'service_role']) as r`,
      [fonctions],
    );
    for (const l of rows) expect(l.peut, `${l.f} ${l.r}`).toBe(l.r === "authenticated");

    const { rows: definitions } = await base.query<{ nom: string; definer: boolean; config: string[] | null }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('modifier_membre', 'desactiver_membre', 'reactiver_membre',
                            'lister_comptes', 'verifier_email_libre')`,
    );
    expect(definitions).toHaveLength(5);
    for (const l of definitions) {
      expect(l.definer, l.nom).toBe(true);
      expect(l.config, l.nom).toContain('search_path=""');
    }
  });

  it("collaborateur : DROIT_INSUFFISANT pour les trois fonctions, rien ne change", async () => {
    const cible = await compte({ prenom: "Cible" });
    expect(
      await codeDe(enTantQue(collaborateur, "public.modifier_membre($1, 'X', 'administrateur')", [cible.id])),
    ).toBe("DROIT_INSUFFISANT");
    expect(await codeDe(enTantQue(collaborateur, "public.desactiver_membre($1)", [cible.id]))).toBe(
      "DROIT_INSUFFISANT",
    );
    expect(await codeDe(enTantQue(collaborateur, "public.reactiver_membre($1)", [cible.id]))).toBe(
      "DROIT_INSUFFISANT",
    );
    expect(await membre(cible.id)).toEqual({ nom: cible.nom, role: "collaborateur", etat: "actif" });
  });

  it("visiteur (clé publiable) : refusé par la base", async () => {
    const { error } = await clientPubliableTest().rpc("desactiver_membre", { p_id: admin.id });
    expect(error).not.toBeNull();
  });
});

describe("modifier_membre", () => {
  it("nom et rôle changés, journal compte_modifie avec l'ancien et le nouveau", async () => {
    const leo = await compte({ prenom: "Leo" });
    const nouveauNom = `${leo.nom} Junior`;
    const r = await enTantQue<Record<string, unknown>>(
      admin,
      "public.modifier_membre($1, $2, 'administrateur')",
      [leo.id, `  ${nouveauNom} `],
    );
    expect(r).toMatchObject({ id: leo.id, nom: nouveauNom, role: "administrateur", modifie: true });
    expect(await membre(leo.id)).toEqual({ nom: nouveauNom, role: "administrateur", etat: "actif" });
    expect(await journal(leo.id)).toEqual([
      {
        auteur_id: admin.id,
        details: {
          evenement: "compte_modifie",
          membre_id: leo.id,
          nom: nouveauNom,
          role: "administrateur",
          ancien_nom: leo.nom,
          ancien_role: "collaborateur",
        },
      },
    ]);

    // Rien ne change : réussite, aucune ligne de journal de plus.
    const encore = await enTantQue<Record<string, unknown>>(
      admin,
      "public.modifier_membre($1, $2, 'administrateur')",
      [leo.id, nouveauNom],
    );
    expect(encore).toMatchObject({ modifie: false });
    expect(await journal(leo.id)).toHaveLength(1);
  });

  it("sur soi-même : le nom oui, le rôle jamais (PROPRE_COMPTE)", async () => {
    const moi = await compte({ role: "administrateur", prenom: "Moi" });
    expect(
      await codeDe(enTantQue(moi, "public.modifier_membre($1, $2, 'collaborateur')", [moi.id, moi.nom])),
    ).toBe("PROPRE_COMPTE");
    await enTantQue(moi, "public.modifier_membre($1, $2, 'administrateur')", [moi.id, `${moi.nom} B`]);
    expect(await membre(moi.id)).toMatchObject({ nom: `${moi.nom} B`, role: "administrateur" });
  });

  it("saisie invalide ou compte inconnu : DONNEES_INVALIDES", async () => {
    expect(
      await codeDe(enTantQue(admin, "public.modifier_membre($1, '   ', 'collaborateur')", [collaborateur.id])),
    ).toBe("DONNEES_INVALIDES");
    expect(
      await codeDe(enTantQue(admin, "public.modifier_membre($1, 'X', 'chef')", [collaborateur.id])),
    ).toBe("DONNEES_INVALIDES");
    expect(
      await codeDe(enTantQue(admin, "public.modifier_membre($1, 'X', 'collaborateur')", [randomUUID()])),
    ).toBe("DONNEES_INVALIDES");
  });
});

describe("desactiver_membre", () => {
  it("Léo, responsable de 2 demandes En cours : Désactivé, 2 demandes Nouvelle sans responsable, 2 lignes retour_nouvelle", async () => {
    const leo = await compte({ prenom: "Leo" });
    const d1 = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: leo.id });
    const d2 = await creerDemandeTest(base, PREFIXE, { statut: "en_cours", responsableId: leo.id });
    const traitee = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: leo.id });

    const avant = await enTantQue<{ id: string; demandes_en_cours: number }[]>(admin, "public.lister_comptes()");
    expect(avant.find((c) => c.id === leo.id)?.demandes_en_cours).toBe(2);

    const r = await enTantQue(admin, "public.desactiver_membre($1)", [leo.id]);
    expect(r).toEqual({ id: leo.id, etat: "desactive", demandes_remises: 2 });
    expect((await membre(leo.id)).etat).toBe("desactive");

    const { rows: demandes } = await base.query<{ id: string; statut: string; responsable_id: string | null }>(
      "select id, statut, responsable_id from public.demandes where id = any($1::uuid[]) order by id",
      [[d1.id, d2.id, traitee.id]],
    );
    const parId = Object.fromEntries(demandes.map((d) => [d.id, d]));
    expect(parId[d1.id]).toMatchObject({ statut: "nouvelle", responsable_id: null });
    expect(parId[d2.id]).toMatchObject({ statut: "nouvelle", responsable_id: null });
    // Traitée : inchangée (son responsable reste dans l'historique).
    expect(parId[traitee.id]).toMatchObject({ statut: "traitee", responsable_id: leo.id });

    const { rows: historique } = await base.query(
      `select demande_id, type, auteur_type, auteur_id, ancienne_valeur, nouvelle_valeur
         from public.historique where demande_id = any($1::uuid[]) and type = 'retour_nouvelle'
        order by demande_id`,
      [[d1.id, d2.id]],
    );
    expect(historique).toHaveLength(2);
    for (const ligne of historique) {
      expect(ligne).toMatchObject({
        type: "retour_nouvelle",
        auteur_type: "membre",
        auteur_id: admin.id,
        ancienne_valeur: "en_cours",
        nouvelle_valeur: "nouvelle",
      });
    }

    expect(await journal(leo.id)).toEqual([
      {
        auteur_id: admin.id,
        details: { evenement: "compte_desactive", membre_id: leo.id, nom: leo.nom, demandes_remises: 2 },
      },
    ]);

    const apres = await enTantQue<{ id: string; demandes_en_cours: number; etat: string }[]>(
      admin,
      "public.lister_comptes()",
    );
    expect(apres.find((c) => c.id === leo.id)).toMatchObject({ etat: "desactive", demandes_en_cours: 0 });
    // Son nom reste lisible (rien n'est supprimé).
    expect((await membre(leo.id)).nom).toBe(leo.nom);
  });

  it("soi-même : PROPRE_COMPTE ; compte non actif : ETAT_COMPTE_INVALIDE", async () => {
    expect(await codeDe(enTantQue(admin, "public.desactiver_membre($1)", [admin.id]))).toBe("PROPRE_COMPTE");
    const invite = await compte({ etat: "invite", prenom: "Ines" });
    const desactive = await compte({ etat: "desactive", prenom: "Nadia" });
    expect(await codeDe(enTantQue(admin, "public.desactiver_membre($1)", [invite.id]))).toBe(
      "ETAT_COMPTE_INVALIDE",
    );
    expect(await codeDe(enTantQue(admin, "public.desactiver_membre($1)", [desactive.id]))).toBe(
      "ETAT_COMPTE_INVALIDE",
    );
    expect(await journal(invite.id)).toEqual([]);
  });

  it("session ouverte : l'action suivante est refusée, plus de profil", async () => {
    const leo = await compte({ prenom: "Leo" });
    const session = await clientConnecte(leo);
    sessions.push(session);
    expect((await session.rpc("mon_profil")).data).toMatchObject({ etat: "actif" });

    await enTantQue(admin, "public.desactiver_membre($1)", [leo.id]);

    expect((await session.rpc("mon_profil")).data).toBeNull();
    const demande = await creerDemandeTest(base, PREFIXE);
    const { error } = await session.rpc("prendre_en_charge", { p_demande_id: demande.id });
    expect(error?.message).toBe("DROIT_INSUFFISANT");
  });
});

describe("reactiver_membre", () => {
  it("seulement depuis Désactivé ; journal compte_reactive", async () => {
    const leo = await compte({ etat: "desactive", prenom: "Leo" });
    expect(await enTantQue(admin, "public.reactiver_membre($1)", [leo.id])).toEqual({ id: leo.id, etat: "actif" });
    expect((await membre(leo.id)).etat).toBe("actif");
    expect(await journal(leo.id)).toEqual([
      { auteur_id: admin.id, details: { evenement: "compte_reactive", membre_id: leo.id, nom: leo.nom } },
    ]);
    expect(await codeDe(enTantQue(admin, "public.reactiver_membre($1)", [leo.id]))).toBe("ETAT_COMPTE_INVALIDE");
    const invite = await compte({ etat: "invite", prenom: "Ines" });
    expect(await codeDe(enTantQue(admin, "public.reactiver_membre($1)", [invite.id]))).toBe(
      "ETAT_COMPTE_INVALIDE",
    );
  });
});

describe("dernier administrateur actif, actions simultanées", () => {
  // Seuls des comptes TEST- sont lus, modifiés ou verrouillés ici : la base
  // partagée contient de vrais administrateurs, jamais touchés.
  //
  // DERNIER_ADMIN lui-même ne peut pas être atteint sans rétrograder les
  // vrais administrateurs : il n'est atteignable que si l'appelant perd ses
  // droits pendant l'attente du verrou ET qu'il n'en reste aucun autre. Il
  // est donc prouvé ainsi :
  //   - ici, la sérialisation par le verrou (le second appel attend, puis
  //     voit le changement du premier et est refusé) ;
  //   - ici, la place du contrôle dans le corps des fonctions (après le
  //     verrou, compté sur les administrateurs ACTIFS autres que la cible) ;
  //   - dans action.test.ts, le message de DERNIER_ADMIN sous le champ Rôle.

  /** Session simulée dans une transaction ouverte (non validée) de `connexion`. */
  async function ouvrirSession(connexion: Client, c: CompteTest) {
    await connexion.query("begin");
    await connexion.query("set local role authenticated");
    await connexion.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: c.id, role: "authenticated" }),
    ]);
  }

  async function deuxConnexions<T>(travail: (c1: Client, c2: Client) => Promise<T>): Promise<T> {
    const c1 = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    const c2 = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await c1.connect();
    await c2.connect();
    try {
      return await travail(c1, c2);
    } finally {
      await c1.query("rollback").catch(() => {});
      await c2.query("rollback").catch(() => {});
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
  }

  it.each([
    ["se rétrogradent", "public.modifier_membre($1, $2, 'collaborateur')", "role", "collaborateur"],
    ["se désactivent", "public.desactiver_membre($1)", "etat", "desactive"],
  ] as const)(
    "deux administrateurs %s l'un l'autre en même temps : le second attend le verrou, puis est refusé",
    async (_cas, appel, colonne, valeur) => {
      const a = await compte({ role: "administrateur", prenom: "Anne" });
      const b = await compte({ role: "administrateur", prenom: "Bruno" });
      const parametres = (cible: CompteTest) => (appel.includes("$2") ? [cible.id, cible.nom] : [cible.id]);

      await deuxConnexions(async (c1, c2) => {
        // 1. A agit sur B : verrou pris, pas encore validé.
        await ouvrirSession(c1, a);
        await c1.query(`select ${appel}`, parametres(b));

        // 2. B agit sur A : attend le verrou.
        await ouvrirSession(c2, b);
        let fini = false;
        const second = c2
          .query(`select ${appel}`, parametres(a))
          .then(
            () => null,
            (erreur: { message?: string }) => erreur.message ?? "?",
          )
          .finally(() => {
            fini = true;
          });
        await new Promise((r) => setTimeout(r, 1_000));
        expect(fini, "le second appel doit attendre le verrou").toBe(false);

        // 3. A valide : B reprend, voit qu'il n'est plus administrateur
        // actif (DERNIER_ADMIN s'il n'en restait aucun autre).
        await c1.query("commit");
        expect(["DROIT_INSUFFISANT", "DERNIER_ADMIN"]).toContain(await second);
        await c2.query("rollback");
      });

      const etatA = await membre(a.id);
      const etatB = await membre(b.id);
      expect(etatA).toMatchObject({ role: "administrateur", etat: "actif" });
      expect(etatB[colonne]).toBe(valeur);
    },
    30_000,
  );

  it("DERNIER_ADMIN : contrôlé après le verrou, sur les administrateurs actifs autres que la cible", async () => {
    const { rows } = await base.query<{ nom: string; corps: string }>(
      `select p.proname as nom, p.prosrc as corps
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('modifier_membre', 'desactiver_membre')
        order by 1`,
    );
    expect(rows.map((r) => r.nom)).toEqual(["desactiver_membre", "modifier_membre"]);
    for (const { nom, corps } of rows) {
      const verrou = corps.indexOf("pg_advisory_xact_lock(hashtextextended('membres:administrateurs', 0))");
      const dernier = corps.indexOf("'DERNIER_ADMIN'");
      const recontrole = corps.lastIndexOf("prive.est_admin()");
      expect(verrou, nom).toBeGreaterThan(0);
      expect(dernier, nom).toBeGreaterThan(verrou);
      // L'appelant est revérifié après l'attente du verrou.
      expect(recontrole, nom).toBeGreaterThan(verrou);
      const controle = corps.slice(verrou, dernier);
      expect(controle, nom).toMatch(
        /m\.id <> p_id and m\.role = 'administrateur' and m\.etat = 'actif'/,
      );
    }
  });
});

describe("verifier_email_libre", () => {
  it("compte désactivé : COMPTE_DESACTIVE avec son identifiant en détail (casse ignorée)", async () => {
    const leo = await compte({ etat: "desactive", prenom: "Leo" });
    const { error } = await clientServiceTest().rpc("verifier_email_libre", {
      p_email: ` ${leo.email.toUpperCase()} `,
    });
    expect(error?.message).toBe("COMPTE_DESACTIVE");
    expect(JSON.parse(error?.details ?? "{}")).toEqual({ id: leo.id });
  });

  it("compte actif : toujours EMAIL_DEJA_UTILISE", async () => {
    const { error } = await clientServiceTest().rpc("verifier_email_libre", { p_email: collaborateur.email });
    expect(error?.message).toBe("EMAIL_DEJA_UTILISE");
  });
});

describe("compte désactivé et traitement des demandes (déjà en place)", () => {
  it("attribuer à un compte désactivé : MEMBRE_INVALIDE", async () => {
    const leo = await compte({ etat: "desactive", prenom: "Leo" });
    const demande = await creerDemandeTest(base, PREFIXE);
    expect(
      await codeDe(enTantQue(admin, "public.attribuer($1, $2)", [demande.id, leo.id])),
    ).toBe("MEMBRE_INVALIDE");
  });

  it("rouvrir une demande Traitée dont le responsable est désactivé : Nouvelle sans responsable", async () => {
    const leo = await compte({ prenom: "Leo" });
    const demande = await creerDemandeTest(base, PREFIXE, { statut: "traitee", responsableId: leo.id });
    await enTantQue(admin, "public.desactiver_membre($1)", [leo.id]);
    const r = await enTantQue<Record<string, unknown>>(admin, "public.changer_statut($1, 'en_cours')", [demande.id]);
    expect(r).toMatchObject({ statut: "nouvelle", responsable_id: null });
  });
});

describe("blocage Auth (utilisé par les actions)", () => {
  it("ban_duration : connexion refusée (user_banned), puis acceptée après « none »", async () => {
    const leo = await compte({ prenom: "Leo" });
    const service = clientServiceTest();
    const blocage = await service.auth.admin.updateUserById(leo.id, { ban_duration: "876000h" });
    expect(blocage.error).toBeNull();
    const refus = await clientPubliableTest().auth.signInWithPassword({
      email: leo.email,
      password: leo.motDePasse,
    });
    expect(refus.error?.code).toBe("user_banned");

    const deblocage = await service.auth.admin.updateUserById(leo.id, { ban_duration: "none" });
    expect(deblocage.error).toBeNull();
    const session = await clientConnecte(leo);
    sessions.push(session);
  });
});
