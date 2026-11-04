-- Story 1.9 (correctifs après relecture) — blocage de la connexion.
--
-- 1. Domaine IP : une réussite depuis une IP n'efface que les échecs
--    antérieurs AVEC LE MÊME EMAIL (décision d'Abraham). Les échecs sur
--    d'autres emails depuis cette IP continuent de compter (fenêtre de
--    15 minutes) : un compte valide ne permet plus d'essayer 4 emails, se
--    connecter, et recommencer sans fin. Le domaine email ne change pas.
-- 2. Durée fixe : le blocage dure 15 minutes à partir de l'échec qui l'a
--    déclenché (colonnes `bloque_email_le` / `bloque_ip_le`), et non plus
--    jusqu'à ce que le plus ancien des 5 échecs ait 15 minutes. Ensuite, une
--    nouvelle série de 5 échecs (postérieurs au déclenchement) bloque à
--    nouveau et écrit une nouvelle ligne de journal : une ligne par épisode.
-- 3. Erreur serveur : `terminer_connexion(id, null)` supprime la tentative
--    en cours, qui ne compte pas (une panne d'Auth ne bloque pas l'équipe).
--
-- Les colonnes `bloque_email` / `bloque_ip` (0012) restent renseignées mais
-- ne servent plus ; elles seront retirées à une version suivante (AD-10).

-- 1. Heure du déclenchement ------------------------------------------------

alter table public.tentatives_connexion
  add column bloque_email_le timestamptz,
  add column bloque_ip_le    timestamptz;

update public.tentatives_connexion t
   set bloque_email_le = case when t.bloque_email then t.cree_le end,
       bloque_ip_le    = case when t.bloque_ip then t.cree_le end
 where t.bloque_email or t.bloque_ip;

create index tentatives_connexion_ip_email_idx
  on public.tentatives_connexion (empreinte_ip, empreinte_email, cree_le);

-- 2. Échecs de suite ------------------------------------------------------
-- Échecs (tentatives non réussies, en cours comprises) des 15 dernières
-- minutes, postérieurs au dernier déclenchement de blocage du domaine, et :
--   - email : postérieurs à la dernière réussite de cet email ;
--   - IP : sans réussite ultérieure depuis cette IP avec le même email.

create or replace function prive.echecs_de_suite(p_domaine text, p_empreinte text)
returns integer
language sql
stable
set search_path = ''
as $$
  select case p_domaine
    when 'email' then (
      select count(*)::integer
        from public.tentatives_connexion t
       where t.empreinte_email = p_empreinte
         and t.reussie is distinct from true
         and t.cree_le > now() - interval '15 minutes'
         and t.cree_le > coalesce((select max(r.cree_le)
                                     from public.tentatives_connexion r
                                    where r.empreinte_email = p_empreinte and r.reussie),
                                  '-infinity'::timestamptz)
         and t.cree_le > coalesce((select max(b.bloque_email_le)
                                     from public.tentatives_connexion b
                                    where b.empreinte_email = p_empreinte),
                                  '-infinity'::timestamptz))
    when 'ip' then (
      select count(*)::integer
        from public.tentatives_connexion t
       where t.empreinte_ip = p_empreinte
         and t.reussie is distinct from true
         and t.cree_le > now() - interval '15 minutes'
         and not exists (select 1
                           from public.tentatives_connexion r
                          where r.empreinte_ip = p_empreinte
                            and r.empreinte_email = t.empreinte_email
                            and r.reussie
                            and r.cree_le > t.cree_le)
         and t.cree_le > coalesce((select max(b.bloque_ip_le)
                                     from public.tentatives_connexion b
                                    where b.empreinte_ip = p_empreinte),
                                  '-infinity'::timestamptz))
    else 0
  end;
$$;

-- 3. Blocage en cours -----------------------------------------------------
-- Vrai si un déclenchement de moins de 15 minutes existe pour cette
-- empreinte, sans réussite qui compte après lui (même règle que ci-dessus).

