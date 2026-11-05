-- Story 2.6 (corrections après relecture) — `saisir_demande`, même
-- signature, mêmes droits :
--   - un second envoi ne renvoie que la demande saisie par le même membre
--     avec cette `cle_envoi` : la clé d'un dépôt public ou d'un autre membre
--     n'est jamais renvoyée (l'insertion échoue sur la clé unique, erreur
--     inattendue) ;
--   - la réponse contient l'adresse email ENREGISTRÉE (`email`), pour que
--     l'action renvoie l'email à cette adresse lors d'un second envoi, quel
--     que soit le contenu du formulaire rejoué ;
--   - commentaire corrigé : en cas d'envois simultanés, les deux appels
--     envoient l'email ; la clé d'idempotence de Resend n'en garde qu'un.

create or replace function public.saisir_demande(
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

  -- Second envoi avec la même clé PAR LE MÊME MEMBRE : la demande déjà créée,
  -- avec l'adresse enregistrée et l'état de son email (l'action renvoie
  -- l'email s'il est encore `en_attente`). Une clé d'une autre demande
  -- (dépôt public, autre membre) n'est jamais renvoyée.
  select jsonb_build_object(
           'reference', d.reference, 'id', d.id,
           'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
           'email_contact', p.email_contact, 'nouvelle', false,
           'etat_email', d.etat_email, 'email', d.email)
    into v_existante
    from public.demandes d
    left join public.parametres p on true
   where d.cle_envoi = p_cle_envoi
     and d.saisie_par_id = v_membre;
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
      -- Même clé envoyée en même temps par un autre appel du même membre :
      -- le compteur est annulé avec ce bloc, on renvoie la demande créée par
      -- l'autre appel. Les deux appels envoient l'email s'il est encore
      -- `en_attente` ; la clé d'idempotence de Resend n'en garde qu'un.
      -- Clé déjà utilisée par une autre demande (dépôt public ou autre
      -- membre) : rien n'est trouvé, l'erreur est relevée telle quelle.
      select jsonb_build_object(
               'reference', d.reference, 'id', d.id,
               'objet', d.objet, 'cree_le', d.cree_le, 'nom_affiche', p.nom_affiche,
               'email_contact', p.email_contact, 'nouvelle', false,
               'etat_email', d.etat_email, 'email', d.email)
        into v_existante
        from public.demandes d
        left join public.parametres p on true
       where d.cle_envoi = p_cle_envoi
     and d.saisie_par_id = v_membre;
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
             'etat_email', d.etat_email, 'email', d.email)
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
