-- Story 3.4 — Registre des effacements et rejeu après une restauration
-- (AD-5, AD-15, AD-30).
--
-- Crée :
--   - la table `effacements` : référence des demandes effacées à la demande
--     d'une personne (droit à l'effacement), et date de l'effacement ; aucune
--     autre donnée (ni nom, ni email) ;
--   - `rejouer_effacements()` : après une restauration, supprime à nouveau
--     les demandes dont la référence figure dans le registre (historique et
--     notes suivent par `on delete cascade`) et renvoie leur nombre.
--
-- La table n'est remplie par aucune fonction ici : `effacer_demandeur`
-- (epic 5) y inscrira les références effacées. Les lignes du registre ne
-- sont jamais retirées par `rejouer_effacements()` : elles resservent à
-- chaque restauration.
--
-- Attention : le registre fait partie de la sauvegarde. Une restauration le
-- remet donc lui aussi à l'heure de la sauvegarde : les effacements faits
-- APRÈS la sauvegarde n'y sont plus, et le rejeu les ignorerait. Avant une
-- vraie restauration, exporter les lignes actuelles du registre (sauvegarde
-- fraîche ou base abîmée si lisible), les réinsérer dans la base restaurée
-- (`insert … on conflict do nothing`), puis appeler `rejouer_effacements()`
-- (docs/exploitation/restauration.md). La tâche « Restauration de test » ne
-- rejoue que le registre de la sauvegarde elle-même.
--
-- Droits : RLS activée, aucune règle ; aucun droit direct pour `anon`,
-- `authenticated` ni `service_role`. `rejouer_effacements()` est exécutable
-- par `service_role` seulement (AD-15).
--
-- Création seulement : sans effet sur les données existantes.

-- 1. Registre ------------------------------------------------------------

create table public.effacements (
  reference  text        primary key
                         check (reference ~ '^NOVA-[0-9]{4}-[0-9]{4,}$'),
  efface_le  timestamptz not null default now()
);

comment on table public.effacements is
  'Références des demandes effacées (droit à l''effacement), sans autre donnée. Rejouées par rejouer_effacements() après toute restauration (AD-30).';

alter table public.effacements enable row level security;

revoke all on table public.effacements from public, anon, authenticated, service_role;

-- 2. Rejeu des effacements ----------------------------------------------

create function public.rejouer_effacements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre integer;
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).

  -- Historique et notes partent en cascade (on delete cascade) ; leurs
  -- déclencheurs laissent passer la suppression avec la demande (AD-5).
  delete from public.demandes d
   using public.effacements e
   where d.reference = e.reference;

  get diagnostics v_nombre = row_count;
  return v_nombre;
end;
$$;

comment on function public.rejouer_effacements() is
  'Après une restauration : supprime à nouveau les demandes dont la référence figure dans effacements (historique et notes en cascade) et renvoie leur nombre (AD-30).';

revoke all on function public.rejouer_effacements() from public, anon, authenticated;
grant execute on function public.rejouer_effacements() to service_role;
