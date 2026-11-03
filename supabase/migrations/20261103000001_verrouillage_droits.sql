-- Story 1.1 — Verrouillage des droits par défaut (AD-2, AD-15).
--
-- Supabase accorde par défaut des droits aux rôles `anon` et `authenticated`
-- sur tout ce qui est créé dans le schéma `public`. Ici, on retire tout :
--   - sur les objets déjà présents (tables, vues, séquences, fonctions) ;
--   - sur les objets futurs (ALTER DEFAULT PRIVILEGES).
-- Chaque story suivante accordera ensuite, nominativement, le strict nécessaire.
--
-- Le rôle `service_role` (clé secrète, utilisée seulement dans lib/server/)
-- n'est pas concerné par ce verrouillage.

-- 1. Objets existants du schéma public -----------------------------------

revoke all on all tables    in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;

-- Personne d'autre que le propriétaire ne crée d'objet dans public.
revoke create on schema public from anon, authenticated, public;

-- 2. Objets futurs créés par `postgres` (rôle des migrations) ------------

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, public;

-- PostgreSQL accorde EXECUTE à PUBLIC sur toute nouvelle fonction, quel que
-- soit le schéma : ce droit global ne se retire que sans « in schema ».
alter default privileges for role postgres
  revoke execute on functions from public;

-- 3. Schéma `prive` : utilitaires internes, sans aucun droit -------------
-- Il n'est pas exposé par l'API (absent de [api].schemas). Les droits utiles
-- (par exemple EXECUTE sur prive.est_membre_actif pour les règles RLS) seront
-- accordés nominativement par les stories qui créent ces fonctions.

create schema if not exists prive;

revoke all on schema prive from anon, authenticated, public;

alter default privileges for role postgres in schema prive
  revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema prive
  revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema prive
  revoke all on functions from anon, authenticated, public;
