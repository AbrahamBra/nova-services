import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client, type DatabaseError } from "pg";
import { empreinteDeTest } from "../outils/ip-test";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";

// Story 1.4 — table `membres`, fonctions de droits, `mon_profil` et
// `creer_membre` sur le projet de développement (migration 20261103000005).
// Les comptes sont des comptes `TEST-…` jetables, créés et supprimés ici.

let admin: CompteTest;
let collaborateur: CompteTest;
let invite: CompteTest;
let desactive: CompteTest;
const comptes: CompteTest[] = [];
const comptesAuthSeuls: string[] = [];

let base: Client;

beforeAll(async () => {
  admin = await creerCompteTest({ role: "administrateur", prenom: "Claire" });
  comptes.push(admin);
  collaborateur = await creerCompteTest({ role: "collaborateur", prenom: "Karim" });
  comptes.push(collaborateur);
  invite = await creerCompteTest({ etat: "invite", prenom: "Léo" });
  comptes.push(invite);
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Nadia" });
  comptes.push(desactive);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  await base?.end().catch(() => {});
  await supprimerComptesTest(comptes);
  const service = clientServiceTest();
  for (const id of comptesAuthSeuls) {
    try {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error && error.status !== 404) {
        console.error(`Suppression du compte Auth de test impossible (${error.code ?? error.status}).`);
      }
    } catch (erreur) {
      console.error(`Suppression du compte Auth de test impossible : ${String(erreur)}`);
    }
  }
}, 60_000);

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

