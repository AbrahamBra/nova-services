import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// La clé secrète (`service_role`) contourne RLS : elle ne doit avoir aucun
// droit direct sur les tables métier, qui ne changent que par les fonctions
// SQL en SECURITY DEFINER (AD-4, AD-5, AD-6 ; migrations 20261103000004 et 0005).

const TABLES = [
  "demandes",
  "historique",
  "compteurs_reference",
  "categories",
  "parametres",
  "membres",
  // Story 1.5 : vue de la liste, lue seulement avec la session d'un membre.
  "demandes_liste",
  // Story 1.7 : journal, écrit seulement par prive.ecrire_journal.
  "journal",
  // Story 1.8 : empreintes d'IP, écrites seulement par deposer_demande.
  "envois_formulaire",
  // Story 1.9 : tentatives de connexion, écrites seulement par
  // commencer_connexion et terminer_connexion.
  "tentatives_connexion",
  // Story 2.2 : notes internes, écrites seulement par ajouter_note.
  "notes",
  // Story 3.4 : registre des effacements, lu seulement par rejouer_effacements.
  "effacements",
  // Story 4.3 : demandes « Mot de passe oublié », écrites seulement par
  // demander_reinitialisation.
  "demandes_reinitialisation",
];
const DROITS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

let client: Client;

