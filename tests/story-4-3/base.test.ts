import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { empreinteDeTest } from "@/tests/outils/ip-test";

// Story 4.3 — fonctions SQL sur le projet de développement (migration
// 20261103000028) : `demander_reinitialisation` (droits, limite d'une
// demande par adresse en 60 s et de 5 par IP en 15 min, vrai seulement pour
// un membre actif, purge au-delà d'un jour), `noter_lien_mot_de_passe`
// (administrateur actif, membre actif, journal), table sans droit.
// Expiration des liens de récupération : un lien dont l'envoi
// (`auth.users.recovery_sent_at`, vérifié sur nova-dev) date de 25 h est
// refusé, de 23 h accepté ; un nouveau lien rend l'ancien invalide.
// Base partagée : comptes `TEST-4.3-…` jetables, empreintes aléatoires.

const comptes: CompteTest[] = [];
const empreintesUtilisees: string[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let base: Client;

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "4.3", ...options });
  comptes.push(c);
  return c;
}

/** Empreinte aléatoire, effacée de la table en fin de test. */
function empreinte(): string {
  const e = empreinteDeTest();
  empreintesUtilisees.push(e);
  return e;
}

beforeAll(async () => {
  admin = await compte({ role: "administrateur", prenom: "Claire" });
  collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  try {
    if (base && empreintesUtilisees.length > 0) {
      await base.query(
        `delete from public.demandes_reinitialisation
          where empreinte_email = any($1::text[]) or empreinte_ip = any($1::text[])`,
        [empreintesUtilisees],
      );
    }
  } catch (erreur) {
    console.error(`Nettoyage des demandes impossible : ${String(erreur)}`);
  }
  await base?.end().catch(() => {});
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
}, 60_000);

async function demander(empreinteEmail: string, empreinteIp: string, email: string) {
  const { data, error } = await clientServiceTest().rpc("demander_reinitialisation", {
    p_empreinte_email: empreinteEmail,
    p_empreinte_ip: empreinteIp,
    p_email: email,
  });
  if (error) throw new Error(error.message);
  return data as { envoyer: boolean };
}

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
async function enTantQue<T = unknown>(c: CompteTest, sql: string, parametres: unknown[] = []): Promise<T> {
  await base.query("begin");
  try {
    await base.query("set local role authenticated");
    await base.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: c.id, role: "authenticated" }),
    ]);
    const { rows } = await base.query<{ r: T }>(`select ${sql} as r`, parametres);
    await base.query("commit");
    return rows[0].r;
  } catch (erreur) {
    await base.query("rollback").catch(() => {});
    throw erreur;
  }
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
  it("demander_reinitialisation : service_role seulement ; noter_lien_mot_de_passe : authenticated seulement", async () => {
    const { rows } = await base.query<{ f: string; r: string; peut: boolean }>(
      `select f, r, has_function_privilege(r, f, 'EXECUTE') as peut
         from unnest(array['public.demander_reinitialisation(text, text, text)',
                           'public.noter_lien_mot_de_passe(uuid)']) as f
        cross join unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    for (const l of rows) {
      const attendu = l.f.startsWith("public.demander") ? l.r === "service_role" : l.r === "authenticated";
      expect(l.peut, `${l.f} ${l.r}`).toBe(attendu);
    }

    const { rows: definitions } = await base.query<{ nom: string; definer: boolean; config: string[] | null }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('demander_reinitialisation', 'noter_lien_mot_de_passe')`,
    );
    expect(definitions).toHaveLength(2);
    for (const l of definitions) {
      expect(l.definer, l.nom).toBe(true);
      expect(l.config, l.nom).toContain('search_path=""');
    }
  });

  it("table demandes_reinitialisation : RLS active, aucun droit pour personne", async () => {
    const { rows } = await base.query<{ r: string; droit: string }>(
      `select r, d as droit
         from unnest(array['anon', 'authenticated', 'service_role']) as r
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as d
        where has_table_privilege(r, 'public.demandes_reinitialisation', d)`,
    );
    expect(rows).toEqual([]);
    const { rows: rls } = await base.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'public.demandes_reinitialisation'::regclass",
    );
    expect(rls[0].rls).toBe(true);
  });

  it("visiteur (clé publiable) : demander_reinitialisation refusée", async () => {
    const { error } = await clientPubliableTest().rpc("demander_reinitialisation", {
      p_empreinte_email: empreinte(),
      p_empreinte_ip: empreinte(),
      p_email: "x@example.com",
    });
    expect(error).not.toBeNull();
  });
});

