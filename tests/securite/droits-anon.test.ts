import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// Vérifie dans le catalogue PostgreSQL du projet de développement que les
// rôles `anon` et `authenticated` n'ont aucun droit en dehors de la liste
// attendue (AD-2, AD-15). Connexion directe via SUPABASE_DB_URL.

// Droits explicitement accordés par les stories, sous la forme
// « role:type:schema.objet:droit ». Vide à la story 1.1.
// Story 1.4 : mon_profil() pour le membre connecté ; les fonctions de droits
// de prive pour les règles RLS (sans accès au schéma prive lui-même).
// Story 1.5 : lecture de la vue demandes_liste et droits PAR COLONNE
// (« role:colonne:schema.table.colonne:droit ») : jamais jeton_confirmation
// ni cle_envoi ; sur membres, ni email ni rôle.
// Story 1.6 : lecture de l'historique, colonne par colonne (codes et
// identifiants seulement).
// Story 1.7 : journal et noter_resultat_email, aucun droit (rien à ajouter).
// Story 1.8 : envois_formulaire et nouvelle signature de deposer_demande,
// aucun droit (rien à ajouter).
// Story 1.9 : tentatives_connexion, commencer_connexion, terminer_connexion
// et les utilitaires prive de comptage, aucun droit (rien à ajouter).
// Story 2.1 : prendre_en_charge pour le membre connecté (la fonction vérifie
// elle-même qu'il est actif) ; rien pour anon.
// Story 2.2 : ajouter_note pour le membre connecté, et lecture de `notes`
// colonne par colonne (aucune écriture directe) ; rien pour anon.
// Story 2.3 : changer_statut et classer_sans_suite pour le membre connecté ;
// rien pour anon.
// Story 2.4 : changer_priorite et changer_categorie pour le membre connecté,
// et lecture de `categories.ordre` ; rien pour anon.
// Story 2.5 : rechercher_demandes et ids_demandes_recherche pour le membre
// connecté (rien pour un compte qui n'est pas membre actif ; migration 0019) ; la colonne
// `demandes.recherche` et prive.normaliser restent sans aucun droit ; rien
// pour anon.
// Story 2.6 : saisir_demande pour le membre connecté (la fonction vérifie
// elle-même qu'il est actif) ; rien pour anon.
// Story 2.7 : liberer et attribuer pour le membre connecté (les fonctions
// vérifient elles-mêmes le membre actif, l'administrateur pour attribuer) ;
// rien pour anon.
// Story 4.1 : lister_comptes (la fonction vérifie l'administrateur actif),
// mon_invitation et activer_mon_compte (sur auth.uid() seulement) pour
// authenticated ; creer_membre (nouvelle signature) reste réservée à
// service_role ; rien pour anon.
// Story 4.2 : modifier_membre, desactiver_membre, reactiver_membre pour
// authenticated (les fonctions vérifient l'administrateur actif) ; rien pour
// anon.
// Story 3.4 : table effacements et rejouer_effacements, aucun droit (rien à
// ajouter : service_role seulement).
// Story 4.3 : noter_lien_mot_de_passe pour authenticated (la fonction
// vérifie l'administrateur actif) ; demandes_reinitialisation et
// demander_reinitialisation, aucun droit ; rien pour anon.
// Story 4.4 : noter_renvoi_invitation et annuler_invitation pour
// authenticated (les fonctions vérifient l'administrateur actif) ; rien pour
// anon.
// Story 5.1 : lire_journal pour authenticated (la fonction vérifie
// l'administrateur actif) ; le journal lui-même reste sans aucun droit ; rien
// pour anon.
// Story 5.2 : lister_categories_admin, ajouter_categorie, renommer_categorie,
// desactiver_categorie et activer_categorie pour authenticated (les fonctions
// vérifient l'administrateur actif) ; prive.verifier_nom_categorie sans aucun
// droit ; rien pour anon.
// Story 5.3 : lire_parametres_admin et modifier_parametres pour authenticated
// (les fonctions vérifient l'administrateur actif) ; rien pour anon.
const COLONNES_DEMANDES = [
  "id", "reference", "canal", "nom", "email", "telephone", "societe", "objet", "description",
  "categorie_id", "statut", "priorite", "responsable_id", "saisie_par_id",
  "consentement_le", "etat_email", "cree_le", "traitee_le", "mis_a_jour_le",
];
const COLONNES_HISTORIQUE = [
  "id", "demande_id", "auteur_type", "auteur_id", "type", "ancienne_valeur", "nouvelle_valeur",
  "cree_le",
];
const COLONNES_NOTES = ["id", "demande_id", "auteur_id", "texte", "cree_le"];
const DROITS_ATTENDUS: string[] = [
  "authenticated:fonction:prive.est_admin():EXECUTE",
  "authenticated:fonction:prive.est_membre_actif():EXECUTE",
  "authenticated:fonction:public.activer_mon_compte():EXECUTE",
  "authenticated:fonction:public.activer_categorie(p_id uuid):EXECUTE",
  "authenticated:fonction:public.ajouter_categorie(p_nom text):EXECUTE",
  "authenticated:fonction:public.desactiver_categorie(p_id uuid):EXECUTE",
  "authenticated:fonction:public.lister_categories_admin():EXECUTE",
  "authenticated:fonction:public.renommer_categorie(p_id uuid, p_nom text):EXECUTE",
  "authenticated:fonction:public.lire_parametres_admin():EXECUTE",
  "authenticated:fonction:public.modifier_parametres(p_nom_affiche text, p_email_contact text, p_duree_mois integer):EXECUTE",
  "authenticated:fonction:public.ajouter_note(p_demande_id uuid, p_texte text):EXECUTE",
  "authenticated:fonction:public.annuler_invitation(p_id uuid):EXECUTE",
  "authenticated:fonction:public.attribuer(p_demande_id uuid, p_membre_id uuid):EXECUTE",
  "authenticated:fonction:public.changer_categorie(p_demande_id uuid, p_categorie_id uuid):EXECUTE",
  "authenticated:fonction:public.changer_priorite(p_demande_id uuid, p_priorite text):EXECUTE",
  "authenticated:fonction:public.changer_statut(p_demande_id uuid, p_statut text):EXECUTE",
  "authenticated:fonction:public.classer_sans_suite(p_demande_id uuid, p_note text):EXECUTE",
  "authenticated:fonction:public.lister_comptes():EXECUTE",
  "authenticated:fonction:public.modifier_membre(p_id uuid, p_nom text, p_role text):EXECUTE",
  "authenticated:fonction:public.desactiver_membre(p_id uuid):EXECUTE",
  "authenticated:fonction:public.reactiver_membre(p_id uuid):EXECUTE",
  "authenticated:fonction:public.mon_invitation():EXECUTE",
  "authenticated:fonction:public.mon_profil():EXECUTE",
  "authenticated:fonction:public.noter_lien_mot_de_passe(p_id uuid):EXECUTE",
  "authenticated:fonction:public.noter_renvoi_invitation(p_id uuid):EXECUTE",
  "authenticated:fonction:public.ids_demandes_recherche(p_texte text):EXECUTE",
  "authenticated:fonction:public.liberer(p_demande_id uuid):EXECUTE",
  "authenticated:fonction:public.lire_journal(p_type text, p_page integer):EXECUTE",
  "authenticated:fonction:public.prendre_en_charge(p_demande_id uuid):EXECUTE",
  "authenticated:fonction:public.rechercher_demandes(p_texte text):EXECUTE",
  "authenticated:fonction:public.saisir_demande(p_cle_envoi uuid, p_canal text, p_nom text, p_email text, p_telephone text, p_societe text, p_categorie_id uuid, p_objet text, p_description text):EXECUTE",
  "authenticated:table:public.demandes_liste:SELECT",
  ...COLONNES_DEMANDES.map((c) => `authenticated:colonne:public.demandes.${c}:SELECT`),
  ...["id", "nom", "etat"].map((c) => `authenticated:colonne:public.membres.${c}:SELECT`),
  // Story 2.4 : `ordre` (liste « Catégorie » du détail, dans l'ordre des formulaires).
  ...["id", "nom", "actif", "ordre"].map((c) => `authenticated:colonne:public.categories.${c}:SELECT`),
  ...COLONNES_HISTORIQUE.map((c) => `authenticated:colonne:public.historique.${c}:SELECT`),
  ...COLONNES_NOTES.map((c) => `authenticated:colonne:public.notes.${c}:SELECT`),
].sort();