beforeAll(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL manquant dans .env.local.");
  client = new Client({ connectionString: url });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

describe("sécurité — droits de service_role sur les tables", () => {
  it("aucun droit direct sur les tables métier", async () => {
    const { rows } = await client.query<{ droit: string }>(
      `select t.nom || ':' || d.droit as droit
       from unnest($1::text[]) as t(nom)
       cross join unnest($2::text[]) as d(droit)
       where has_table_privilege('service_role', 'public.' || t.nom, d.droit)
       order by 1`,
      [TABLES, DROITS],
    );
    expect(rows.map((ligne) => ligne.droit)).toEqual([]);
  });

  it("aucun droit par colonne sur les tables métier ni sur la vue", async () => {
    const { rows } = await client.query<{ droit: string }>(
      `select c.relname || '.' || a.attname || ':' || d.droit as droit
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) as d(droit)
       where c.relname = any($1::text[])
         and has_column_privilege('service_role', c.oid, a.attnum, d.droit)
       order by 1`,
      [TABLES],
    );
    expect(rows.map((ligne) => ligne.droit)).toEqual([]);
  });

  // Story 2.5 : la recherche est réservée aux membres connectés ; la colonne
  // `demandes.recherche` est couverte par le test des colonnes ci-dessus.
  it("aucun droit sur rechercher_demandes, ids_demandes_recherche ni prive.normaliser", async () => {
    const { rows } = await client.query<{ fonction: string }>(
      `select f.fonction
       from unnest(array['public.rechercher_demandes(text)', 'public.ids_demandes_recherche(text)', 'prive.normaliser(text)']) as f(fonction)
       where has_function_privilege('service_role', f.fonction, 'EXECUTE')`,
    );
    expect(rows.map((ligne) => ligne.fonction)).toEqual([]);
  });

  // Story 2.6 : la saisie interne est réservée aux membres connectés (session),
  // jamais à la clé secrète.
  it("aucun droit sur saisir_demande", async () => {
    const { rows } = await client.query<{ peut: boolean }>(
      `select has_function_privilege('service_role',
         'public.saisir_demande(uuid, text, text, text, text, text, uuid, text, text)',
         'EXECUTE') as peut`,
    );
    expect(rows[0].peut).toBe(false);
  });

  // Story 2.7 : libérer et attribuer sont réservées aux membres connectés
  // (session), jamais à la clé secrète.
  it("aucun droit sur liberer ni attribuer", async () => {
    const { rows } = await client.query<{ fonction: string }>(
      `select f.fonction
       from unnest(array['public.liberer(uuid)', 'public.attribuer(uuid, uuid)']) as f(fonction)
       where has_function_privilege('service_role', f.fonction, 'EXECUTE')`,
    );
    expect(rows.map((ligne) => ligne.fonction)).toEqual([]);
  });

  // Story 4.1 : la liste des comptes, l'invitation et l'activation se lisent
  // avec la session du membre (auth.uid()), jamais avec la clé secrète ;
  // creer_membre (nouvelle signature, avec l'auteur) reste à service_role.
  it("aucun droit sur lister_comptes, mon_invitation ni activer_mon_compte ; creer_membre et verifier_email_libre permises", async () => {
    const { rows } = await client.query<{ fonction: string; peut: boolean }>(
      `select f.fonction, has_function_privilege('service_role', f.fonction, 'EXECUTE') as peut
       from unnest(array['public.lister_comptes()', 'public.mon_invitation()',
                         'public.activer_mon_compte()',
                         'public.creer_membre(uuid, text, text, text, text, uuid)',
                         'public.verifier_email_libre(text)']) as f(fonction)
       order by 1`,
    );
    expect(Object.fromEntries(rows.map((l) => [l.fonction, l.peut]))).toEqual({
      "public.activer_mon_compte()": false,
      "public.creer_membre(uuid, text, text, text, text, uuid)": true,
      "public.lister_comptes()": false,
      "public.mon_invitation()": false,
      "public.verifier_email_libre(text)": true,
    });
  });

  // Story 4.2 : modifier, désactiver, réactiver un compte se font avec la
  // session de l'administrateur (auth.uid()), jamais avec la clé secrète.
  it("aucun droit sur modifier_membre, desactiver_membre ni reactiver_membre", async () => {
    const { rows } = await client.query<{ fonction: string; peut: boolean }>(
      `select f.fonction, has_function_privilege('service_role', f.fonction, 'EXECUTE') as peut
       from unnest(array['public.modifier_membre(uuid, text, text)',
                         'public.desactiver_membre(uuid)',
                         'public.reactiver_membre(uuid)']) as f(fonction)
       order by 1`,
    );
    expect(Object.fromEntries(rows.map((l) => [l.fonction, l.peut]))).toEqual({
      "public.desactiver_membre(uuid)": false,
      "public.modifier_membre(uuid, text, text)": false,
      "public.reactiver_membre(uuid)": false,
    });
  });

  // Story 3.4 : le rejeu des effacements, après une restauration, se lance
  // avec la clé secrète (AD-15, AD-30).
  it("rejouer_effacements permise", async () => {
    const { rows } = await client.query<{ peut: boolean }>(
      `select has_function_privilege('service_role', 'public.rejouer_effacements()', 'EXECUTE') as peut`,
    );
    expect(rows[0].peut).toBe(true);
  });

  // Story 4.3 : la demande d'un lien passe par la clé secrète (action
  // demanderLienMotDePasse) ; le lien généré par l'administrateur se note
  // avec sa session, jamais avec la clé secrète.
  it("demander_reinitialisation permise ; aucun droit sur noter_lien_mot_de_passe", async () => {
    const { rows } = await client.query<{ fonction: string; peut: boolean }>(
      `select f.fonction, has_function_privilege('service_role', f.fonction, 'EXECUTE') as peut
       from unnest(array['public.demander_reinitialisation(text, text, text)',
                         'public.noter_lien_mot_de_passe(uuid)']) as f(fonction)
       order by 1`,
    );
    expect(Object.fromEntries(rows.map((l) => [l.fonction, l.peut]))).toEqual({
      "public.demander_reinitialisation(text, text, text)": true,
      "public.noter_lien_mot_de_passe(uuid)": false,
    });
  });

  // Story 4.4 : le renvoi et l'annulation d'une invitation se font avec la
  // session de l'administrateur, jamais avec la clé secrète.
  it("aucun droit sur noter_renvoi_invitation ni annuler_invitation", async () => {
    const { rows } = await client.query<{ fonction: string; peut: boolean }>(
      `select f.fonction, has_function_privilege('service_role', f.fonction, 'EXECUTE') as peut
       from unnest(array['public.annuler_invitation(uuid)',
                         'public.noter_renvoi_invitation(uuid)']) as f(fonction)
       order by 1`,
    );
    expect(Object.fromEntries(rows.map((l) => [l.fonction, l.peut]))).toEqual({
      "public.annuler_invitation(uuid)": false,
      "public.noter_renvoi_invitation(uuid)": false,
    });
  });

  // Story 5.1 : le journal se lit avec la session de l'administrateur,
  // jamais avec la clé secrète.
  it("aucun droit sur lire_journal", async () => {
    const { rows } = await client.query<{ peut: boolean }>(
      "select has_function_privilege('service_role', 'public.lire_journal(text, integer)', 'EXECUTE') as peut",
    );
    expect(rows[0].peut).toBe(false);
  });

  it("aucun usage direct des séquences de l'historique, du journal, des envois, des tentatives et des notes", async () => {
    for (const sequence of [
      "public.historique_id_seq",
      "public.journal_id_seq",
      "public.envois_formulaire_id_seq",
      "public.tentatives_connexion_id_seq",
      "public.notes_id_seq",
      "public.demandes_reinitialisation_id_seq",
    ]) {
      const { rows } = await client.query<{ peut: boolean }>(
        `select has_sequence_privilege('service_role', $1, 'USAGE')
                or has_sequence_privilege('service_role', $1, 'UPDATE') as peut`,
        [sequence],
      );
      expect(rows[0].peut, sequence).toBe(false);
    }
  });
});
