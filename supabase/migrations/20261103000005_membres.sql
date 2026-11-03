-- Story 1.4 — Membres de l'équipe et fonctions de droits
-- (AD-1, AD-2, AD-3, AD-15, AD-17, AD-18, AD-20, AD-31).
--
-- Crée :
--   - la table `membres` : source unique des rôles et des états (AD-3) ;
--   - les clés étrangères vers `membres` laissées en attente par la story 1.3
--     (`demandes.responsable_id`, `demandes.saisie_par_id`, `historique.auteur_id`) ;
--   - `prive.est_membre_actif()` et `prive.est_admin()`, utilisées par toutes
--     les futures règles RLS ;
--   - `mon_profil()` : nom, rôle et état du membre connecté et actif ;
--   - `creer_membre(...)` : seule création d'une ligne `membres` (AD-17),
--     réservée à `service_role`.
--
-- Le rôle n'est jamais lu dans les métadonnées Auth. Aucun déclencheur sur
-- `auth.users` : la ligne `membres` est créée explicitement, après le compte
-- Auth, par les scripts (et par l'invitation, story 4.1).

-- 1. Table des membres ----------------------------------------------------

create table public.membres (
  -- Même identifiant que le compte Supabase Auth. Supprimer le compte Auth
  -- supprime la ligne (annulation d'une invitation, AD-17), sauf si le membre
  -- est cité par une demande ou l'historique (refusé par leurs clés étrangères).
  id            uuid        primary key references auth.users (id) on delete cascade,
  nom           text        not null
                            check (nom = btrim(nom) and char_length(nom) between 1 and 150),
  email         text        not null unique
                            check (email = lower(btrim(email))
                                   and char_length(email) between 3 and 254
                                   and email like '%_@_%'),
  role          text        not null
                            check (role in ('collaborateur', 'administrateur')),
  etat          text        not null default 'invite'
                            check (etat in ('invite', 'actif', 'desactive')),
  cree_le       timestamptz not null default now(),
  mis_a_jour_le timestamptz not null default now()
);

comment on table public.membres is
  'Membres de l''équipe : source unique des rôles et des états (AD-3). Écrite uniquement par les fonctions SQL.';

alter table public.membres enable row level security;

-- Aucune règle RLS ni aucun droit direct : `anon` et `authenticated` n'ont
-- rien (migration 20261103000001), et `service_role` non plus (comme pour
-- les autres tables, migration 20261103000004). Les lectures passent par
-- `mon_profil()` et, plus tard, par des droits par colonne (story 1.5).
revoke all on table public.membres from public, anon, authenticated, service_role;

create function prive.dates_membre()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.mis_a_jour_le := now();
  return new;
end;
$$;

comment on function prive.dates_membre() is
  'Déclencheur de membres : met à jour mis_a_jour_le.';

create trigger membres_dates
  before update on public.membres
  for each row execute function prive.dates_membre();

-- 2. Clés étrangères laissées en attente par la story 1.3 ----------------

alter table public.demandes
  add constraint demandes_responsable_id_fkey
    foreign key (responsable_id) references public.membres (id),
  add constraint demandes_saisie_par_id_fkey
    foreign key (saisie_par_id) references public.membres (id);

alter table public.historique
  add constraint historique_auteur_id_fkey
    foreign key (auteur_id) references public.membres (id);

create index demandes_responsable_id_idx on public.demandes (responsable_id);
create index demandes_saisie_par_id_idx  on public.demandes (saisie_par_id);
create index historique_auteur_id_idx    on public.historique (auteur_id);

-- 3. Fonctions de droits (AD-3) -------------------------------------------
-- Lues à chaque requête dans `membres`, via la session (`auth.uid()`).
-- `EXECUTE` à `authenticated` seulement, pour les règles RLS. Le schéma
-- `prive` n'est pas exposé par l'API et `authenticated` n'y a pas d'accès
-- (USAGE) : ces fonctions ne sont pas appelables directement depuis l'API ;
-- une règle RLS, résolue à sa création, n'a besoin que du droit EXECUTE.

create function prive.est_membre_actif()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.membres m
     where m.id = auth.uid()
       and m.etat = 'actif'
  );
$$;

comment on function prive.est_membre_actif() is
  'Vrai si la session appartient à un membre à l''état actif (AD-3).';

create function prive.est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.membres m
     where m.id = auth.uid()
       and m.etat = 'actif'
       and m.role = 'administrateur'
  );
$$;

comment on function prive.est_admin() is
  'Vrai si la session appartient à un administrateur actif (AD-3).';

revoke all on function prive.est_membre_actif() from public, anon, authenticated, service_role;
revoke all on function prive.est_admin()        from public, anon, authenticated, service_role;
grant execute on function prive.est_membre_actif() to authenticated;
grant execute on function prive.est_admin()        to authenticated;

-- 4. Profil du membre connecté -------------------------------------------
-- Nom, rôle et état du membre connecté, s'il est actif ; null sinon
-- (visiteur, compte Auth sans membre, invité, désactivé). Jamais un autre
-- membre : la fonction ne prend aucun paramètre.

create function public.mon_profil()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('nom', m.nom, 'role', m.role, 'etat', m.etat)
    from public.membres m
   where m.id = auth.uid()
     and m.etat = 'actif';
$$;

comment on function public.mon_profil() is
  'Nom, rôle et état du membre connecté et actif ; null sinon. EXECUTE réservé à authenticated.';

revoke all on function public.mon_profil() from public, anon, authenticated, service_role;
grant execute on function public.mon_profil() to authenticated;

-- 5. Création d'un membre (AD-17) ----------------------------------------
-- Appelée avec la clé secrète, après la création du compte Auth, par les
-- scripts (premier administrateur, comptes de test) et, plus tard, par
-- l'invitation (story 4.1, état `invite`). L'état `actif` à la création est
-- réservé aux scripts ; `desactive` est refusé.
-- Erreurs prévues (AD-20) : DONNEES_INVALIDES, MEMBRE_EXISTANT, EMAIL_DEJA_UTILISE.

create function public.creer_membre(
  p_id    uuid,
  p_nom   text,
  p_email text,
  p_role  text,
  p_etat  text
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

  return jsonb_build_object('id', p_id);
end;
$$;

comment on function public.creer_membre(uuid, text, text, text, text) is
  'Seule création d''un membre (AD-17), après le compte Auth. EXECUTE réservé à service_role.';

revoke all on function public.creer_membre(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.creer_membre(uuid, text, text, text, text) to service_role;
