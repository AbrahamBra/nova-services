import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// Story 4.1 — fonctions SQL sur le projet de développement (migration
// 20261103000024) : `lister_comptes` (administrateur actif seulement),
// `mon_invitation` et `activer_mon_compte` (sur auth.uid() seulement),
// `creer_membre` avec auteur (journal `compte_cree`) ou sans (scripts, rien
// au journal), droits EXECUTE ; retour arrière AD-17 sur l'API Auth réelle.
// Comptes `TEST-4.1-…` jetables, supprimés à la fin (avec leurs lignes de
// journal, qui les citent comme auteur).

let admin: CompteTest;
let collaborateur: CompteTest;
let invite: CompteTest;
let desactive: CompteTest;
const comptes: CompteTest[] = [];
const comptesAuthSeuls: string[] = [];
let base: Client;

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "4.1", ...options });
  comptes.push(c);
  return c;
}

beforeAll(async () => {
  admin = await compte({ role: "administrateur", prenom: "Claire" });
  collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
  invite = await compte({ etat: "invite", prenom: "Léo" });
  desactive = await compte({ etat: "desactive", prenom: "Nadia" });
  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  await base?.end().catch(() => {});
  // Le journal cite les auteurs (clé étrangère) : ses lignes de test d'abord.
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
  const service = clientServiceTest();
  for (const id of comptesAuthSeuls) {
    await service.auth.admin.deleteUser(id).catch(() => {});
  }
}, 60_000);

