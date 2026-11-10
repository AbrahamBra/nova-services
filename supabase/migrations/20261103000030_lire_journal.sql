-- Story 5.1 — Consulter le journal des événements (FR-26, AD-5, AD-14,
-- AD-19).
--
-- Crée :
--   - `lire_journal(p_type, p_page)` : une page de 50 lignes du journal, de
--     la plus récente à la plus ancienne (`cree_le desc, id desc`), filtrée
--     par type si `p_type` est donné. Administrateur actif seulement, sinon
--     DROIT_INSUFFISANT ; type inconnu ou page invalide : DONNEES_INVALIDES.
--     Renvoie `{ total, lignes: [{ id, cree_le, type, auteur_type,
--     auteur_nom, details }] }` : `total` compte toutes les lignes du filtre,
--     `auteur_nom` est le nom ACTUEL du membre auteur (null pour le système,
--     ou si le membre n'existe plus). Les détails sont renvoyés tels quels
--     (codes et identifiants) : la phrase est fabriquée à l'affichage
--     (lib/journal.ts).
--   - l'index `(type, cree_le desc)` pour le filtre par type.
--
-- Lecture seule : le journal reste en ajout seulement (aucun droit direct,
-- aucune modification ni suppression ici).

-- 1. Index du filtre par type ----------------------------------------------

create index journal_type_cree_le_idx on public.journal (type, cree_le desc);

-- 2. Lecture d'une page du journal -----------------------------------------

create function public.lire_journal(
  p_type text    default null,
  p_page integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_taille constant integer := 50;
  v_total  bigint;
  v_lignes jsonb;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if (p_type is not null
      and p_type not in ('compte', 'parametre', 'categorie', 'donnees', 'email', 'connexion'))
     or p_page is null
     or p_page < 1
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  select count(*)
    into v_total
    from public.journal j
   where p_type is null or j.type = p_type;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',          l.id,
               'cree_le',     l.cree_le,
               'type',        l.type,
               'auteur_type', l.auteur_type,
               'auteur_nom',  l.auteur_nom,
               'details',     l.details
             )
             order by l.cree_le desc, l.id desc
           ),
           '[]'::jsonb
         )
    into v_lignes
    from (
      select j.id, j.cree_le, j.type, j.auteur_type, j.details,
             case when j.auteur_type = 'membre' then m.nom end as auteur_nom
        from public.journal j
        left join public.membres m on m.id = j.auteur_id
       where p_type is null or j.type = p_type
       order by j.cree_le desc, j.id desc
       limit v_taille
      offset (p_page::bigint - 1) * v_taille
    ) l;

  return jsonb_build_object('total', v_total, 'lignes', v_lignes);
end;
$$;

comment on function public.lire_journal(text, integer) is
  'Page de 50 lignes du journal (plus récente d''abord), filtrée par type si donné. Administrateur actif seulement, sinon DROIT_INSUFFISANT ; type inconnu ou page < 1 : DONNEES_INVALIDES. EXECUTE réservé à authenticated.';

revoke all on function public.lire_journal(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.lire_journal(text, integer) to authenticated;

-- PostgREST : prise en compte immédiate de la nouvelle fonction.
notify pgrst, 'reload schema';
