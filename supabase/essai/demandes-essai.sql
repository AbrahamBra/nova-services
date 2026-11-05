-- Données d'essai du projet de DÉVELOPPEMENT (story 1.5, AD-27).
-- Chargées uniquement par `npm run donnees:remplir` (scripts/donnees.ts), qui
-- refuse tout autre projet que celui de développement. Jamais en production.
-- Hors du chemin de seed de la CLI Supabase ([db.seed] désactivé).
--
-- Environ 40 demandes dont l'objet commence par `TEST-` :
--   - tous les statuts, priorités, canaux et états d'email ;
--   - des responsables parmi TEST-Admin et TEST-Collaborateur (retrouvés par
--     leur email, transmis par le script dans `nova.test_admin_email` et
--     `nova.test_collab_email`) ;
--   - des demandeurs « Dupont » et « Dupont-Aïdi », et 3 demandes de
--     jean.dupont@example.com ;
--   - des demandes traitées il y a plus de 2 ans, et une demande rouverte
--     puis traitée récemment ;
--   - une ligne d'historique `creation` pour chaque demande ;
--   - quelques notes internes (story 2.2), chacune avec sa ligne
--     d'historique `note_ajoutee` (sans le texte), dont une sur plusieurs
--     lignes et une avec du code (affiché tel quel).
--
-- Les références sont prises au compteur de l'année (heure de Paris), comme
-- pour une vraie demande : aucun conflit possible avec les vraies références,
-- mais chaque remplissage consomme des numéros (des trous sont normaux).
--
-- Le déclencheur des dates (`demandes_dates`) fixe `traitee_le` à « maintenant »
-- à l'insertion : il est suspendu le temps de l'insertion, pour garder les
-- dates passées (ancienneté, demandes traitées il y a plus de 2 ans). Le
-- script exécute ce fichier dans une seule transaction.

alter table public.demandes disable trigger demandes_dates;