describe("demander_reinitialisation", () => {
  it("membre actif : envoyer vrai (casse et espaces ignorés)", async () => {
    const leo = await compte({ prenom: "Leo" });
    expect(await demander(empreinte(), empreinte(), `  ${leo.email.toUpperCase()} `)).toEqual({
      envoyer: true,
    });
  });

  it("inconnu, invité, désactivé : envoyer faux", async () => {
    const invite = await compte({ prenom: "Ines", etat: "invite" });
    const desactive = await compte({ prenom: "Dan", etat: "desactive" });
    for (const email of ["inconnu-4-3@example.com", invite.email, desactive.email]) {
      expect(await demander(empreinte(), empreinte(), email), email).toEqual({ envoyer: false });
    }
  });

  it("2ᵉ demande de la même adresse en moins de 60 s : faux, rien d'enregistré", async () => {
    const leo = await compte({ prenom: "Leo" });
    const e = empreinte();
    expect(await demander(e, empreinte(), leo.email)).toEqual({ envoyer: true });
    expect(await demander(e, empreinte(), leo.email)).toEqual({ envoyer: false });
    const { rows } = await base.query<{ n: number }>(
      "select count(*)::int as n from public.demandes_reinitialisation where empreinte_email = $1",
      [e],
    );
    expect(rows[0].n).toBe(1);
  });

  it("6ᵉ demande de la même IP en 15 minutes : faux, même pour un membre actif", async () => {
    const leo = await compte({ prenom: "Leo" });
    const ip = empreinte();
    for (let i = 0; i < 5; i++) {
      expect(await demander(empreinte(), ip, `autre-${i}@example.com`)).toEqual({ envoyer: false });
    }
    expect(await demander(empreinte(), ip, leo.email)).toEqual({ envoyer: false });
    // Une autre IP n'est pas gênée.
    expect(await demander(empreinte(), empreinte(), leo.email)).toEqual({ envoyer: true });
  });

  it("une adresse redevient permise après 60 s", async () => {
    const leo = await compte({ prenom: "Leo" });
    const e = empreinte();
    expect(await demander(e, empreinte(), leo.email)).toEqual({ envoyer: true });
    await base.query(
      "update public.demandes_reinitialisation set cree_le = now() - interval '61 seconds' where empreinte_email = $1",
      [e],
    );
    expect(await demander(e, empreinte(), leo.email)).toEqual({ envoyer: true });
  });

  it("5 demandes acceptées pour la même adresse en 24 h : la suivante est refusée, même après 60 s", async () => {
    const leo = await compte({ prenom: "Leo" });
    const e = empreinte();
    // 4 demandes anciennes (au-delà de 60 s, dans les 24 h) : la 5ᵉ passe.
    for (const heures of [1, 5, 10, 23]) {
      await base.query(
        `insert into public.demandes_reinitialisation (empreinte_email, empreinte_ip, cree_le)
         values ($1, $2, now() - make_interval(hours => $3))`,
        [e, empreinte(), heures],
      );
    }
    expect(await demander(e, empreinte(), leo.email)).toEqual({ envoyer: true });
    await base.query(
      "update public.demandes_reinitialisation set cree_le = now() - interval '2 minutes' where empreinte_email = $1 and cree_le > now() - interval '1 minute'",
      [e],
    );
    // 6ᵉ : refusée, rien d'enregistré.
    expect(await demander(e, empreinte(), leo.email)).toEqual({ envoyer: false });
    const { rows } = await base.query<{ n: number }>(
      "select count(*)::int as n from public.demandes_reinitialisation where empreinte_email = $1",
      [e],
    );
    expect(rows[0].n).toBe(5);
    // Une demande sortie de la fenêtre de 24 h libère une place.
    await base.query(
      "update public.demandes_reinitialisation set cree_le = now() - interval '25 hours' where empreinte_email = $1 and cree_le < now() - interval '22 hours'",
      [e],
    );
    expect(await demander(e, empreinte(), leo.email)).toEqual({ envoyer: true });
  });

  it("lignes de plus d'un jour effacées au passage", async () => {
    const vieille = empreinte();
    await base.query(
      `insert into public.demandes_reinitialisation (empreinte_email, empreinte_ip, cree_le)
       values ($1, $1, now() - interval '25 hours')`,
      [vieille],
    );
    await demander(empreinte(), empreinte(), "purge-4-3@example.com");
    const { rows } = await base.query<{ n: number }>(
      "select count(*)::int as n from public.demandes_reinitialisation where cree_le < now() - interval '1 day'",
    );
    expect(rows[0].n).toBe(0);
  });

  it("empreinte mal formée : DONNEES_INVALIDES", async () => {
    expect(await codeDe(demander("pas-une-empreinte", empreinte(), "a@example.com"))).toBe(
      "DONNEES_INVALIDES",
    );
  });

  it("aucune adresse en clair dans la table", async () => {
    const leo = await compte({ prenom: "Leo" });
    await demander(empreinte(), empreinte(), leo.email);
    const { rows } = await base.query<{ n: number }>(
      `select count(*)::int as n from public.demandes_reinitialisation d
        where d::text ilike '%' || $1 || '%'`,
      [leo.email],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("noter_lien_mot_de_passe", () => {
  it("collaborateur : DROIT_INSUFFISANT, rien au journal", async () => {
    const cible = await compte({ prenom: "Cible" });
    expect(await codeDe(enTantQue(collaborateur, "public.noter_lien_mot_de_passe($1)", [cible.id]))).toBe(
      "DROIT_INSUFFISANT",
    );
    expect(await journal(cible.id)).toEqual([]);
  });

  it("compte invité ou désactivé : ETAT_COMPTE_INVALIDE ; inconnu : DONNEES_INVALIDES", async () => {
    const invite = await compte({ prenom: "Ines", etat: "invite" });
    const desactive = await compte({ prenom: "Dan", etat: "desactive" });
    for (const c of [invite, desactive]) {
      expect(await codeDe(enTantQue(admin, "public.noter_lien_mot_de_passe($1)", [c.id]))).toBe(
        "ETAT_COMPTE_INVALIDE",
      );
      expect(await journal(c.id)).toEqual([]);
    }
    expect(
      await codeDe(
        enTantQue(admin, "public.noter_lien_mot_de_passe($1)", ["99999999-9999-4999-8999-999999999999"]),
      ),
    ).toBe("DONNEES_INVALIDES");
  });

  it("administrateur, membre actif : email renvoyé, journal lien_mot_de_passe_genere", async () => {
    const leo = await compte({ prenom: "Leo" });
    const r = await enTantQue<Record<string, unknown>>(admin, "public.noter_lien_mot_de_passe($1)", [leo.id]);
    expect(r).toEqual({ id: leo.id, nom: leo.nom, email: leo.email });
    expect(await journal(leo.id)).toEqual([
      {
        auteur_id: admin.id,
        details: { evenement: "lien_mot_de_passe_genere", membre_id: leo.id, nom: leo.nom },
      },
    ]);
  });
});

describe("liens de récupération (Supabase Auth)", () => {
  /** Lien de récupération dont l'envoi est reculé de `heures`. */
  async function lienRecule(c: CompteTest, heures: number): Promise<string> {
    const { data, error } = await clientServiceTest().auth.admin.generateLink({
      type: "recovery",
      email: c.email,
    });
    if (error) throw new Error(`generateLink : ${error.code ?? error.status}`);
    const { rowCount } = await base.query(
      "update auth.users set recovery_sent_at = now() - make_interval(hours => $2) where id = $1",
      [c.id, heures],
    );
    expect(rowCount).toBe(1);
    return data.properties.hashed_token;
  }

  async function verifier(jeton: string) {
    const { error } = await clientPubliableTest().auth.verifyOtp({ token_hash: jeton, type: "recovery" });
    return error ? (error.code ?? `statut ${error.status}`) : null;
  }

  it("envoyé il y a 25 h : refusé (otp_expired)", async () => {
    const leo = await compte({ prenom: "Leo" });
    expect(await verifier(await lienRecule(leo, 25))).toBe("otp_expired");
  });

  it("envoyé il y a 23 h : accepté", async () => {
    const leo = await compte({ prenom: "Leo" });
    expect(await verifier(await lienRecule(leo, 23))).toBeNull();
  });

  it("un nouveau lien rend le précédent invalide ; un lien ne sert qu'une fois", async () => {
    const leo = await compte({ prenom: "Leo" });
    const service = clientServiceTest();
    const premier = await service.auth.admin.generateLink({ type: "recovery", email: leo.email });
    const second = await service.auth.admin.generateLink({ type: "recovery", email: leo.email });
    expect(await verifier(premier.data.properties!.hashed_token)).not.toBeNull();
    expect(await verifier(second.data.properties!.hashed_token)).toBeNull();
    expect(await verifier(second.data.properties!.hashed_token)).not.toBeNull();
  });
});
