-- Story 1.4 (correctif) — Nombre d'administrateurs actifs.
--
-- Utilisée par scripts/premier-admin.ts, qui refuse de créer un
-- administrateur s'il en existe déjà un actif (sauf --encore). La clé
-- secrète n'a aucun droit direct sur `membres` (migration 20261103000005) :
-- elle passe par cette fonction, qui ne renvoie qu'un nombre.

create function public.nombre_administrateurs_actifs()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.membres m
   where m.role = 'administrateur'
     and m.etat = 'actif';
$$;

comment on function public.nombre_administrateurs_actifs() is
  'Nombre d''administrateurs actifs (script premier-admin). EXECUTE réservé à service_role.';

revoke all on function public.nombre_administrateurs_actifs() from public, anon, authenticated;
grant execute on function public.nombre_administrateurs_actifs() to service_role;
