// Charge de la liste (story 2.5, NFR-7) sur le projet de DÉVELOPPEMENT.
//   npm run donnees:charge             crée 2 000 demandes fictives dont l'objet
//                                      commence par « TEST-charge- » (remplace
//                                      une charge précédente)
//   npm run donnees:charge -- --vider  efface ces demandes (historique en cascade)
// Refusé hors du projet de développement (SUPABASE_ENVIRONNEMENT, voir
// scripts/charger-environnement.mjs) : jamais en production.
//
// À savoir :
//   - jamais dans la CI : 2 000 lignes de plus dans la base partagée
//     fausseraient les tests de pagination. Effacer la charge après la mesure
//     (`npm run mesure:liste`) ;
//   - chaque chargement consomme 2 000 vrais numéros de référence (compteur
//     de l'année) : des trous dans la numérotation sont normaux ;
//   - `npm run donnees:vider` efface aussi cette charge (objet « TEST-… »).
// Responsables : TEST-Admin et TEST-Collaborateur (npm run comptes:test),
// retrouvés par leur email (.env.local). Connexion directe à la base
// (SUPABASE_DB_URL), dans une seule transaction : la clé secrète n'a aucun
// droit direct sur les tables (migration 0004).

import pg from "pg";
import { FORMAT_EMAIL, preparerEnvironnement } from "./commun.ts";

const NOMBRE = 2000;
const OPTION_VIDER = "--vider";

const args = process.argv.slice(2);
const inconnue = args.find((arg) => arg !== OPTION_VIDER);
if (inconnue) {
  console.error(`Option « ${inconnue} » non reconnue. Usage : npm run donnees:charge [-- --vider]`);
  process.exit(1);
}
const vider = args.includes(OPTION_VIDER);

preparerEnvironnement("donnees:charge");

// Seulement la charge : jamais les autres demandes d'essai ou de test.
const VIDER_CHARGE = `delete from public.demandes where objet like 'TEST-charge-%'`;

function emailDuCompte(variable: string, parDefaut: string): string {
  const email = (process.env[variable] || parDefaut).trim().toLowerCase();
  if (!FORMAT_EMAIL.test(email)) {
    throw new Error(`${variable} ne semble pas valide dans .env.local.`);
  }
  return email;
}

