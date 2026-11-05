-- Story 2.5 — Rechercher et filtrer les demandes (FR-12, NFR-7, AD-18, AD-25).
--
-- Crée :
--   - `prive.normaliser(texte)` : minuscules, sans accents (lettres latines
--     accentuées, ligatures œ, æ, ß), apostrophes typographiques ramenées à
--     « ' ». Fonction IMMUABLE (fonctions internes seulement : `normalize`,
--     `translate`, `replace`, `lower`), utilisable par une colonne générée ;
--   - la colonne générée `demandes.recherche` : référence, nom, société,
--     email et objet normalisés, tenue à jour par la base à chaque écriture ;
--   - l'extension `pg_trgm` (schéma `extensions`) et un index GIN trigrammes
--     sur `recherche`, pour la recherche d'un mot partiel (`like '%…%'`) ;
--   - `rechercher_demandes(p_texte)` : les lignes de la vue `demandes_liste`
--     dont `recherche` contient le texte normalisé. Les caractères `%`, `_`
--     et `\` sont cherchés tels quels (échappés).
--
-- La colonne `recherche` n'est lisible par PERSONNE d'autre que le
-- propriétaire : aucun droit par colonne pour `authenticated` (ni pour
-- `anon` ou `service_role`). Les membres cherchent seulement à travers
-- `rechercher_demandes`, en `SECURITY DEFINER` : elle ne renvoie des lignes
-- qu'à un membre ACTIF (`prive.est_membre_actif()`, même règle que la RLS
-- de lecture des demandes) ; un compte invité ou désactivé ne reçoit rien.
-- EXECUTE à `authenticated` seulement : le visiteur (`anon`) est refusé.
--
-- Les filtres (statut, priorité, catégorie, canal, responsable), le tri et
-- la pagination sont appliqués par PostgREST sur le résultat, exactement
-- comme sur la vue (lib/filtres.ts, lib/demandes.ts).

-- 1. Normalisation -----------------------------------------------------------

create function prive.normaliser(p_texte text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(
    replace(replace(replace(replace(replace(
      translate(
        normalize(p_texte, NFC),
        'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžØøĐđĦħŁłĿŀıŦŧ’‘',
        'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzooddhhllllitt'''''
      ),
      'Œ', 'oe'), 'œ', 'oe'), 'Æ', 'ae'), 'æ', 'ae'), 'ß', 'ss')
  );
$$;

comment on function prive.normaliser(text) is
  'Texte en minuscules, sans accents, pour la recherche (story 2.5). Immuable : utilisée par la colonne générée demandes.recherche.';

revoke all on function prive.normaliser(text) from public, anon, authenticated, service_role;

-- 2. Colonne normalisée ------------------------------------------------------
-- Colonne générée : recalculée par la base à chaque insertion ou
-- modification, sans déclencheur. Aucun droit de lecture accordé.

alter table public.demandes
  add column recherche text not null
  generated always as (
    prive.normaliser(
      reference || ' ' || nom || ' ' || coalesce(societe, '') || ' '
      || coalesce(email, '') || ' ' || objet
    )
  ) stored;

comment on column public.demandes.recherche is
  'Référence, nom, société, email et objet normalisés (prive.normaliser). Lue seulement par rechercher_demandes.';

-- 3. Index trigrammes --------------------------------------------------------

-- Schéma réel vérifié (corrigé après relecture, comme dans la migration
-- 0019) : déjà installée ailleurs, l'extension est déplacée dans
-- `extensions`, où l'index la cherche.
do $$
declare
  v_schema text;
begin
  select n.nspname
    into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';

  if v_schema is null then
    create extension pg_trgm with schema extensions;
  elsif v_schema <> 'extensions' then
    alter extension pg_trgm set schema extensions;
  end if;
end;
$$;

create index demandes_recherche_trgm_idx
  on public.demandes using gin (recherche extensions.gin_trgm_ops);

-- 4. Recherche ---------------------------------------------------------------
-- Texte vide ou absent : toutes les demandes. Plus de 100 caractères :
-- DONNEES_INVALIDES (lib/filtres.ts ignore déjà un tel texte).

create function public.rechercher_demandes(p_texte text)
returns setof public.demandes_liste
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_texte text := btrim(coalesce(p_texte, ''));
  v_motif text;
begin
  -- Même règle que la RLS de lecture : rien pour un compte qui n'est pas
  -- membre actif (invité, désactivé).
  if not prive.est_membre_actif() then
    return;
  end if;

  if char_length(v_texte) > 100 then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Caractères spéciaux de LIKE cherchés tels quels (échappement par « \ »).
  v_motif := '%'
             || replace(replace(replace(prive.normaliser(v_texte), '\', '\\'), '%', '\%'), '_', '\_')
             || '%';

  return query
    select v.*
      from public.demandes_liste v
     where v.id in (select d.id from public.demandes d where d.recherche like v_motif);
end;
$$;

comment on function public.rechercher_demandes(text) is
  'Lignes de demandes_liste dont la référence, le nom, la société, l''email ou l''objet contient le texte (sans majuscules ni accents). Membres actifs seulement (story 2.5). EXECUTE réservé à authenticated.';

revoke all on function public.rechercher_demandes(text) from public, anon, authenticated, service_role;
grant execute on function public.rechercher_demandes(text) to authenticated;

-- PostgREST : prise en compte immédiate de la nouvelle fonction.
notify pgrst, 'reload schema';
