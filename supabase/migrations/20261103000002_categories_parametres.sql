-- Story 1.2 — Catégories, paramètres et lecture publique (AD-2, AD-15).
--
-- Crée :
--   - la table `categories` et les 5 catégories de départ (ordre du PRD) ;
--   - la table `parametres` (une seule ligne) et sa valeur de départ ;
--   - la fonction `infos_publiques()`, lue par la page publique `/` côté
--     serveur avec la clé secrète.
--
-- RLS est activée sur les deux tables, sans aucune règle : `anon` et
-- `authenticated` n'ont aucun droit (la migration 20261103000001 a retiré
-- les droits par défaut). Seul `service_role` peut exécuter la fonction.

-- 1. Catégories ---------------------------------------------------------

create table public.categories (
  id      uuid        primary key default gen_random_uuid(),
  nom     text        not null unique
                      check (nom = btrim(nom) and char_length(nom) between 1 and 80),
  actif   boolean     not null default true,
  ordre   integer     not null,
  cree_le timestamptz not null default now()
);

comment on table public.categories is
  'Catégories proposées dans le formulaire de dépôt. Seules les catégories actives sont affichées.';

alter table public.categories enable row level security;

insert into public.categories (nom, ordre) values
  ('Demande d''information',   1),
  ('Problème technique',       2),
  ('Demande de rendez-vous',   3),
  ('Question administrative',  4),
  ('Autre',                    5);

-- 2. Paramètres (une seule ligne) -------------------------------------

create table public.parametres (
  -- Clé constante : la table ne peut contenir qu'une ligne.
  id                       boolean     primary key default true check (id),
  nom_affiche              text        not null
                                       check (nom_affiche = btrim(nom_affiche)
                                              and char_length(nom_affiche) between 1 and 150),
  email_contact            text        not null
                                       check (email_contact = lower(btrim(email_contact))
                                              and email_contact like '%_@_%'),
  duree_conservation_mois  integer     not null
                                       check (duree_conservation_mois between 6 and 60),
  mis_a_jour_le            timestamptz not null default now()
);

comment on table public.parametres is
  'Paramètres généraux (une seule ligne) : nom affiché, email de contact, durée de conservation en mois.';

alter table public.parametres enable row level security;

insert into public.parametres (nom_affiche, email_contact, duree_conservation_mois)
values ('Nova Services', 'contact@nova-services.example', 24);

-- 3. Lecture publique ------------------------------------------------

-- Renvoie ce que la page publique affiche : catégories actives triées,
-- nom affiché, email de contact et durée de conservation. Aucune donnée
-- personnelle. Réservée au serveur (clé secrète) : le navigateur ne parle
-- jamais à Supabase (AD-1).
create function public.infos_publiques()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'nom_affiche',             p.nom_affiche,
    'email_contact',           p.email_contact,
    'duree_conservation_mois', p.duree_conservation_mois,
    'categories', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object('id', c.id, 'nom', c.nom)
                 order by c.ordre, c.nom
               )
        from public.categories c
        where c.actif
      ),
      '[]'::jsonb
    )
  )
  from public.parametres p;
$$;

comment on function public.infos_publiques() is
  'Catégories actives et paramètres affichés sur le formulaire public. EXECUTE réservé à service_role.';

revoke all on function public.infos_publiques() from public, anon, authenticated;
grant execute on function public.infos_publiques() to service_role;
