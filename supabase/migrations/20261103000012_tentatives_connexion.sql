-- Story 1.9 — Sécuriser la connexion (AD-14, AD-15, AD-19, AD-20, AD-21, AD-23).
--
-- 1. Table `tentatives_connexion` : une tentative de connexion transmise à
--    Supabase Auth = une ligne (empreinte HMAC de l'email, empreinte HMAC de
--    l'IP, date, résultat). Jamais d'email ni d'IP en clair : les colonnes
--    n'acceptent qu'une empreinte hexadécimale de 64 caractères
--    (HMAC-SHA-256, calculée par lib/server/empreintes.ts). RLS activée,
--    aucun droit pour personne, même la clé secrète : seules les deux
--    fonctions ci-dessous y écrivent.
-- 2. `commencer_connexion(empreinte_email, empreinte_ip)` : appelée par
--    l'action `connexion` AVANT `signInWithPassword`. Verrou sur les deux
--    empreintes ; refuse (`CONNEXION_BLOQUEE`) si 5 échecs de suite sont
--    déjà comptés pour l'une ou l'autre ; sinon enregistre la tentative,
--    comptée comme un échec tant qu'elle n'est pas marquée réussie, et
--    renvoie son identifiant. Efface au passage les tentatives de plus d'un
--    jour.
-- 3. `terminer_connexion(id, reussie)` : appelée APRÈS la réponse d'Auth.
--    Marque la tentative réussie ou échouée. Si cet échec vient de déclencher
--    le blocage, écrit une seule ligne de journal `connexion`, auteur
--    système, sans email ni IP (ni empreinte). Renvoie `{ "bloquee": … }` :
--    vrai si la prochaine tentative serait refusée.
--
-- « De suite » : on compte les échecs (tentatives non réussies, en cours
-- comprises) des 15 dernières minutes postérieurs à la dernière réussite de
-- la même empreinte. Les deux domaines (email, IP) sont comptés séparément.

-- 1. Table des tentatives --------------------------------------------------

create table public.tentatives_connexion (
  id              bigint      generated always as identity primary key,
  -- HMAC-SHA-256 de l'email (minuscules, sans espaces) et de l'IP, en
  -- hexadécimal : jamais l'adresse elle-même.
  empreinte_email text        not null check (empreinte_email ~ '^[0-9a-f]{64}$'),
  empreinte_ip    text        not null check (empreinte_ip ~ '^[0-9a-f]{64}$'),
  -- null : réponse d'Auth pas encore reçue (compte comme un échec) ;
  -- false : échec ; true : réussite (membre actif connecté).
  reussie         boolean,
  -- Vrai sur la tentative dont l'échec a déclenché le blocage de l'email ou
  -- de l'IP : une seule ligne de journal par blocage.
  bloque_email    boolean     not null default false,
  bloque_ip       boolean     not null default false,
  cree_le         timestamptz not null default now()
);

comment on table public.tentatives_connexion is
  'Tentatives de connexion (blocage après 5 échecs de suite en 15 minutes, AD-21) : empreintes HMAC de l''email et de l''IP seulement, effacées au-delà d''un jour (AD-23). Écrit uniquement par commencer_connexion et terminer_connexion.';

create index tentatives_connexion_email_idx
  on public.tentatives_connexion (empreinte_email, cree_le);
create index tentatives_connexion_ip_idx
  on public.tentatives_connexion (empreinte_ip, cree_le);
create index tentatives_connexion_cree_le_idx
  on public.tentatives_connexion (cree_le);

alter table public.tentatives_connexion enable row level security;

-- Aucune règle RLS ni aucun droit direct, même pour la clé secrète.
revoke all on table public.tentatives_connexion
  from public, anon, authenticated, service_role;
revoke all on sequence public.tentatives_connexion_id_seq
  from public, anon, authenticated, service_role;

-- 2. Utilitaires (schéma prive, aucun droit EXECUTE) -----------------------

-- Verrou de transaction sur les deux empreintes. Toujours dans le même ordre
-- (email puis IP) : deux tentatives simultanées ne peuvent pas s'attendre
-- mutuellement.
create function prive.verrouiller_tentatives(p_empreinte_email text, p_empreinte_ip text)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('tentatives_connexion:email:' || p_empreinte_email, 0));
  select pg_advisory_xact_lock(hashtextextended('tentatives_connexion:ip:' || p_empreinte_ip, 0));
$$;

-- Échecs de suite d'une empreinte : tentatives non réussies (en cours
-- comprises) des 15 dernières minutes, postérieures à sa dernière réussite.
-- `p_domaine` : 'email' ou 'ip'.
create function prive.echecs_de_suite(p_domaine text, p_empreinte text)
returns integer
language sql
stable
set search_path = ''
as $$
  with serie as (
    select t.reussie, t.cree_le
      from public.tentatives_connexion t
     where t.cree_le > now() - interval '15 minutes'
       and case p_domaine
             when 'email' then t.empreinte_email = p_empreinte
             when 'ip'    then t.empreinte_ip = p_empreinte
             else false
           end
  )
  select count(*)::integer
    from serie s
   where s.reussie is distinct from true
     and s.cree_le > coalesce((select max(r.cree_le) from serie r where r.reussie),
                              '-infinity'::timestamptz);