/** Compte Auth sans ligne `membres`, comme après `generateLink` (supprimé à la fin). */
async function compteAuthSeul(): Promise<{ id: string; email: string }> {
  const email = `test-4-1-auth-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await clientServiceTest().auth.admin.createUser({
    email,
    password: randomBytes(18).toString("base64url"),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("Création du compte Auth impossible.");
  comptesAuthSeuls.push(data.user.id);
  return { id: data.user.id, email };
}

describe("droits EXECUTE", () => {
  it("lister_comptes, mon_invitation, activer_mon_compte : authenticated seulement ; creer_membre : service_role", async () => {
    const { rows } = await base.query<{ fonction: string; role: string; peut: boolean }>(
      `select f as fonction, r as role, has_function_privilege(r, f, 'EXECUTE') as peut
         from unnest(array['public.lister_comptes()', 'public.mon_invitation()',
                           'public.activer_mon_compte()',
                           'public.creer_membre(uuid, text, text, text, text, uuid)']) as f
        cross join unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    const droits = Object.fromEntries(rows.map((l) => [`${l.fonction}|${l.role}`, l.peut]));
    for (const f of ["public.lister_comptes()", "public.mon_invitation()", "public.activer_mon_compte()"]) {
      expect(droits[`${f}|anon`], f).toBe(false);
      expect(droits[`${f}|authenticated`], f).toBe(true);
      expect(droits[`${f}|service_role`], f).toBe(false);
    }
    const creer = "public.creer_membre(uuid, text, text, text, text, uuid)";
    expect([droits[`${creer}|anon`], droits[`${creer}|authenticated`], droits[`${creer}|service_role`]]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("toutes SECURITY DEFINER avec search_path vide", async () => {
    const { rows } = await base.query<{ nom: string; definer: boolean; config: string[] | null }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('lister_comptes', 'mon_invitation', 'activer_mon_compte', 'creer_membre',
                            'verifier_email_libre')`,
    );
    expect(rows).toHaveLength(5); // une seule signature de creer_membre
    for (const ligne of rows) {
      expect(ligne.definer, ligne.nom).toBe(true);
      expect(ligne.config, ligne.nom).toContain('search_path=""');
    }
  });
});

describe("lister_comptes", () => {
  it("administrateur actif : tous les comptes, avec email, rôle et état, triés par nom", async () => {
    const client = await clientConnecte(admin);
    const { data, error } = await client.rpc("lister_comptes");
    expect(error).toBeNull();
    const liste = data as { id: string; nom: string; email: string; role: string; etat: string }[];
    const leo = liste.find((c) => c.id === invite.id);
    expect(leo).toEqual({ id: invite.id, nom: invite.nom, email: invite.email, role: "collaborateur", etat: "invite" });
    expect(liste.find((c) => c.id === desactive.id)?.etat).toBe("desactive");
    // Ordre comparé à celui de la base elle-même (même collation, mêmes
    // lignes), jamais retrié en JS : la base partagée contient des noms
    // accentués ou ponctués.
    const ids = liste.map((c) => c.id);
    const { rows } = await base.query<{ ids: string[] }>(
      `select array_agg(m.id::text order by lower(m.nom), m.id) as ids
         from public.membres m where m.id = any($1::uuid[])`,
      [ids],
    );
    expect(ids).toEqual(rows[0].ids);
  });

  it.each([
    ["collaborateur", () => collaborateur],
    ["invité", () => invite],
    ["désactivé", () => desactive],
  ])("%s : DROIT_INSUFFISANT", async (_cas, qui) => {
    const client = await clientConnecte(qui());
    const { data, error } = await client.rpc("lister_comptes");
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "P0001", message: "DROIT_INSUFFISANT" });
  });

  it("sans session : refusée", async () => {
    const { error } = await clientPubliableTest().rpc("lister_comptes");
    expect(error?.code).toBe("42501");
  });
});

describe("mon_invitation", () => {
  it("compte invité : son nom, rien d'autre", async () => {
    const client = await clientConnecte(invite);
    const { data, error } = await client.rpc("mon_invitation");
    expect(error).toBeNull();
    expect(data).toEqual({ nom: invite.nom });
  });

  it.each([
    ["actif", () => collaborateur],
    ["désactivé", () => desactive],
  ])("compte %s : null", async (_cas, qui) => {
    const client = await clientConnecte(qui());
    const { data, error } = await client.rpc("mon_invitation");
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("activer_mon_compte", () => {
  it("invité → actif ; un second appel est sans effet", async () => {
    const leo = await compte({ etat: "invite", prenom: "Léo" });
    const client = await clientConnecte(leo);
    expect((await client.rpc("activer_mon_compte")).error).toBeNull();
    const { rows } = await base.query("select etat from public.membres where id = $1", [leo.id]);
    expect(rows[0].etat).toBe("actif");
    const second = await client.rpc("activer_mon_compte");
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ etat: "actif" });
    // Désormais membre actif : mon_profil le voit.
    expect((await client.rpc("mon_profil")).data).toMatchObject({ nom: leo.nom, etat: "actif" });
  });

  it("désactivé : DROIT_INSUFFISANT, reste désactivé", async () => {
    const client = await clientConnecte(desactive);
    const { error } = await client.rpc("activer_mon_compte");
    expect(error).toMatchObject({ code: "P0001", message: "DROIT_INSUFFISANT" });
    const { rows } = await base.query("select etat from public.membres where id = $1", [desactive.id]);
    expect(rows[0].etat).toBe("desactive");
  });

  it("compte Auth sans membre : DROIT_INSUFFISANT", async () => {
    const auth = await compteAuthSeul();
    const { error: erreurMdp } = await clientServiceTest().auth.admin.updateUserById(auth.id, {
      password: "mot-de-passe-de-test-4-1",
    });
    expect(erreurMdp).toBeNull();
    const client = clientPubliableTest();
    await client.auth.signInWithPassword({ email: auth.email, password: "mot-de-passe-de-test-4-1" });
    const { error } = await client.rpc("activer_mon_compte");
    expect(error).toMatchObject({ code: "P0001", message: "DROIT_INSUFFISANT" });
  });
});

describe("creer_membre avec auteur (journal)", () => {
  it("auteur administrateur : membre invité et ligne `compte_cree` au nom de l'auteur", async () => {
    const auth = await compteAuthSeul();
    const nom = `TEST-4.1-${randomUUID().slice(0, 8)} Léo Martin`;
    const { error } = await clientServiceTest().rpc("creer_membre", {
      p_id: auth.id,
      p_nom: nom,
      p_email: auth.email,
      p_role: "collaborateur",
      p_etat: "invite",
      p_auteur_id: admin.id,
    });
    expect(error).toBeNull();
    comptes.push({ id: auth.id, nom, email: auth.email, motDePasse: "", role: "collaborateur", etat: "invite" });

    const { rows } = await base.query(
      `select type, auteur_type, auteur_id, details from public.journal
        where details->>'membre_id' = $1`,
      [auth.id],
    );
    expect(rows).toEqual([
      {
        type: "compte",
        auteur_type: "membre",
        auteur_id: admin.id,
        details: { evenement: "compte_cree", membre_id: auth.id, nom, role: "collaborateur" },
      },
    ]);
  });

  it("sans auteur (scripts, tests) : aucune ligne de journal", async () => {
    const auth = await compteAuthSeul();
    const nom = `TEST-4.1-${randomUUID().slice(0, 8)} Script`;
    const { error } = await clientServiceTest().rpc("creer_membre", {
      p_id: auth.id,
      p_nom: nom,
      p_email: auth.email,
      p_role: "collaborateur",
      p_etat: "actif",
    });
    expect(error).toBeNull();
    comptes.push({ id: auth.id, nom, email: auth.email, motDePasse: "", role: "collaborateur", etat: "actif" });
    const { rowCount } = await base.query(
      "select 1 from public.journal where details->>'membre_id' = $1",
      [auth.id],
    );
    expect(rowCount).toBe(0);
  });

  it("auteur collaborateur : DROIT_INSUFFISANT, rien créé ni journalisé", async () => {
    const auth = await compteAuthSeul();
    const { error } = await clientServiceTest().rpc("creer_membre", {
      p_id: auth.id,
      p_nom: "TEST-4.1 Pirate",
      p_email: auth.email,
      p_role: "administrateur",
      p_etat: "invite",
      p_auteur_id: collaborateur.id,
    });
    expect(error).toMatchObject({ code: "P0001", message: "DROIT_INSUFFISANT" });
    const membres = await base.query("select 1 from public.membres where id = $1", [auth.id]);
    expect(membres.rowCount).toBe(0);
  });

  it("email déjà pris (casse différente) : EMAIL_DEJA_UTILISE", async () => {
    const auth = await compteAuthSeul();
    // Compte Auth dont l'adresse diffère : le contrôle de l'email passe avant.
    const { error } = await clientServiceTest().rpc("creer_membre", {
      p_id: auth.id,
      p_nom: "TEST-4.1 Doublon",
      p_email: invite.email.toUpperCase(),
      p_role: "collaborateur",
      p_etat: "invite",
      p_auteur_id: admin.id,
    });
    expect(error).toMatchObject({ code: "P0001", message: "EMAIL_DEJA_UTILISE" });
  });
});

describe("verifier_email_libre", () => {
  it("adresse neuve : libre", async () => {
    const { data, error } = await clientServiceTest().rpc("verifier_email_libre", {
      p_email: ` Test-4-1-libre-${randomUUID().slice(0, 8)}@Example.com `,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ libre: true });
  });

  it.each([
    ["membre actif (casse différente)", () => collaborateur.email.toUpperCase()],
    ["membre invité", () => invite.email],
    ["membre désactivé", () => desactive.email],
  ])("%s : EMAIL_DEJA_UTILISE", async (_cas, adresse) => {
    const { error } = await clientServiceTest().rpc("verifier_email_libre", { p_email: adresse() });
    expect(error).toMatchObject({ code: "P0001", message: "EMAIL_DEJA_UTILISE" });
  });

  it("compte Auth sans membre : EMAIL_DEJA_UTILISE", async () => {
    const auth = await compteAuthSeul();
    const { error } = await clientServiceTest().rpc("verifier_email_libre", { p_email: auth.email });
    expect(error).toMatchObject({ code: "P0001", message: "EMAIL_DEJA_UTILISE" });
  });

  it("réservée à service_role", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r as role, has_function_privilege(r, 'public.verifier_email_libre(text)', 'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(Object.fromEntries(rows.map((l) => [l.role, l.peut]))).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
  });
});

describe("retour arrière AD-17 (API Auth réelle)", () => {
  it("generateLink crée le compte Auth sans email ; après un échec de creer_membre, deleteUser le retire", async () => {
    const service = clientServiceTest();
    const email = `test-4-1-ad17-${randomUUID().slice(0, 8)}@example.com`;
    const { data, error } = await service.auth.admin.generateLink({ type: "invite", email });
    expect(error).toBeNull();
    const id = data.user!.id;
    comptesAuthSeuls.push(id);
    expect(data.properties?.hashed_token).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

    // Comportement réel (sondé sur nova-dev) : sur un compte Auth NON
    // confirmé, un second generateLink n'est PAS refusé ; il renvoie le même
    // compte, avec sa date de création d'origine et un nouveau jeton. D'où la
    // vérification préalable `verifier_email_libre` dans `inviter`, et la
    // suppression réservée aux comptes créés par l'appel lui-même.
    const second = await service.auth.admin.generateLink({ type: "invite", email });
    expect(second.error).toBeNull();
    expect(second.data.user?.id).toBe(id);
    expect(second.data.user?.created_at).toBe(data.user!.created_at);
    expect(second.data.properties?.hashed_token).not.toBe(data.properties?.hashed_token);
    await expect(
      service.rpc("verifier_email_libre", { p_email: email.toUpperCase() }),
    ).resolves.toMatchObject({ error: { code: "P0001", message: "EMAIL_DEJA_UTILISE" } });

    const echec = await service.rpc("creer_membre", {
      p_id: id,
      p_nom: "",
      p_email: email,
      p_role: "collaborateur",
      p_etat: "invite",
      p_auteur_id: admin.id,
    });
    expect(echec.error).toMatchObject({ code: "P0001", message: "DONNEES_INVALIDES" });
    expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
    const reste = await base.query("select 1 from auth.users where id = $1", [id]);
    expect(reste.rowCount).toBe(0);
  });
});
