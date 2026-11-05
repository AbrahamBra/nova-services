-- Story 2.5 — corrections de la recherche (relecture de la migration 0018).
--
-- 1. `pg_trgm` : son schéma réel est vérifié ; s'il a été installé ailleurs
--    que dans `extensions`, il y est déplacé (l'index nomme
--    `extensions.gin_trgm_ops`).
-- 2. `prive.normaliser` : toutes les lettres accentuées (décomposition NFD
--    puis retrait des signes diacritiques combinants, Ș et ț compris),
--    ligatures œ, æ, ß développées, lettres sans décomposition (ł, ø, đ, ħ,
--    ı, ŧ) ramenées à leur base ; tirets et apostrophes remplacés par une
--    espace (« Dupont Aïdi » trouve « Dupont-Aïdi ») ; espaces répétées
--    réduites à une seule, sans espace au début ni à la fin. Même traitement
--    côté application : `normaliserRecherche` (lib/filtres.ts), testé contre
--    cette fonction.
--    La colonne générée `demandes.recherche` est recréée pour être recalculée
--    avec la nouvelle fonction (une colonne générée stockée n'est pas
--    recalculée quand sa fonction change), avec son index trigrammes.
-- 3. Recherche en deux temps, pour que la RLS réelle s'applique :
--    - `ids_demandes_recherche(p_texte)` (SECURITY DEFINER, seule à lire
--      `recherche`) : rien pour un compte qui n'est pas membre actif
--      (vérifié en premier), sinon les SEULS identifiants des demandes dont
--      `recherche` contient le texte normalisé ;
--    - `rechercher_demandes(p_texte)` devient une fonction SQL ordinaire
--      (SECURITY INVOKER, sans réglage) : les lignes de la vue
--      `demandes_liste` (security_invoker, RLS des tables appliquée) dont
--      l'identifiant est dans cette liste. PostgreSQL l'insère dans la
--      requête de PostgREST : filtres, tri, comptage et pagination
--      s'appliquent à la vue, sans résultat intermédiaire complet.
--    EXECUTE des deux à `authenticated` seulement.

-- 1. Extension pg_trgm dans le schéma `extensions` ---------------------------

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

-- 2. Normalisation et colonne recalculée -------------------------------------

-- La colonne (et son index) dépendent de la fonction : retirées d'abord.
alter table public.demandes drop column recherche;

create or replace function prive.normaliser(p_texte text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          normalize(
            translate(
              replace(replace(replace(lower(normalize(p_texte, NFC)), 'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'),
              'łøđħıŧ',
              'lodhit'
            ),
            NFD
          ),
          '[̀-ͯ]', '', 'g'
        ),
        '[-''‐‑‒–—‘’]', ' ', 'g'
      ),
      '[ \t\n\r\f\v  ]+', ' ', 'g'
    )
  );
$$;

comment on function prive.normaliser(text) is
  'Texte de recherche : minuscules, sans accents, tirets et apostrophes en espaces, espaces réduites (story 2.5). Immuable : utilisée par la colonne générée demandes.recherche.';

revoke all on function prive.normaliser(text) from public, anon, authenticated, service_role;

alter table public.demandes
  add column recherche text not null
  generated always as (
    prive.normaliser(
      reference || ' ' || nom || ' ' || coalesce(societe, '') || ' '
      || coalesce(email, '') || ' ' || objet
    )
  ) stored;

comment on column public.demandes.recherche is
  'Référence, nom, société, email et objet normalisés (prive.normaliser). Lue seulement par ids_demandes_recherche.';

create index demandes_recherche_trgm_idx
  on public.demandes using gin (recherche extensions.gin_trgm_ops);

-- 3. Recherche ---------------------------------------------------------------

create function public.ids_demandes_recherche(p_texte text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_texte text := btrim(coalesce(p_texte, ''));
  v_motif text;
begin
  -- Rien pour un compte qui n'est pas membre actif (invité, désactivé).
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
    select d.id from public.demandes d where d.recherche like v_motif;
end;
$$;

comment on function public.ids_demandes_recherche(text) is
  'Identifiants des demandes dont la référence, le nom, la société, l''email ou l''objet contient le texte (normalisé). Membres actifs seulement (story 2.5). EXECUTE réservé à authenticated.';

revoke all on function public.ids_demandes_recherche(text) from public, anon, authenticated, service_role;
grant execute on function public.ids_demandes_recherche(text) to authenticated;

-- SQL ordinaire, sans SECURITY DEFINER ni réglage : insérée dans la requête
-- appelante (lecture de la vue avec les droits de la personne connectée).
create or replace function public.rechercher_demandes(p_texte text)
returns setof public.demandes_liste
language sql
stable
security invoker
as $$
  select v.*
    from public.demandes_liste v
   where v.id in (select public.ids_demandes_recherche(p_texte));
$$;

comment on function public.rechercher_demandes(text) is
  'Lignes de demandes_liste (RLS appliquée) trouvées par ids_demandes_recherche (story 2.5). EXECUTE réservé à authenticated.';

revoke all on function public.rechercher_demandes(text) from public, anon, authenticated, service_role;
grant execute on function public.rechercher_demandes(text) to authenticated;

-- PostgREST : prise en compte immédiate des fonctions.
notify pgrst, 'reload schema';