const ROLES = ["anon", "authenticated"];

let client: Client;

beforeAll(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL manquant : renseignez l'adresse de connexion du projet de développement dans .env.local.",
    );
  }
  client = new Client({ connectionString: url });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

async function droitsAccordes(): Promise<string[]> {
  const { rows } = await client.query<{ droit: string }>(
    `
    with roles(rolname) as (select unnest($1::text[]))
    -- Tables, vues, vues matérialisées, tables étrangères et partitionnées
    select r.rolname || ':table:' || n.nspname || '.' || c.relname || ':' || p.priv as droit
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join roles r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
    where n.nspname in ('public', 'prive')
      and c.relkind in ('r', 'v', 'm', 'f', 'p')
      and has_table_privilege(r.rolname, c.oid, p.priv)
    union all
    -- Colonnes (droits accordés colonne par colonne, sans droit sur la table)
    select r.rolname || ':colonne:' || n.nspname || '.' || c.relname || '.' || a.attname || ':' || p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join roles r
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p(priv)
    where n.nspname in ('public', 'prive')
      and c.relkind in ('r', 'v', 'm', 'f', 'p')
      and has_column_privilege(r.rolname, c.oid, a.attnum, p.priv)
      and not has_table_privilege(r.rolname, c.oid, p.priv)
    union all
    -- Séquences
    select r.rolname || ':sequence:' || n.nspname || '.' || c.relname || ':' || p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join roles r
    cross join unnest(array['USAGE','SELECT','UPDATE']) p(priv)
    where n.nspname in ('public', 'prive')
      and c.relkind = 'S'
      and has_sequence_privilege(r.rolname, c.oid, p.priv)
    union all
    -- Fonctions et procédures
    select r.rolname || ':fonction:' || n.nspname || '.' || f.proname
           || '(' || pg_get_function_identity_arguments(f.oid) || '):EXECUTE'
    from pg_proc f
    join pg_namespace n on n.oid = f.pronamespace
    cross join roles r
    where n.nspname in ('public', 'prive')
      and has_function_privilege(r.rolname, f.oid, 'EXECUTE')
    union all
    -- Schéma prive : aucun accès
    select r.rolname || ':schema:prive:' || p.priv
    from pg_namespace n
    cross join roles r
    cross join unnest(array['USAGE','CREATE']) p(priv)
    where n.nspname = 'prive'
      and has_schema_privilege(r.rolname, n.oid, p.priv)
    order by 1
    `,
    [ROLES],
  );
  return rows.map((ligne) => ligne.droit);
}

describe("sécurité — droits de anon et authenticated", () => {
  it("le schéma prive existe (migration appliquée)", async () => {
    const { rowCount } = await client.query(
      "select 1 from pg_namespace where nspname = 'prive'",
    );
    expect(rowCount).toBe(1);
  });

  it("aucun droit sur public ni prive en dehors de la liste attendue", async () => {
    expect((await droitsAccordes()).sort()).toEqual(DROITS_ATTENDUS);
  });

  it("un objet créé après la migration ne donne aucun droit (droits par défaut retirés)", async () => {
    // Création dans une transaction annulée : rien ne reste en base.
    await client.query("begin");
    try {
      await client.query(
        "create table public.test_verrou_droits (id bigint generated always as identity primary key)",
      );
      await client.query(
        "create function public.test_verrou_droits_f() returns int language sql as 'select 1'",
      );
      await client.query("create table prive.test_verrou_droits (id int)");
      await client.query(
        "create function prive.test_verrou_droits_f() returns int language sql as 'select 1'",
      );
      expect((await droitsAccordes()).sort()).toEqual(DROITS_ATTENDUS);
    } finally {
      await client.query("rollback");
    }
  });
});