// Une demande toutes les 3 heures en remontant le temps (environ 250 jours) :
// noms avec et sans accents, tous les statuts, priorités, canaux, catégories
// actives, avec ou sans responsable.
const CHARGER = `
do $$
declare
  v_nombre    constant integer := ${NOMBRE};
  v_prenoms   constant text[] := array['Jean', 'Samira', 'Sophie', 'Karim', 'Inès', 'Paul',
                                       'Julie', 'Marc', 'Nadia', 'Léo', 'Chloé', 'François'];
  v_noms      constant text[] := array['Dupont', 'Dupont-Aïdi', 'Garnier', 'Lefèvre', 'Haddad',
                                       'Martin', 'Moreau', 'Petit', 'Bernard', 'Nguyen',
                                       'Müller', 'Benali', 'Roux', 'Lambert'];
  v_societes  constant text[] := array['Atelier Garnier', 'Boulangerie Haddad', 'Cabinet Moreau',
                                       'Menuiserie Lefèvre', 'Lambert Conseil', 'Œuvres & Cie'];
  v_sujets    constant text[] := array['Impression impossible', 'Messagerie inaccessible',
                                       'Question sur la facture', 'Rendez-vous pour un audit',
                                       'Devis pour deux postes', 'Wi-Fi instable',
                                       'Sauvegarde en échec', 'Mot de passe oublié',
                                       'Licence expirée', 'Écran bleu au démarrage'];
  v_categories uuid[];
  v_admin     uuid;
  v_collab    uuid;
  v_cree_le   timestamptz;
  v_statut    text;
  v_canal     text;
  v_resp      uuid;
  v_email     text;
  v_prenom    text;
  v_nom       text;
  v_annee     integer;
  v_numero    integer;
  v_ref       text;
  v_id        uuid;
begin
  select m.id into v_admin
    from public.membres m
   where m.email = lower(btrim(coalesce(current_setting('nova.test_admin_email', true), '')))
     and m.etat = 'actif';
  select m.id into v_collab
    from public.membres m
   where m.email = lower(btrim(coalesce(current_setting('nova.test_collab_email', true), '')))
     and m.etat = 'actif';
  if v_admin is null or v_collab is null then
    raise exception 'Comptes TEST-Admin ou TEST-Collaborateur introuvables (ou inactifs) : lancez npm run comptes:test.';
  end if;

  select array_agg(c.id order by c.ordre, c.nom) into v_categories
    from public.categories c
   where c.actif;
  if v_categories is null then
    raise exception 'Aucune catégorie active.';
  end if;

  -- Des plus anciennes aux plus récentes : les numéros suivent les dates.
  for i in reverse v_nombre..1 loop
    v_cree_le := now() - make_interval(hours => 3 * i);
    v_statut := (array['nouvelle', 'en_cours', 'traitee'])[1 + i % 3];
    v_canal := (array['formulaire', 'formulaire', 'telephone', 'email'])[1 + i % 4];
    v_resp := case
                when v_statut = 'nouvelle' then null
                when i % 2 = 0 then v_admin
                else v_collab
              end;
    v_prenom := v_prenoms[1 + i % array_length(v_prenoms, 1)];
    v_nom := v_noms[1 + (i / 3) % array_length(v_noms, 1)];
    v_email := case
                 when v_canal = 'telephone' and i % 8 = 2 then null
                 else lower(v_prenom || '.' || replace(v_nom, '-', '') || i || '@example.com')
               end;

    v_annee := extract(year from (v_cree_le at time zone 'Europe/Paris'))::integer;
    insert into public.compteurs_reference as c (annee, dernier_numero)
    values (v_annee, 1)
    on conflict (annee) do update set dernier_numero = c.dernier_numero + 1
    returning c.dernier_numero into v_numero;
    v_ref := 'NOVA-' || v_annee::text || '-'
             || lpad(v_numero::text, greatest(4, char_length(v_numero::text)), '0');

    insert into public.demandes
      (reference, jeton_confirmation, cle_envoi, canal, nom, email, telephone, societe,
       objet, description, categorie_id, statut, priorite, responsable_id, saisie_par_id,
       consentement_le, etat_email, cree_le)
    values
      (v_ref,
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       gen_random_uuid(), v_canal, v_prenom || ' ' || v_nom, v_email,
       case when v_canal = 'telephone' then '06 00 00 ' || lpad((i % 100)::text, 2, '0') || ' 00' end,
       case when i % 3 <> 0 then v_societes[1 + i % array_length(v_societes, 1)] end,
       'TEST-charge-' || lpad(i::text, 4, '0') || ' ' || v_sujets[1 + i % array_length(v_sujets, 1)],
       E'Demande fictive de charge (story 2.5).',
       v_categories[1 + i % array_length(v_categories, 1)],
       v_statut,
       (array['haute', 'normale', 'normale', 'normale', 'basse'])[1 + i % 5],
       v_resp,
       case when v_canal <> 'formulaire' then coalesce(v_resp, v_admin) end,
       case when v_canal = 'formulaire' then v_cree_le end,
       case when v_email is null then 'sans_email' else 'envoye' end,
       v_cree_le)
    returning id into v_id;

    insert into public.historique (demande_id, auteur_type, auteur_id, type, nouvelle_valeur, cree_le)
    values (v_id,
            case when v_canal = 'formulaire' then 'demandeur' else 'membre' end,
            case when v_canal <> 'formulaire' then coalesce(v_resp, v_admin) end,
            'creation', v_canal, v_cree_le);
  end loop;
end;
$$;
`;

async function principal() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL manquant dans .env.local.");

  const base = new pg.Client({ connectionString: url });
  await base.connect();
  try {
    await base.query("begin");
    const { rowCount } = await base.query(VIDER_CHARGE);
    if (vider) {
      await base.query("commit");
      console.log(`Demandes de charge effacées : ${rowCount ?? 0}.`);
      return;
    }
    if (rowCount) console.log(`Ancienne charge remplacée : ${rowCount} demandes.`);

    await base.query("select set_config('nova.test_admin_email', $1, true)", [
      emailDuCompte("TEST_ADMIN_EMAIL", "test-admin@example.com"),
    ]);
    await base.query("select set_config('nova.test_collab_email', $1, true)", [
      emailDuCompte("TEST_COLLAB_EMAIL", "test-collaborateur@example.com"),
    ]);

    const debut = performance.now();
    await base.query(CHARGER);
    await base.query("commit");
    // Statistiques à jour pour le planificateur après un ajout massif.
    await base.query("analyze public.demandes");
    console.log(
      `${NOMBRE} demandes de charge créées (objet « TEST-charge-… ») en ${Math.round(performance.now() - debut)} ms.`,
    );
    console.log("Mesure : npm run mesure:liste ; puis effacement : npm run donnees:charge -- --vider");
  } catch (erreur) {
    await base.query("rollback").catch(() => {});
    throw erreur;
  } finally {
    await base.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : "Erreur inattendue.");
  process.exit(1);
});
