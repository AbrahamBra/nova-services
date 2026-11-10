import { randomUUID } from "node:crypto";
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

// Story 4.4 — fonctions SQL sur le projet de développement (migration
// 20261103000029) : `noter_renvoi_invitation` et `annuler_invitation`
// (droits, administrateur actif, membre invité seulement, journal, seule
// suppression de membre permise). Liens d'invitation (Supabase Auth) : un
// renvoi garde le même compte et rend l'ancien lien invalide ; un lien dont
// l'envoi (`auth.users.confirmation_sent_at`, vérifié sur nova-dev : la
// colonne `invited_at` n'est pas lue par Auth) date de 25 h est refusé, de
// 23 h accepté ; une invitation expirée renvoyée redevient valable 24 h.
// Base partagée : comptes `TEST-4.4-…` jetables, journal compris.

const comptes: CompteTest[] = [];
/** Comptes Auth créés par generateLink (sans ligne `membres`). */
const comptesAuth: string[] = [];
/** Membres supprimés par annuler_invitation : leur journal est à effacer. */
const membresAnnules: string[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let base: Client;

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "4.4", ...options });
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
  await base?.end().catch(() => {});
  await supprimerComptesTest(comptes);
  const service = clientServiceTest();
  for (const id of [...comptesAuth, ...membresAnnules]) {
    await service.auth.admin.deleteUser(id).catch(() => {});
  }
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

async function existe(id: string): Promise<boolean> {
  const { rows } = await base.query("select 1 from public.membres where id = $1", [id]);
  return rows.length === 1;
}

describe("droits", () => {
  it("noter_renvoi_invitation et annuler_invitation : authenticated seulement, SECURITY DEFINER, search_path vide", async () => {
    const { rows } = await base.query<{ f: string; r: string; peut: boolean }>(
      `select f, r, has_function_privilege(r, f, 'EXECUTE') as peut
         from unnest(array['public.noter_renvoi_invitation(uuid)',
                           'public.annuler_invitation(uuid)']) as f
        cross join unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(rows).toHaveLength(6);
    for (const l of rows) expect(l.peut, `${l.f} ${l.r}`).toBe(l.r === "authenticated");

    const { rows: definitions } = await base.query<{ nom: string; definer: boolean; config: string[] | null }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('noter_renvoi_invitation', 'annuler_invitation')`,
    );
    expect(definitions).toHaveLength(2);
    for (const l of definitions) {
      expect(l.definer, l.nom).toBe(true);
      expect(l.config, l.nom).toContain('search_path=""');
    }
  });

  it("visiteur (clé publiable) : les deux fonctions refusées", async () => {
    const invite = await compte({ prenom: "Ines", etat: "invite" });
    for (const fonction of ["noter_renvoi_invitation", "annuler_invitation"]) {
      const { error } = await clientPubliableTest().rpc(fonction, { p_id: invite.id });
      expect(error, fonction).not.toBeNull();
    }
    expect(await existe(invite.id)).toBe(true);
    expect(await journal(invite.id)).toEqual([]);
  });

  it("collaborateur : DROIT_INSUFFISANT pour les deux, rien ne change", async () => {
    const invite = await compte({ prenom: "Ines", etat: "invite" });
    for (const fonction of ["noter_renvoi_invitation", "annuler_invitation"]) {
      expect(
        await codeDe(enTantQue(collaborateur, `public.${fonction}($1)`, [invite.id])),
        fonction,
      ).toBe("DROIT_INSUFFISANT");
    }
    expect(await existe(invite.id)).toBe(true);
    expect(await journal(invite.id)).toEqual([]);
  });

  it("administrateur désactivé : DROIT_INSUFFISANT", async () => {
    const ancien = await compte({ role: "administrateur", prenom: "Paul", etat: "desactive" });
    const invite = await compte({ prenom: "Ines", etat: "invite" });
    expect(await codeDe(enTantQue(ancien, "public.annuler_invitation($1)", [invite.id]))).toBe(
      "DROIT_INSUFFISANT",
    );
    expect(await existe(invite.id)).toBe(true);
  });
});

describe("noter_renvoi_invitation", () => {
  it("compte actif ou désactivé : ETAT_COMPTE_INVALIDE ; inconnu : DONNEES_INVALIDES", async () => {
    const actif = await compte({ prenom: "Leo" });
    const desactive = await compte({ prenom: "Dan", etat: "desactive" });
    for (const c of [actif, desactive]) {
      expect(await codeDe(enTantQue(admin, "public.noter_renvoi_invitation($1)", [c.id]))).toBe(
        "ETAT_COMPTE_INVALIDE",
      );
      expect(await journal(c.id)).toEqual([]);
    }
    expect(
      await codeDe(
        enTantQue(admin, "public.noter_renvoi_invitation($1)", ["99999999-9999-4999-8999-999999999999"]),
      ),
    ).toBe("DONNEES_INVALIDES");
  });

  it("membre invité : email renvoyé, journal invitation_renvoyee, compte inchangé", async () => {
    const leo = await compte({ prenom: "Leo", etat: "invite" });
    const r = await enTantQue<Record<string, unknown>>(admin, "public.noter_renvoi_invitation($1)", [leo.id]);
    expect(r).toEqual({ id: leo.id, nom: leo.nom, email: leo.email });
    expect(await journal(leo.id)).toEqual([
      {
        auteur_id: admin.id,
        details: { evenement: "invitation_renvoyee", membre_id: leo.id, nom: leo.nom },
      },
    ]);
    const { rows } = await base.query("select etat from public.membres where id = $1", [leo.id]);
    expect(rows[0].etat).toBe("invite");
  });
});