/** Compte Auth sans ligne `membres` (supprimé à la fin). */
async function compteAuthSeul(): Promise<{ id: string; email: string }> {
  const email = `test-1-4-auth-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await clientServiceTest().auth.admin.createUser({
    email,
    password: randomBytes(18).toString("base64url"),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("Création du compte Auth impossible.");
  comptesAuthSeuls.push(data.user.id);
  return { id: data.user.id, email };
}

function creerMembre(
  client: SupabaseClient,
  p: { id: string; nom: string; email: string; role?: string; etat?: string },
) {
  return client.rpc("creer_membre", {
    p_id: p.id,
    p_nom: p.nom,
    p_email: p.email,
    p_role: p.role ?? "collaborateur",
    p_etat: p.etat ?? "invite",
  });
}

describe("mon_profil — membre connecté", () => {
  it("renvoie à un administrateur actif son nom, son rôle et son état, et rien d'autre", async () => {
    const client = await clientConnecte(admin);
    const { data, error } = await client.rpc("mon_profil");
    expect(error).toBeNull();
    expect(data).toEqual({ nom: admin.nom, role: "administrateur", etat: "actif" });
  });

  it("renvoie à un collaborateur actif son propre profil, jamais celui d'un autre membre", async () => {
    const client = await clientConnecte(collaborateur);
    const { data, error } = await client.rpc("mon_profil");
    expect(error).toBeNull();
    expect(data).toEqual({ nom: collaborateur.nom, role: "collaborateur", etat: "actif" });
    expect(JSON.stringify(data)).not.toContain(admin.nom);
    expect(JSON.stringify(data)).not.toContain(collaborateur.email);
  });

  it("renvoie null à un compte invité", async () => {
    const client = await clientConnecte(invite);
    const { data, error } = await client.rpc("mon_profil");
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("renvoie null à un compte désactivé", async () => {
    const client = await clientConnecte(desactive);
    const { data, error } = await client.rpc("mon_profil");
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("est refusée sans session (clé publiable seule)", async () => {
    const { data, error } = await clientPubliableTest().rpc("mon_profil");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("prive.est_membre_actif et prive.est_admin", () => {
  async function droits(id: string | null) {
    return dansTransactionAnnulee(async () => {
      await base.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(id ? { sub: id, role: "authenticated" } : { role: "anon" }),
      ]);
      const { rows } = await base.query<{ actif: boolean; admin: boolean }>(
        "select prive.est_membre_actif() as actif, prive.est_admin() as admin",
      );
      return rows[0];
    });
  }

  it("administrateur actif : membre actif et administrateur", async () => {
    expect(await droits(admin.id)).toEqual({ actif: true, admin: true });
  });

  it("collaborateur actif : membre actif, pas administrateur", async () => {
    expect(await droits(collaborateur.id)).toEqual({ actif: true, admin: false });
  });

  it("invité, désactivé et visiteur : aucun droit", async () => {
    expect(await droits(invite.id)).toEqual({ actif: false, admin: false });
    expect(await droits(desactive.id)).toEqual({ actif: false, admin: false });
    expect(await droits(null)).toEqual({ actif: false, admin: false });
  });

  it("un administrateur désactivé perd aussitôt ses droits", async () => {
    await dansTransactionAnnulee(async () => {
      await base.query("update public.membres set etat = 'desactive' where id = $1", [admin.id]);
      await base.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: admin.id, role: "authenticated" }),
      ]);
      const { rows } = await base.query(
        "select prive.est_membre_actif() as actif, prive.est_admin() as admin",
      );
      expect(rows[0]).toEqual({ actif: false, admin: false });
    });
  });
});

describe("creer_membre — droits EXECUTE", () => {
  // Story 4.1 : signature avec l'auteur facultatif (p_auteur_id) ; l'ancienne
  // signature à 5 paramètres n'existe plus.
  it("réservée à service_role dans le catalogue", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r as role,
              has_function_privilege(r, 'public.creer_membre(uuid, text, text, text, text, uuid)', 'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(Object.fromEntries(rows.map((l) => [l.role, l.peut]))).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
  });

  it("refusée avec la clé publiable", async () => {
    const auth = await compteAuthSeul();
    const { error } = await creerMembre(clientPubliableTest(), {
      id: auth.id,
      nom: "TEST-1.4 Pirate",
      email: auth.email,
      etat: "actif",
    });
    expect(error?.code).toBe("42501");
  });

  it("refusée avec une session authenticated, même administrateur", async () => {
    const auth = await compteAuthSeul();
    const client = await clientConnecte(admin);
    const { error } = await creerMembre(client, {
      id: auth.id,
      nom: "TEST-1.4 Pirate",
      email: auth.email,
      role: "administrateur",
      etat: "actif",
    });
    expect(error?.code).toBe("42501");
    const { rowCount } = await base.query("select 1 from public.membres where id = $1", [auth.id]);
    expect(rowCount).toBe(0);
  });
});

describe("creer_membre — contrôles", () => {
  it("refuse l'état desactive à la création", async () => {
    const auth = await compteAuthSeul();
    const { error } = await creerMembre(clientServiceTest(), {
      id: auth.id,
      nom: "TEST-1.4 Léo Martin",
      email: auth.email,
      etat: "desactive",
    });
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DONNEES_INVALIDES");
  });

  it("refuse un rôle inconnu", async () => {
    const auth = await compteAuthSeul();
    const { error } = await creerMembre(clientServiceTest(), {
      id: auth.id,
      nom: "TEST-1.4 Léo Martin",
      email: auth.email,
      role: "superadmin",
    });
    expect(error?.message).toBe("DONNEES_INVALIDES");
  });

  it("refuse un compte Auth inexistant ou une adresse différente de celle du compte", async () => {
    const service = clientServiceTest();
    const inexistant = await creerMembre(service, {
      id: randomUUID(),
      nom: "TEST-1.4 Fantôme",
      email: "test-1-4-fantome@example.com",
    });
    expect(inexistant.error?.message).toBe("DONNEES_INVALIDES");

    const auth = await compteAuthSeul();
    const autreAdresse = await creerMembre(service, {
      id: auth.id,
      nom: "TEST-1.4 Léo Martin",
      email: "test-1-4-autre@example.com",
    });
    expect(autreAdresse.error?.message).toBe("DONNEES_INVALIDES");
  });

  it("refuse un compte déjà membre", async () => {
    const { error } = await creerMembre(clientServiceTest(), {
      id: collaborateur.id,
      nom: collaborateur.nom,
      email: collaborateur.email,
    });
    expect(error?.message).toBe("MEMBRE_EXISTANT");
  });

  it("refuse une adresse déjà utilisée par un autre membre", async () => {
    const auth = await compteAuthSeul();
    const { error } = await creerMembre(clientServiceTest(), {
      id: auth.id,
      nom: "TEST-1.4 Doublon",
      email: collaborateur.email.toUpperCase(),
    });
    expect(error?.message).toBe("EMAIL_DEJA_UTILISE");
  });

  it("enregistre le nom sans espaces autour et l'email en minuscules", async () => {
    const auth = await compteAuthSeul();
    const { error } = await creerMembre(clientServiceTest(), {
      id: auth.id,
      nom: "  TEST-1.4 Léo Martin  ",
      email: `  ${auth.email.toUpperCase()} `,
    });
    expect(error).toBeNull();
    const { rows } = await base.query("select nom, email, role, etat from public.membres where id = $1", [
      auth.id,
    ]);
    expect(rows[0]).toEqual({
      nom: "TEST-1.4 Léo Martin",
      email: auth.email,
      role: "collaborateur",
      etat: "invite",
    });
    // Supprimer le compte Auth supprime la ligne membres (cascade).
  });
});

describe("table membres — contraintes", () => {
  it("l'email est unique", async () => {
    const auth = await compteAuthSeul();
    const erreur = await dansTransactionAnnulee(() =>
      erreurDe(
        base.query(
          "insert into public.membres (id, nom, email, role, etat) values ($1, 'TEST-1.4 Doublon', $2, 'collaborateur', 'actif')",
          [auth.id, collaborateur.email],
        ),
      ),
    );
    expect(erreur.code).toBe("23505");
  });

  it("l'email est en minuscules, le rôle et l'état sont des codes fermés", async () => {
    const auth = await compteAuthSeul();
    for (const [email, role, etat] of [
      [auth.email.toUpperCase(), "collaborateur", "actif"],
      [auth.email, "chef", "actif"],
      [auth.email, "collaborateur", "suspendu"],
    ]) {
      const erreur = await dansTransactionAnnulee(() =>
        erreurDe(
          base.query(
            "insert into public.membres (id, nom, email, role, etat) values ($1, 'TEST-1.4 Contrainte', $2, $3, $4)",
            [auth.id, email, role, etat],
          ),
        ),
      );
      expect(erreur.code).toBe("23514");
    }
  });

  it("RLS est activée et aucun rôle de l'API n'a de droit direct", async () => {
    const { rows } = await base.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'public.membres'::regclass",
    );
    expect(rows[0].rls).toBe(true);
    const droits = await base.query<{ droit: string }>(
      `select r || ':' || d as droit
         from unnest(array['anon', 'authenticated', 'service_role']) as r
        cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as d
        where has_table_privilege(r, 'public.membres', d)`,
    );
    expect(droits.rows).toEqual([]);
  });

  it("demandes.responsable_id, demandes.saisie_par_id, historique.auteur_id, journal.auteur_id et notes.auteur_id pointent vers membres", async () => {
    const { rows } = await base.query<{ colonne: string }>(
      `select c.conrelid::regclass::text || '.' || a.attname as colonne
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = 'public.membres'::regclass
        order by 1`,
    );
    expect(rows.map((l) => l.colonne)).toEqual([
      "demandes.responsable_id",
      "demandes.saisie_par_id",
      "historique.auteur_id",
      // Story 1.7 : auteur (membre) d'une ligne du journal.
      "journal.auteur_id",
      // Story 2.2 : auteur (membre) d'une note interne.
      "notes.auteur_id",
    ]);
  });

  it("une demande ne peut pas citer un responsable qui n'est pas membre", async () => {
    const erreur = await dansTransactionAnnulee(async () => {
      const { rows } = await base.query<{ r: { reference: string } }>(
        `select public.deposer_demande($1, 'TEST-1.4 Sophie Garnier', 'sophie.garnier@example.com',
                null, null, (select id from public.categories where actif order by ordre limit 1),
                'Objet', 'Description', true, $2) as r`,
        [randomUUID(), empreinteDeTest()],
      );
      return erreurDe(
        base.query("update public.demandes set responsable_id = $1 where reference = $2", [
          randomUUID(),
          rows[0].r.reference,
        ]),
      );
    });
    expect(erreur.code).toBe("23503");
  });
});
