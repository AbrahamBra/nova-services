-- Story 2.6 — Saisir une demande reçue par téléphone ou par email (FR-25 ;
-- AD-4, AD-6, AD-13, AD-15, AD-26).
--
-- `saisir_demande(...)` : un membre actif enregistre une demande reçue par
-- téléphone ou par email, en un seul bloc :
--   - membre actif vérifié en première instruction (`DROIT_INSUFFISANT`) ;
--   - idempotente par `cle_envoi` : un second envoi (double clic) renvoie la
--     demande déjà créée, sans nouvelle référence (AD-26) ;
--   - mêmes règles de champs que `deposer_demande` (espaces de début et de
--     fin retirés, longueurs, catégorie active, email bien formé), avec ces
--     différences : canal `telephone` ou `email` obligatoire (sinon
--     `DONNEES_INVALIDES`) ; email facultatif, mais au moins un email ou un
--     téléphone (`COORDONNEES_REQUISES`) ; pas de consentement ;
--   - MÊME compteur de références que le dépôt public (`compteurs_reference`,
--     ligne de l'année verrouillée par l'upsert, AD-6) ;
--   - `saisie_par_id` = le membre ; `etat_email` = `sans_email` sans email,
--     `en_attente` sinon (l'action envoie l'email puis note le résultat avec
--     `noter_resultat_email`, AD-13) ;
--   - une ligne d'historique `creation`, auteur le membre, nouvelle valeur =
--     le canal (« Saisie par Nadia Morel (téléphone) ») ;
--   - renvoie la référence et les données de l'email, comme `deposer_demande`
--     (sans le jeton de confirmation, inutile ici).
-- Pas d'empreinte d'IP ni de limite d'envois : la saisie est réservée aux
-- membres connectés (pas d'anti-spam).
--
-- Erreurs prévues (P0001) :
--   DROIT_INSUFFISANT     pas un membre actif ;
--   DONNEES_INVALIDES     canal absent ou hors liste, champ vide, trop long ou
--                         email mal formé ;
--   COORDONNEES_REQUISES  ni email ni téléphone ;
--   CATEGORIE_INVALIDE    catégorie inconnue ou désactivée.
--
-- `mis_a_jour_le` et `traitee_le` sont écrites par le déclencheur
-- `demandes_dates` (AD-22). EXECUTE à `authenticated` seulement.

create function public.saisir_demande(
  p_cle_envoi     uuid,
  p_canal         text,
  p_nom           text,
  p_email         text,
  p_telephone     text,
  p_societe       text,
  p_categorie_id  uuid,
  p_objet         text,
  p_description   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre      uuid := auth.uid();
  -- Espaces retirés en début et fin (comme le trim de Zod pour l'ASCII).
  v_blancs      constant text := E' \t\n\r\f\v';
  v_nom         text := btrim(p_nom, v_blancs);
  v_email       text := nullif(lower(btrim(p_email, v_blancs)), '');
  v_telephone   text := nullif(btrim(p_telephone, v_blancs), '');
  v_societe     text := nullif(btrim(p_societe, v_blancs), '');
  v_objet       text := btrim(p_objet, v_blancs);
  v_description text := btrim(p_description, v_blancs);
  v_existante   jsonb;
  v_annee       integer;
  v_numero      integer;
  v_reference   text;
  v_jeton       text;
  v_id          uuid;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  -- Second envoi avec la même clé : la demande déjà créée, avec l'état de son
  -- email (l'action renvoie l'email s'il est encore `en_attente`).
  select jsonb_build_object(
           'reference', d.reference, 'id', d.id,
           'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
           'email_contact', p.email_contact, 'nouvelle', false,
           'etat_email', d.etat_email)
    into v_existante
    from public.demandes d
    left join public.parametres p on true
   where d.cle_envoi = p_cle_envoi;
  if v_existante is not null then
    return v_existante;
  end if;

  if p_cle_envoi is null
     or p_canal is null or p_canal not in ('telephone', 'email')
     or v_nom is null or char_length(v_nom) not between 1 and 150
     or (v_email is not null and (
           char_length(v_email) not between 3 and 254
           or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     or (v_telephone is not null and char_length(v_telephone) > 30)
     or (v_societe is not null and char_length(v_societe) > 150)
     or v_objet is null or char_length(v_objet) not between 1 and 150
     or v_description is null or char_length(v_description) not between 1 and 5000
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if v_email is null and v_telephone is null then
    raise exception using errcode = 'P0001', message = 'COORDONNEES_REQUISES';
  end if;

  if p_categorie_id is null or not exists (
    select 1 from public.categories c where c.id = p_categorie_id and c.actif
  ) then
    raise exception using errcode = 'P0001', message = 'CATEGORIE_INVALIDE';
  end if;

  begin
    -- Même compteur que le dépôt public (AD-6). L'upsert verrouille la ligne
    -- de l'année (heure de Paris) jusqu'à la fin de la transaction : un dépôt
    -- et une saisie simultanés reçoivent deux numéros consécutifs.
    v_annee := extract(year from (now() at time zone 'Europe/Paris'))::integer;

    insert into public.compteurs_reference as c (annee, dernier_numero)
    values (v_annee, 1)
    on conflict (annee) do update
      set dernier_numero = c.dernier_numero + 1
    returning c.dernier_numero into v_numero;

    -- 4 chiffres minimum, davantage au-delà de 9 999.
    v_reference := 'NOVA-' || v_annee::text || '-'
                   || lpad(v_numero::text, greatest(4, char_length(v_numero::text)), '0');

    -- Colonne obligatoire : 256 bits aléatoires, jamais renvoyés par la saisie.
    v_jeton := replace(gen_random_uuid()::text, '-', '')
               || replace(gen_random_uuid()::text, '-', '');

    insert into public.demandes
      (reference, jeton_confirmation, cle_envoi, canal, nom, email, telephone, societe,
       objet, description, categorie_id, saisie_par_id, etat_email)
    values
      (v_reference, v_jeton, p_cle_envoi, p_canal, v_nom, v_email, v_telephone,
       v_societe, v_objet, v_description, p_categorie_id, v_membre,
       case when v_email is null then 'sans_email' else 'en_attente' end)
    returning id into v_id;

    perform prive.ecrire_historique(v_id, 'creation', v_membre, null, p_canal);
  exception
    when unique_violation then
      -- Même clé envoyée en même temps par un autre appel : le compteur est
      -- annulé avec ce bloc, on renvoie la demande créée par l'autre appel
      -- (qui, lui, envoie l'email).
      select jsonb_build_object(
               'reference', d.reference, 'id', d.id,
               'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
               'email_contact', p.email_contact, 'nouvelle', false,
               'etat_email', d.etat_email)
        into v_existante
        from public.demandes d
        left join public.parametres p on true
       where d.cle_envoi = p_cle_envoi;
      if v_existante is null then
        raise;
      end if;
      return v_existante;
  end;

  return (
    select jsonb_build_object(
             'reference', d.reference, 'id', d.id,
             'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
             'email_contact', p.email_contact, 'nouvelle', true,
             'etat_email', d.etat_email)
      from public.demandes d
      left join public.parametres p on true
     where d.id = v_id
  );
end;
$$;

comment on function public.saisir_demande(uuid, text, text, text, text, text, uuid, text, text) is
  'Saisie interne d''une demande reçue par téléphone ou par email (story 2.6). Idempotente par cle_envoi, même compteur de références que le dépôt public. EXECUTE réservé à authenticated.';

revoke all on function public.saisir_demande(uuid, text, text, text, text, text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.saisir_demande(uuid, text, text, text, text, text, uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