$$;

-- Vrai si le blocage de cette série a déjà été noté au journal (même
-- fenêtre, après la dernière réussite).
create function prive.blocage_deja_note(p_domaine text, p_empreinte text)
returns boolean
language sql
stable
set search_path = ''
as $$
  with serie as (
    select t.reussie, t.cree_le,
           case p_domaine when 'email' then t.bloque_email else t.bloque_ip end as bloque
      from public.tentatives_connexion t
     where t.cree_le > now() - interval '15 minutes'
       and case p_domaine
             when 'email' then t.empreinte_email = p_empreinte
             when 'ip'    then t.empreinte_ip = p_empreinte
             else false
           end
  )
  select exists (
    select 1
      from serie s
     where s.bloque
       and s.cree_le > coalesce((select max(r.cree_le) from serie r where r.reussie),
                                '-infinity'::timestamptz)
  );
$$;

revoke all on function prive.verrouiller_tentatives(text, text)
  from public, anon, authenticated, service_role;
revoke all on function prive.echecs_de_suite(text, text)
  from public, anon, authenticated, service_role;
revoke all on function prive.blocage_deja_note(text, text)
  from public, anon, authenticated, service_role;

-- 3. Début d'une tentative --------------------------------------------------

create function public.commencer_connexion(
  p_empreinte_email text,
  p_empreinte_ip    text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 5 échecs de suite en 15 minutes (AD-21).
  c_limite       constant integer  := 5;
  -- Tentatives gardées au plus un jour (AD-23).
  c_conservation constant interval := interval '1 day';
  v_id           bigint;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  if p_empreinte_email is null or p_empreinte_email !~ '^[0-9a-f]{64}$'
     or p_empreinte_ip is null or p_empreinte_ip !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Verrou jusqu'à la fin de la transaction : des tentatives simultanées sur
  -- la même empreinte passent l'une après l'autre, chacune voit celles
  -- enregistrées avant elle, et la limite ne peut pas être dépassée.
  perform prive.verrouiller_tentatives(p_empreinte_email, p_empreinte_ip);

  if prive.echecs_de_suite('email', p_empreinte_email) >= c_limite
     or prive.echecs_de_suite('ip', p_empreinte_ip) >= c_limite
  then
    raise exception using errcode = 'P0001', message = 'CONNEXION_BLOQUEE';
  end if;

  -- Comptée comme un échec tant que terminer_connexion ne l'a pas marquée
  -- réussie.
  insert into public.tentatives_connexion (empreinte_email, empreinte_ip)
  values (p_empreinte_email, p_empreinte_ip)
  returning id into v_id;

  -- Tentatives de plus d'un jour effacées au passage (AD-23).
  delete from public.tentatives_connexion t
   where t.cree_le < now() - c_conservation;

  return v_id;
end;
$$;

comment on function public.commencer_connexion(text, text) is
  'Début d''une tentative de connexion (action connexion, avant Auth). Refuse après 5 échecs de suite en 15 minutes pour la même empreinte d''email ou d''IP (CONNEXION_BLOQUEE). EXECUTE réservé à service_role.';

revoke all on function public.commencer_connexion(text, text)
  from public, anon, authenticated;
grant execute on function public.commencer_connexion(text, text) to service_role;

-- 4. Fin d'une tentative ----------------------------------------------------

create function public.terminer_connexion(
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
  v_bloque_email  boolean := false;
  v_bloque_ip     boolean := false;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  if p_id is null or p_reussie is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select t.empreinte_email, t.empreinte_ip
    into v_email, v_ip
    from public.tentatives_connexion t
   where t.id = p_id;
  if v_email is null then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Même verrou que commencer_connexion : le constat du blocage et la ligne
  -- de journal ne peuvent pas être faits deux fois.
  perform prive.verrouiller_tentatives(v_email, v_ip);

  -- Seul le premier résultat compte.
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

  -- Cet échec vient-il de déclencher le blocage (pas encore noté pour cette
  -- série) ?
  v_bloque_email := v_echecs_email >= c_limite and not prive.blocage_deja_note('email', v_email);
  v_bloque_ip    := v_echecs_ip >= c_limite and not prive.blocage_deja_note('ip', v_ip);

  if v_bloque_email or v_bloque_ip then
    update public.tentatives_connexion t
       set bloque_email = v_bloque_email,
           bloque_ip    = v_bloque_ip
     where t.id = p_id;

    -- Une seule ligne, auteur système, sans email, IP ni empreinte (AD-14).
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
  );
end;
$$;

comment on function public.terminer_connexion(bigint, boolean) is
  'Fin d''une tentative de connexion (action connexion, après Auth). Note au journal le blocage qu''un échec vient de déclencher (une seule ligne). EXECUTE réservé à service_role.';

revoke all on function public.terminer_connexion(bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.terminer_connexion(bigint, boolean) to service_role;

-- PostgREST : prise en compte immédiate des nouvelles fonctions.
notify pgrst, 'reload schema';
