-- Story 4.1 — Inviter un nouveau membre (AD-1, AD-3, AD-17, AD-19, AD-20).
--
-- Crée :
--   - `lister_comptes()` : liste des comptes (nom, email, rôle, état), réservée
--     aux administrateurs actifs ;
--   - `mon_invitation()` : nom du compte connecté s'il est encore invité (page
--     « Bienvenue chez Nova Services, [prénom] ») ;
--   - `activer_mon_compte()` : passage `invite` → `actif` du compte connecté,
--     après le choix de son premier mot de passe.
--
-- Remplace :
--   - `creer_membre` : nouveau paramètre facultatif `p_auteur_id`. Quand il est
--     fourni (invitation par un administrateur), une ligne `compte` est écrite
--     au journal au nom de l'auteur. Les scripts et les tests, qui ne le
--     passent pas, ne journalisent rien. Toujours réservée à service_role.

-- 1. Création d'un membre, avec journal ----------------------------------
-- Ajouter un paramètre crée une autre fonction : l'ancienne signature est
-- retirée, pour qu'il n'existe qu'une seule façon de créer un membre (AD-17).

drop function public.creer_membre(uuid, text, text, text, text);

create function public.creer_membre(
  p_id        uuid,
  p_nom       text,
  p_email     text,
  p_role      text,
  p_etat      text,
  p_auteur_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blancs constant text := E' \t\n\r\f\v';
  v_nom    text := btrim(p_nom, v_blancs);
  v_email  text := lower(btrim(p_email, v_blancs));
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  if p_id is null
     or v_nom is null or char_length(v_nom) not between 1 and 150
     or v_email is null or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_role is null or p_role not in ('collaborateur', 'administrateur')
     or p_etat is null or p_etat not in ('invite', 'actif')
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Auteur fourni : un administrateur actif (l'action l'a déjà vérifié avec
  -- la session ; revérifié ici, dans la même transaction que l'écriture).
  if p_auteur_id is not null and not exists (
    select 1 from public.membres m
     where m.id = p_auteur_id
       and m.etat = 'actif'
       and m.role = 'administrateur'
  ) then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if exists (select 1 from public.membres m where m.id = p_id) then
    raise exception using errcode = 'P0001', message = 'MEMBRE_EXISTANT';
  end if;

  if exists (select 1 from public.membres m where m.email = v_email) then
    raise exception using errcode = 'P0001', message = 'EMAIL_DEJA_UTILISE';
  end if;

  -- Le compte Auth doit exister, avec la même adresse.
  if not exists (
    select 1 from auth.users u where u.id = p_id and lower(u.email) = v_email
  ) then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  begin
    insert into public.membres (id, nom, email, role, etat)
    values (p_id, v_nom, v_email, p_role, p_etat);
  exception
    when unique_violation then
      -- Création simultanée avec le même identifiant ou la même adresse.
      if exists (select 1 from public.membres m where m.id = p_id) then
        raise exception using errcode = 'P0001', message = 'MEMBRE_EXISTANT';
      end if;
      raise exception using errcode = 'P0001', message = 'EMAIL_DEJA_UTILISE';
  end;

  -- Journal (AD-19) : le membre créé est cité (nom et rôle), jamais un demandeur.
  if p_auteur_id is not null then
    perform prive.ecrire_journal(
      'compte',
      jsonb_build_object(
        'evenement', 'compte_cree',
        'membre_id', p_id,
        'nom',       v_nom,
        'role',      p_role
      ),
      p_auteur_id
    );
  end if;

  return jsonb_build_object('id', p_id);
end;
$$;

comment on function public.creer_membre(uuid, text, text, text, text, uuid) is
  'Seule création d''un membre (AD-17), après le compte Auth ; journal « compte_cree » si un auteur est fourni. EXECUTE réservé à service_role.';

revoke all on function public.creer_membre(uuid, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.creer_membre(uuid, text, text, text, text, uuid) to service_role;

-- 2. Liste des comptes (administrateurs) ---------------------------------
-- Tableau JSON trié par nom : id, nom, email, rôle, état. Un collaborateur ne
-- lit dans `membres` que id, nom et état (droits par colonne, story 1.5).

create function public.lister_comptes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  return coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'id',    m.id,
                'nom',   m.nom,
                'email', m.email,
                'role',  m.role,
                'etat',  m.etat
              )
              order by lower(m.nom), m.id
            )
       from public.membres m),
    '[]'::jsonb
  );
end;
$$;

comment on function public.lister_comptes() is
  'Comptes de l''équipe (nom, email, rôle, état), triés par nom. Administrateur actif seulement, sinon DROIT_INSUFFISANT.';

revoke all on function public.lister_comptes() from public, anon, authenticated, service_role;
grant execute on function public.lister_comptes() to authenticated;

-- 3. Invitation du compte connecté ---------------------------------------
-- Nom du compte connecté s'il est encore à l'état `invite` ; null sinon
-- (actif, désactivé, compte Auth sans membre). Jamais un autre compte : la
-- fonction ne prend aucun paramètre et lit `auth.uid()`.

create function public.mon_invitation()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('nom', m.nom)
    from public.membres m
   where m.id = auth.uid()
     and m.etat = 'invite';
$$;

comment on function public.mon_invitation() is
  'Nom du compte connecté s''il est invité ; null sinon. EXECUTE réservé à authenticated.';

revoke all on function public.mon_invitation() from public, anon, authenticated, service_role;
grant execute on function public.mon_invitation() to authenticated;

-- 4. Activation du compte connecté ---------------------------------------
-- Appelée après le premier mot de passe : `invite` → `actif`. Déjà actif :
-- sans effet (second envoi). Désactivé, ou compte Auth sans membre :
-- DROIT_INSUFFISANT (un compte désactivé ne se réactive jamais lui-même).

create function public.activer_mon_compte()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := auth.uid();
  v_etat text;
begin
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  select m.etat into v_etat
    from public.membres m
   where m.id = v_id
     for update;

  if v_etat is null or v_etat = 'desactive' then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if v_etat = 'invite' then
    update public.membres m
       set etat = 'actif'
     where m.id = v_id
       and m.etat = 'invite';
  end if;

  return jsonb_build_object('etat', 'actif');
end;
$$;

comment on function public.activer_mon_compte() is
  'Passe le compte connecté de invite à actif (premier mot de passe) ; sans effet si déjà actif. EXECUTE réservé à authenticated.';

revoke all on function public.activer_mon_compte() from public, anon, authenticated, service_role;
grant execute on function public.activer_mon_compte() to authenticated;