describe("annuler_invitation", () => {
  it("compte actif ou désactivé : ETAT_COMPTE_INVALIDE, rien supprimé ; inconnu : DONNEES_INVALIDES", async () => {
    const actif = await compte({ prenom: "Leo" });
    const desactive = await compte({ prenom: "Dan", etat: "desactive" });
    for (const c of [actif, desactive]) {
      expect(await codeDe(enTantQue(admin, "public.annuler_invitation($1)", [c.id]))).toBe(
        "ETAT_COMPTE_INVALIDE",
      );
      expect(await existe(c.id)).toBe(true);
      expect(await journal(c.id)).toEqual([]);
    }
    expect(
      await codeDe(
        enTantQue(admin, "public.annuler_invitation($1)", ["99999999-9999-4999-8999-999999999999"]),
      ),
    ).toBe("DONNEES_INVALIDES");
  });

  it("membre invité : ligne membres supprimée, journal invitation_annulee ; un 2ᵉ appel : DONNEES_INVALIDES", async () => {
    const leo = await compte({ prenom: "Leo", etat: "invite" });
    membresAnnules.push(leo.id);
    const r = await enTantQue<Record<string, unknown>>(admin, "public.annuler_invitation($1)", [leo.id]);
    expect(r).toEqual({ id: leo.id, nom: leo.nom });
    expect(await existe(leo.id)).toBe(false);
    expect(await journal(leo.id)).toEqual([
      {
        auteur_id: admin.id,
        details: { evenement: "invitation_annulee", membre_id: leo.id, nom: leo.nom },
      },
    ]);
    // Le compte Auth reste (supprimé ensuite par l'action) : non touché ici.
    const { rows } = await base.query("select 1 from auth.users where id = $1", [leo.id]);
    expect(rows).toHaveLength(1);
    expect(await codeDe(enTantQue(admin, "public.annuler_invitation($1)", [leo.id]))).toBe(
      "DONNEES_INVALIDES",
    );
  });
});

describe("liens d'invitation (Supabase Auth)", () => {
  /** Invitation réelle (compte Auth non confirmé), comme l'action `inviter`. */
  async function inviter(): Promise<{ id: string; email: string; jeton: string }> {
    const email = `test-4-4-${randomUUID().slice(0, 8)}@example.com`;
    const { data, error } = await clientServiceTest().auth.admin.generateLink({ type: "invite", email });
    if (error) throw new Error(`generateLink : ${error.code ?? error.status}`);
    comptesAuth.push(data.user.id);
    return { id: data.user.id, email, jeton: data.properties.hashed_token };
  }

  async function reculer(id: string, heures: number) {
    const { rowCount } = await base.query(
      "update auth.users set confirmation_sent_at = now() - make_interval(hours => $2) where id = $1",
      [id, heures],
    );
    expect(rowCount).toBe(1);
  }

  async function verifier(jeton: string) {
    const { error } = await clientPubliableTest().auth.verifyOtp({ token_hash: jeton, type: "invite" });
    return error ? (error.code ?? `statut ${error.status}`) : null;
  }

  it("envoyée il y a 25 h : refusée (otp_expired)", async () => {
    const leo = await inviter();
    await reculer(leo.id, 25);
    expect(await verifier(leo.jeton)).toBe("otp_expired");
  });

  it("envoyée il y a 23 h : acceptée", async () => {
    const leo = await inviter();
    await reculer(leo.id, 23);
    expect(await verifier(leo.jeton)).toBeNull();
  });

  it("invitation expirée (25 h) puis renvoyée : le nouveau lien est accepté, l'ancien refusé", async () => {
    const leo = await inviter();
    await reculer(leo.id, 25);
    const { data, error } = await clientServiceTest().auth.admin.generateLink({
      type: "invite",
      email: leo.email,
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(leo.id);
    // Le renvoi remet la date d'envoi à maintenant : nouvelle fenêtre de 24 h.
    const { rows } = await base.query<{ recent: boolean }>(
      "select confirmation_sent_at > now() - interval '1 hour' as recent from auth.users where id = $1",
      [leo.id],
    );
    expect(rows[0].recent).toBe(true);
    expect(await verifier(leo.jeton)).not.toBeNull();
    expect(await verifier(data.properties!.hashed_token)).toBeNull();
  });

  it("renvoi : même compte, nouveau jeton ; l'ancien lien devient invalide", async () => {
    const leo = await inviter();
    const { data, error } = await clientServiceTest().auth.admin.generateLink({
      type: "invite",
      email: leo.email,
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(leo.id);
    expect(data.properties?.hashed_token).not.toBe(leo.jeton);
    expect(await verifier(leo.jeton)).not.toBeNull();
    expect(await verifier(data.properties!.hashed_token)).toBeNull();
  });
});
