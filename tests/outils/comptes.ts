import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { EtatMembre, Role } from "@/lib/domaine";

// Comptes jetables pour les tests (story 1.4) : chaque test crée ses propres
// comptes `TEST-…` (compte Auth + ligne `membres` via `creer_membre`, comme
// les scripts) et les supprime à la fin. Jamais le compte d'Abraham, jamais
// les comptes de test persistants (TEST-Admin, TEST-Collaborateur).
// Utilisé par Vitest et par Playwright (hors Next.js : pas de `server-only`).

export type CompteTest = {
  id: string;
  nom: string;
  email: string;
  motDePasse: string;
  role: Role;
  etat: EtatMembre;
};

function variable(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} manquant dans .env.local.`);
  return valeur;
}

const SANS_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Client avec la clé secrète (API d'administration Auth, creer_membre). */
export function clientServiceTest(): SupabaseClient {
  return createClient(variable("NEXT_PUBLIC_SUPABASE_URL"), variable("SUPABASE_SECRET_KEY"), {
    auth: SANS_SESSION,
  });
}

/** Client avec la clé publiable, sans session (rôle `anon`). */
export function clientPubliableTest(): SupabaseClient {
  return createClient(
    variable("NEXT_PUBLIC_SUPABASE_URL"),
    variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: SANS_SESSION },
  );
}

/** Client avec la clé publiable et la session du compte (rôle `authenticated`). */
export async function clientConnecte(compte: CompteTest): Promise<SupabaseClient> {
  const client = clientPubliableTest();
  const { error } = await client.auth.signInWithPassword({
    email: compte.email,
    password: compte.motDePasse,
  });
  if (error) throw new Error(`Connexion du compte de test impossible (${error.code ?? error.status}).`);
  return client;
}

/**
 * Crée un compte jetable. `desactive` n'existe pas à la création
 * (`creer_membre` le refuse) : le compte est créé actif puis désactivé
 * directement en base.
 */
export async function creerCompteTest(
  options: { role?: Role; etat?: EtatMembre; prenom?: string; etiquette?: string } = {},
): Promise<CompteTest> {
  const role = options.role ?? "collaborateur";
  const etat = options.etat ?? "actif";
  const code = randomUUID().slice(0, 8);
  const etiquette = options.etiquette ?? "1.4";
  const nom = `TEST-${etiquette}-${code} ${options.prenom ?? "Karim"} Benali`;
  const email = `test-${etiquette.replace(/[^a-z0-9]/gi, "-")}-${code}@example.com`.toLowerCase();
  const motDePasse = randomBytes(18).toString("base64url");

  const service = clientServiceTest();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: motDePasse,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Création du compte Auth de test impossible (${error?.code ?? error?.status}).`);
  }
  const id = data.user.id;

  const { error: erreurMembre } = await service.rpc("creer_membre", {
    p_id: id,
    p_nom: nom,
    p_email: email,
    p_role: role,
    p_etat: etat === "desactive" ? "actif" : etat,
  });
  if (erreurMembre) {
    await service.auth.admin.deleteUser(id);
    throw new Error(`creer_membre a échoué pour le compte de test (${erreurMembre.message}).`);
  }

  if (etat === "desactive") {
    try {
      await avecBase((base) =>
        base.query("update public.membres set etat = 'desactive' where id = $1", [id]),
      );
    } catch (erreur) {
      // Pas de compte à moitié prêt : on le supprime avant d'échouer.
      await supprimerComptesTest([{ id, nom, email, motDePasse, role, etat }]);
      throw erreur;
    }
  }

  return { id, nom, email, motDePasse, role, etat };
}

/** Supprime des comptes jetables (la ligne `membres` part en cascade). */
export async function supprimerComptesTest(comptes: CompteTest[]): Promise<void> {
  const service = clientServiceTest();
  // Chaque compte séparément : un échec n'empêche pas de nettoyer les autres.
  for (const compte of comptes) {
    if (!compte.nom.startsWith("TEST-")) continue; // garde-fou
    try {
      await avecBase((base) => base.query("delete from public.membres where id = $1", [compte.id]));
    } catch (erreur) {
      console.error(
        `Suppression de la ligne membres de test impossible : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
    }
    try {
      const { error } = await service.auth.admin.deleteUser(compte.id);
      if (error && error.status !== 404) {
        console.error(`Suppression du compte de test impossible (${error.code ?? error.status}).`);
      }
    } catch (erreur) {
      console.error(
        `Suppression du compte de test impossible : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
    }
  }
}

/** Connexion directe à la base de développement (SUPABASE_DB_URL). */
export async function avecBase<T>(travail: (base: Client) => Promise<T>): Promise<T> {
  const base = new Client({ connectionString: variable("SUPABASE_DB_URL") });
  await base.connect();
  try {
    return await travail(base);
  } finally {
    await base.end();
  }
}

/**
 * Story 4.1 — efface les lignes du journal écrites par des comptes de test
 * (le journal cite ses auteurs : sans cela, leur ligne `membres` ne peut pas
 * être supprimée). L'effacement du journal n'est permis qu'avec le drapeau
 * de transaction `nova.purge_journal` (migration 0010) ; garde-fou en SQL :
 * seulement les auteurs dont le nom commence par `TEST-`.
 */
export async function effacerJournalDesComptesTest(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return avecBase(async (base) => {
    await base.query("begin");
    try {
      await base.query("select set_config('nova.purge_journal', 'on', true)");
      const { rowCount } = await base.query(
        `delete from public.journal j
          using public.membres m
          where m.id = j.auteur_id
            and m.id = any($1::uuid[])
            and m.nom like 'TEST-%'`,
        [ids],
      );
      await base.query("commit");
      return rowCount ?? 0;
    } catch (erreur) {
      await base.query("rollback").catch(() => {});
      throw erreur;
    }
  });
}