create function prive.blocage_actif(p_domaine text, p_empreinte text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_domaine
    when 'email' then exists (
      select 1
        from public.tentatives_connexion b
       where b.empreinte_email = p_empreinte
         and b.bloque_email_le > now() - interval '15 minutes'
         and not exists (select 1
                           from public.tentatives_connexion r
                          where r.empreinte_email = p_empreinte
                            and r.reussie
                            and r.cree_le > b.cree_le))
    when 'ip' then exists (
      select 1
        from public.tentatives_connexion b
       where b.empreinte_ip = p_empreinte
         and b.bloque_ip_le > now() - interval '15 minutes'
         and not exists (select 1
                           from public.tentatives_connexion r
                          where r.empreinte_ip = p_empreinte
                            and r.empreinte_email = b.empreinte_email
                            and r.reussie
                            and r.cree_le > b.cree_le))
    else false
  end;
$$;

revoke all on function prive.blocage_actif(text, text)
  from public, anon, authenticated, service_role;

-- Remplacée par blocage_actif (plus aucun appel après cette migration).
drop function prive.blocage_deja_note(text, text);

-- 4. Début d'une tentative ------------------------------------------------
-- `create or replace` garde les droits : EXECUTE à service_role seul.

create or replace function public.commencer_connexion(
  p_empreinte_email text,
  p_empreinte_ip    text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limite       constant integer  := 5;
  c_conservation constant interval := interval '1 day';
  v_id           bigint;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  if p_empreinte_email is null or p_empreinte_email !~ '^[0-9a-f]{64}$'
     or p_empreinte_ip is null or p_empreinte_ip !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  perform prive.verrouiller_tentatives(p_empreinte_email, p_empreinte_ip);

  -- Blocage en cours (15 minutes depuis son déclenchement), ou 5 échecs déjà
  -- comptés (tentatives en cours comprises) pas encore notés.
  if prive.blocage_actif('email', p_empreinte_email)
     or prive.blocage_actif('ip', p_empreinte_ip)
     or prive.echecs_de_suite('email', p_empreinte_email) >= c_limite
     or prive.echecs_de_suite('ip', p_empreinte_ip) >= c_limite
  then
    raise exception using errcode = 'P0001', message = 'CONNEXION_BLOQUEE';
  end if;

  insert into public.tentatives_connexion (empreinte_email, empreinte_ip)
  values (p_empreinte_email, p_empreinte_ip)
  returning id into v_id;

  delete from public.tentatives_connexion t
   where t.cree_le < now() - c_conservation;

  return v_id;
end;
$$;

-- 5. Fin d'une tentative --------------------------------------------------
-- p_reussie : true (réussite), false (échec), null (erreur serveur : la
-- tentative est supprimée et ne compte pas).

create or replace function public.terminer_connexion(
  p_id      bigint,
  p_reussie boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limite        constant integer := 5;
  v_email         text;
  v_ip            text;
  v_echecs_email  integer;
  v_echecs_ip     integer;
  v_bloque_email  boolean;
  v_bloque_ip     boolean;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  if p_id is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select t.empreinte_email, t.empreinte_ip
    into v_email, v_ip
    from public.tentatives_connexion t
   where t.id = p_id;
  if v_email is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  perform prive.verrouiller_tentatives(v_email, v_ip);

  if p_reussie is null then
    delete from public.tentatives_connexion t
     where t.id = p_id
       and t.reussie is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
    end if;
    return jsonb_build_object('bloquee', false);
  end if;

  update public.tentatives_connexion t
     set reussie = p_reussie
   where t.id = p_id
     and t.reussie is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if p_reussie then
    return jsonb_build_object('bloquee', false);
  end if;

  v_echecs_email := prive.echecs_de_suite('email', v_email);
  v_echecs_ip    := prive.echecs_de_suite('ip', v_ip);

  -- Nouvel épisode : 5 échecs depuis le dernier déclenchement, sans blocage
  -- en cours.
  v_bloque_email := v_echecs_email >= c_limite and not prive.blocage_actif('email', v_email);
  v_bloque_ip    := v_echecs_ip >= c_limite and not prive.blocage_actif('ip', v_ip);

  if v_bloque_email or v_bloque_ip then
    update public.tentatives_connexion t
       set bloque_email    = v_bloque_email,
           bloque_ip       = v_bloque_ip,
           bloque_email_le = case when v_bloque_email then now() end,
           bloque_ip_le    = case when v_bloque_ip then now() end
     where t.id = p_id;

    -- Une ligne par épisode, auteur système, sans email, IP ni empreinte (AD-14).
    perform prive.ecrire_journal(
      'connexion',
      jsonb_build_object(
        'evenement', 'connexion_bloquee',
        'bloque', case
                    when v_bloque_email and v_bloque_ip then 'email_et_ip'
                    when v_bloque_email then 'email'
                    else 'ip'
                  end,
        'duree_minutes', 15
      )
    );
  end if;

  return jsonb_build_object(
    'bloquee', v_echecs_email >= c_limite or v_echecs_ip >= c_limite
               or prive.blocage_actif('email', v_email)
               or prive.blocage_actif('ip', v_ip)
  );
end;
$$;

comment on function public.terminer_connexion(bigint, boolean) is
  'Fin d''une tentative de connexion (action connexion, après Auth) : true réussie, false échec, null erreur serveur (tentative supprimée). Note au journal chaque épisode de blocage (une ligne). EXECUTE réservé à service_role.';

notify pgrst, 'reload schema';