do $$
declare
  v_admin    uuid;
  v_collab   uuid;
  r          record;
  n          record;
  v_cree_le  timestamptz;
  v_traitee  timestamptz;
  v_resp     uuid;
  v_saisie   uuid;
  v_categorie uuid;
  v_annee    integer;
  v_numero   integer;
  v_ref      text;
  v_id       uuid;
  v_nb       integer := 0;
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

  for r in
    select *
      from (values
        -- nom, email, telephone, societe, objet, categorie, canal, statut, priorite,
        -- responsable (A = TEST-Admin, C = TEST-Collaborateur), etat_email,
        -- ancienneté, délai de traitement
        ('Jean Dupont', 'jean.dupont@example.com', '06 11 22 33 44', 'Dupont Menuiserie',
         'TEST-Impression impossible depuis la mise à jour', 'Problème technique',
         'formulaire', 'nouvelle', 'haute', null, 'envoye', interval '2 hours', null::interval),
        ('Jean Dupont', 'jean.dupont@example.com', null, 'Dupont Menuiserie',
         'TEST-Devis pour deux postes neufs', 'Demande d''information',
         'formulaire', 'en_cours', 'normale', 'A', 'envoye', interval '3 days', null),
        ('Jean Dupont', 'jean.dupont@example.com', '06 11 22 33 44', 'Dupont Menuiserie',
         'TEST-Facture de septembre incomplète', 'Question administrative',
         'email', 'traitee', 'basse', 'C', 'envoye', interval '40 days', interval '2 days'),
        ('Samira Dupont-Aïdi', 'samira.dupont-aidi@example.com', null, 'Cabinet Dupont-Aïdi',
         'TEST-Messagerie inaccessible sur mobile', 'Problème technique',
         'formulaire', 'en_cours', 'haute', 'C', 'envoye', interval '1 day', null),
        ('Marie Dupont', null, '01 23 45 67 89', null,
         'TEST-Rappel pour un rendez-vous', 'Demande de rendez-vous',
         'telephone', 'nouvelle', 'normale', null, 'sans_email', interval '5 hours', null),
        ('Paul Lambert', 'paul.lambert@example.com', '06 98 76 54 32', 'Lambert Conseil',
         'TEST-Rendez-vous pour un audit du réseau', 'Demande de rendez-vous',
         'telephone', 'nouvelle', 'normale', null, 'envoye', interval '30 minutes', null),
        ('Sophie Garnier', 'sophie.garnier@example.com', '06 12 34 56 78', 'Atelier Garnier Architectes',
         'TEST-Imprimante réseau hors ligne', 'Problème technique',
         'formulaire', 'en_cours', 'haute', 'A', 'echec', interval '6 hours', null),
        ('Inès Haddad', 'ines.haddad@example.com', null, 'Boulangerie Haddad',
         'TEST-Question sur la facture d''octobre', 'Question administrative',
         'email', 'nouvelle', 'normale', null, 'envoye', interval '27 hours', null),
        ('Marc Petit', 'marc.petit@example.com', null, null,
         'TEST-Tarifs pour un site vitrine', 'Demande d''information',
         'formulaire', 'nouvelle', 'basse', null, 'non_envoye_demo', interval '32 hours', null),
        ('Julie Moreau', 'julie.moreau@example.com', '06 22 33 44 55', 'Cabinet Moreau Avocats',
         'TEST-Sauvegarde automatique en échec', 'Problème technique',
         'formulaire', 'en_cours', 'haute', 'C', 'envoye', interval '2 days', null),
        ('Thomas Roche', null, '04 72 00 11 22', 'Roche Transports',
         'TEST-Installation de 3 postes neufs', 'Autre',
         'telephone', 'en_cours', 'normale', 'A', 'sans_email', interval '53 hours', null),
        ('Léa Fontaine', 'lea.fontaine@example.com', null, null,
         'TEST-Mot de passe oublié sur le portail', 'Problème technique',
         'formulaire', 'traitee', 'normale', 'C', 'envoye', interval '4 days', interval '1 hour'),
        ('Hugo Bernard', 'hugo.bernard@example.com', '06 33 44 55 66', 'Bernard & Fils',
         'TEST-Demande de contrat de maintenance', 'Demande d''information',
         'email', 'en_cours', 'normale', 'C', 'envoye', interval '5 days', null),
        ('Camille Leroy', 'camille.leroy@example.com', null, null,
         'TEST-Changement d''adresse de facturation', 'Question administrative',
         'formulaire', 'traitee', 'basse', 'A', 'envoye', interval '6 days', interval '1 day'),
        ('Nicolas Girard', 'nicolas.girard@example.com', null, 'Girard Immobilier',
         'TEST-Wi-Fi instable dans la salle de réunion', 'Problème technique',
         'formulaire', 'nouvelle', 'haute', null, 'en_attente', interval '15 minutes', null),
        ('Emma Lefèvre', 'emma.lefevre@example.com', null, null,
         'TEST-Prise de rendez-vous pour une formation', 'Demande de rendez-vous',
         'formulaire', 'nouvelle', 'normale', null, 'non_envoye_demo', interval '7 days', null),
        ('Lucas Mercier', null, '06 44 55 66 77', 'Garage Mercier',
         'TEST-Écran bleu au démarrage', 'Problème technique',
         'telephone', 'traitee', 'haute', 'C', 'sans_email', interval '8 days', interval '4 hours'),
        ('Chloé Blanc', 'chloe.blanc@example.com', null, null,
         'TEST-Attestation pour l''assurance', 'Question administrative',
         'email', 'traitee', 'normale', 'A', 'envoye', interval '10 days', interval '2 days'),
        ('Antoine Faure', 'antoine.faure@example.com', null, 'Faure Paysages',
         'TEST-Licence logicielle expirée', 'Problème technique',
         'formulaire', 'en_cours', 'normale', 'A', 'envoye', interval '12 days', null),
        ('Manon Rousseau', 'manon.rousseau@example.com', null, null,
         'TEST-Message avec du code dans la description', 'Autre',
         'formulaire', 'nouvelle', 'basse', null, 'echec', interval '13 days', null),
        ('Gabriel André', 'gabriel.andre@example.com', null, null,
         'TEST-Renouvellement du nom de domaine', 'Demande d''information',
         'formulaire', 'traitee', 'normale', 'C', 'envoye', interval '15 days', interval '3 days'),
        ('Zoé Chevalier', null, '05 56 00 11 22', 'Chevalier Opticiens',
         'TEST-Lecteur de cartes bancaires en panne', 'Problème technique',
         'telephone', 'en_cours', 'haute', 'C', 'sans_email', interval '18 days', null),
        ('Louis Masson', 'louis.masson@example.com', null, null,
         'TEST-Rendez-vous pour un devis sur place', 'Demande de rendez-vous',
         'formulaire', 'traitee', 'normale', 'A', 'envoye', interval '21 days', interval '5 days'),
        ('Alice Robin', 'alice.robin@example.com', null, 'Robin Traiteur',
         'TEST-Question sur le prélèvement mensuel', 'Question administrative',
         'email', 'traitee', 'basse', 'C', 'envoye', interval '25 days', interval '1 day'),
        ('Arthur Gauthier', 'arthur.gauthier@example.com', null, null,
         'TEST-Migration vers une nouvelle messagerie', 'Demande d''information',
         'formulaire', 'en_cours', 'normale', 'A', 'envoye', interval '30 days', null),
        -- Rouverte puis traitée récemment (traitée de nouveau hier) :
        -- historique complet plus bas.
        ('Clara Morel', 'clara.morel@example.com', null, 'Morel Architecture',
         'TEST-Serveur de fichiers lent (rouverte)', 'Problème technique',
         'formulaire', 'traitee', 'haute', 'A', 'envoye', interval '45 days', interval '44 days'),
        ('Jules Perrin', 'jules.perrin@example.com', null, null,
         'TEST-Demande d''information sur les tarifs', 'Demande d''information',
         'formulaire', 'traitee', 'normale', 'C', 'envoye', interval '60 days', interval '2 days'),
        ('Jade Lemaire', 'jade.lemaire@example.com', null, null,
         'TEST-Ordinateur portable qui surchauffe', 'Problème technique',
         'formulaire', 'traitee', 'normale', 'A', 'echec', interval '90 days', interval '6 days'),
        ('Raphaël Clément', null, '06 55 66 77 88', null,
         'TEST-Rendez-vous annuel de bilan', 'Demande de rendez-vous',
         'telephone', 'traitee', 'basse', 'C', 'sans_email', interval '120 days', interval '10 days'),
        ('Louise Fabre', 'louise.fabre@example.com', null, 'Fabre Céramiques',
         'TEST-Correction d''un bon de commande', 'Question administrative',
         'formulaire', 'traitee', 'normale', 'A', 'envoye', interval '200 days', interval '3 days'),
        ('Adam Brunet', 'adam.brunet@example.com', null, null,
         'TEST-Imprimante qui bourre', 'Problème technique',
         'email', 'traitee', 'normale', 'C', 'envoye', interval '300 days', interval '2 days'),
        -- Traitées il y a plus de 2 ans (purge, story 5.x).
        ('Rose Picard', 'rose.picard@example.com', null, 'Picard Événements',
         'TEST-Ancienne installation du réseau', 'Autre',
         'formulaire', 'traitee', 'normale', 'A', 'envoye', interval '26 months', interval '5 days'),
        ('Victor Roux', 'victor.roux@example.com', null, null,
         'TEST-Ancien problème d''antivirus', 'Problème technique',
         'formulaire', 'traitee', 'haute', 'C', 'envoye', interval '28 months', interval '2 days'),
        ('Lina Garnier', 'lina.garnier@example.com', null, null,
         'TEST-Ancienne question de facturation', 'Question administrative',
         'email', 'traitee', 'basse', 'A', 'envoye', interval '30 months', interval '1 day'),
        ('Tom Henry', null, '03 88 00 11 22', 'Henry Électricité',
         'TEST-Ancien rendez-vous de maintenance', 'Demande de rendez-vous',
         'telephone', 'traitee', 'normale', 'C', 'sans_email', interval '34 months', interval '3 days'),
        ('Mila Lambert', 'mila.lambert@example.com', null, null,
         'TEST-Accès VPN refusé', 'Problème technique',
         'formulaire', 'nouvelle', 'haute', null, 'envoye', interval '3 hours', null),
        ('Noah Vidal', 'noah.vidal@example.com', null, 'Vidal Imprimerie',
         'TEST-Commande de cartouches d''encre', 'Autre',
         'email', 'nouvelle', 'basse', null, 'envoye', interval '9 hours', null),
        ('Eva Caron', 'eva.caron@example.com', null, null,
         'TEST-Durée de conservation des données', 'Question administrative',
         'formulaire', 'nouvelle', 'normale', null, 'en_attente', interval '1 hour', null),
        ('Ethan Marchand', null, '06 66 77 88 99', 'Marchand Bâtiment',
         'TEST-Téléphone fixe sans tonalité', 'Problème technique',
         'telephone', 'en_cours', 'haute', 'A', 'sans_email', interval '4 days', null),
        ('Anna Lucas', 'anna.lucas@example.com', null, null,
         'TEST-Catalogue des services', 'Demande d''information',
         'formulaire', 'nouvelle', 'normale', null, 'non_envoye_demo', interval '11 days', null)
      ) as t(nom, email, telephone, societe, objet, categorie, canal, statut, priorite,
             responsable, etat_email, anciennete, delai_traitement)
     -- Les plus anciennes d'abord : les numéros suivent l'ordre des dates.
     order by t.anciennete desc
  loop
    v_cree_le := now() - r.anciennete;
    v_traitee := case when r.statut = 'traitee' then v_cree_le + r.delai_traitement end;
    v_resp := case r.responsable when 'A' then v_admin when 'C' then v_collab end;
    -- Saisie interne (téléphone, email) : par le responsable, sinon TEST-Admin.
    v_saisie := case when r.canal <> 'formulaire' then coalesce(v_resp, v_admin) end;

    select c.id into v_categorie from public.categories c where c.nom = r.categorie;
    if v_categorie is null then
      raise exception 'Catégorie de départ introuvable : %', r.categorie;
    end if;

    -- Numéro suivant de l'année de la demande (heure de Paris), comme deposer_demande.
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
       consentement_le, etat_email, cree_le, traitee_le, mis_a_jour_le)
    values
      (v_ref,
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       gen_random_uuid(), r.canal, r.nom, r.email, r.telephone, r.societe, r.objet,
       case
         when r.objet like 'TEST-Message avec du code%' then
           E'Bonjour,\nle message d''erreur affiche ceci :\n<script>alert(''piège'')</script>\nMerci.'
         else
           E'Bonjour,\n' || substr(r.objet, 6) || E'.\nMerci de me recontacter.\n(Demande d''essai.)'
       end,
       v_categorie, r.statut, r.priorite, v_resp, v_saisie,
       case when r.canal = 'formulaire' then v_cree_le end,
       r.etat_email, v_cree_le, v_traitee,
       case when r.objet like '%(rouverte)' then now() - interval '1 day'
            else coalesce(v_traitee, v_cree_le) end)
    returning id into v_id;

    -- Création : par le demandeur (formulaire) ou par le membre qui a saisi.
    insert into public.historique
      (demande_id, auteur_type, auteur_id, type, nouvelle_valeur, cree_le)
    values
      (v_id,
       case when v_saisie is null then 'demandeur' else 'membre' end,
       v_saisie, 'creation', r.canal, v_cree_le);

    -- Demande rouverte puis traitée récemment.
    if r.objet like '%(rouverte)' then
      insert into public.historique
        (demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le)
      values
        -- Une prise en charge = une seule ligne (story 2.1).
        (v_id, 'membre', v_admin, 'prise_en_charge', 'nouvelle', 'en_cours',
         v_cree_le + interval '2 hours'),
        (v_id, 'membre', v_admin, 'changement_statut', 'en_cours', 'traitee',
         v_cree_le + interval '1 day'),
        (v_id, 'membre', v_admin, 'changement_statut', 'traitee', 'en_cours',
         now() - interval '10 days'),
        (v_id, 'membre', v_admin, 'changement_statut', 'en_cours', 'traitee',
         now() - interval '1 day');
    end if;

    -- Notes internes (story 2.2) : la note et sa ligne d'historique, à la
    -- même date. Jamais le texte dans l'historique (AD-19).
    for n in
      select *
        from (values
          ('TEST-Imprimante réseau hors ligne', 'A',
           'Rappelée à 9 h, intervention à distance prévue.', interval '1 hour'),
          ('TEST-Imprimante réseau hors ligne', 'C',
           E'Pilote réinstallé.\nL''imprimante répond de nouveau au ping.\nÀ confirmer avec la cliente.',
           interval '3 hours'),
          ('TEST-Sauvegarde automatique en échec', 'C',
           'Disque de sauvegarde plein : commande d''un disque de 4 To.', interval '1 day'),
          ('TEST-Serveur de fichiers lent (rouverte)', 'A',
           'Rouverte à la demande de la cliente : lenteurs revenues le matin.', interval '35 days'),
          ('TEST-Message avec du code dans la description', 'C',
           E'Le client a recopié <b>ce code</b> :\n<script>alert(''note'')</script>',
           interval '2 hours'),
          ('TEST-Facture de septembre incomplète', 'C',
           'Facture corrigée envoyée par email.', interval '1 day')
        ) as t(objet, auteur, texte, apres)
       where t.objet = r.objet
    loop
      insert into public.notes (demande_id, auteur_id, texte, cree_le)
      values (v_id,
              case n.auteur when 'A' then v_admin else v_collab end,
              n.texte, v_cree_le + n.apres);
      insert into public.historique
        (demande_id, auteur_type, auteur_id, type, cree_le)
      values
        (v_id, 'membre', case n.auteur when 'A' then v_admin else v_collab end,
         'note_ajoutee', v_cree_le + n.apres);
    end loop;

    v_nb := v_nb + 1;
  end loop;

  raise notice 'Demandes d''essai créées : %', v_nb;
end;
$$;

alter table public.demandes enable trigger demandes_dates;
