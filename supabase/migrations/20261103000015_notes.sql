-- Story 2.2 — Notes internes (AD-4, AD-5, AD-15, AD-19, AD-20).
--
-- Crée :
--   - la table `notes` (demande, auteur, texte, date), en ajout seulement :
--     RLS activée, lecture colonne par colonne pour les membres actifs (comme
--     `historique`, migration 20261103000008), aucun droit d'écriture direct,
--     pour personne (clé secrète comprise) ;
--   - un déclencheur qui refuse UPDATE, DELETE et TRUNCATE. Seule exception :
--     la suppression en cascade avec la demande (effacement complet, epic 5),
--     reconnue à ce que la demande n'existe déjà plus. Voulu, comme pour le
--     journal : `TRUNCATE demandes CASCADE` est refusé (il viderait `notes`
--     par TRUNCATE) ; l'effacement complet de l'epic 5 supprime les demandes
--     ligne par ligne (DELETE), ce qui emporte leurs notes ;
--   - `ajouter_note(p_demande_id, p_texte)` : en un seul bloc, la note et une
--     ligne d'historique `note_ajoutee` (auteur : le membre), SANS le texte
--     de la note (AD-19). Possible quel que soit le statut.
--
-- Erreurs prévues (P0001) :
--   DROIT_INSUFFISANT   pas un membre actif (première instruction) ;
--   DEMANDE_INTROUVABLE identifiant inconnu ;
--   DONNEES_INVALIDES   texte vide (après retrait des espaces de début et de
--                       fin), fait seulement d'espaces Unicode (U+00A0,
--                       U+3000, U+FEFF…), ou de plus de 2 000 caractères.
-- « Au moins un caractère visible » : même règle dans la contrainte CHECK,
-- dans la fonction et dans le schéma Zod (lib/schemas/traitement.ts).
-- EXECUTE accordé à `authenticated` seulement.

-- 1. Table des notes -------------------------------------------------------

create table public.notes (
  id         bigint      generated always as identity primary key,
  demande_id uuid        not null references public.demandes (id) on delete cascade,
  auteur_id  uuid        not null references public.membres (id),
  -- Texte tel que saisi, sans espaces de début et de fin (retirés par ajouter_note).
  texte      text        not null
                         check (texte = btrim(texte, E' \t\n\r\f\v')
                                and char_length(texte) between 1 and 2000
                                -- Au moins un caractère qui n'est pas un espace,
                                -- espaces Unicode compris (même règle qu'ajouter_note).
                                and texte ~ '[^\s\u0085\u00a0\u1680\u180e\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]'),
  cree_le    timestamptz not null default now()
);

comment on table public.notes is
  'Notes internes de l''équipe, en ajout seulement (AD-5). Écrites uniquement par ajouter_note ; jamais modifiées ni supprimées, sauf en cascade avec la demande.';

create index notes_demande_id_idx on public.notes (demande_id, cree_le);

alter table public.notes enable row level security;

-- Aucun droit direct, pour personne (la clé secrète non plus).
revoke all on table public.notes from public, anon, authenticated, service_role;
revoke all on sequence public.notes_id_seq from public, anon, authenticated, service_role;

-- Lecture par les membres actifs, colonne par colonne.
create policy notes_lecture_membres_actifs
  on public.notes
  for select
  to authenticated
  using ((select prive.est_membre_actif()));

grant select (id, demande_id, auteur_id, texte, cree_le) on public.notes to authenticated;

-- 2. Ajout seulement ------------------------------------------------------
-- UPDATE et TRUNCATE : toujours refusés. DELETE : refusé tant que la demande
-- existe ; la suppression en cascade (la demande vient d'être effacée dans
-- la même commande) passe.

create function prive.refuser_modification_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- `old` n'est lu que pour DELETE (vide pour TRUNCATE, déclencheur d'instruction).
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.demandes d where d.id = old.demande_id) then
      return old;
    end if;
  end if;
  raise exception 'Les notes internes ne se modifient pas et ne se suppriment pas.';
end;
$$;

comment on function prive.refuser_modification_notes() is
  'Refuse UPDATE, DELETE et TRUNCATE sur notes, sauf la suppression en cascade avec la demande (AD-5).';

revoke all on function prive.refuser_modification_notes()
  from public, anon, authenticated, service_role;

create trigger notes_ajout_seulement
  before update or delete on public.notes
  for each row execute function prive.refuser_modification_notes();

create trigger notes_vidage_refuse
  before truncate on public.notes
  for each statement execute function prive.refuser_modification_notes();

-- 3. Ajout d'une note -----------------------------------------------------

create function public.ajouter_note(p_demande_id uuid, p_texte text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre uuid := auth.uid();
  -- Espaces retirés en début et fin (comme le trim de Zod pour l'ASCII).
  v_blancs constant text := E' \t\n\r\f\v';
  v_texte  text := btrim(p_texte, v_blancs);
  v_id     bigint;
  v_cree_le timestamptz;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  -- Demande verrouillée contre l'effacement jusqu'à la fin de la transaction.
  perform 1 from public.demandes d where d.id = p_demande_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  if v_texte is null
     or char_length(v_texte) not between 1 and 2000
     -- Même règle que la contrainte CHECK : au moins un caractère visible.
     or v_texte !~ '[^\s\u0085\u00a0\u1680\u180e\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]'
  then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  insert into public.notes (demande_id, auteur_id, texte)
  values (p_demande_id, v_membre, v_texte)
  returning id, cree_le into v_id, v_cree_le;

  -- Jamais le texte de la note dans l'historique (AD-19).
  perform prive.ecrire_historique(p_demande_id, 'note_ajoutee', v_membre, null, null);

  return jsonb_build_object(
    'id',         v_id,
    'demande_id', p_demande_id,
    'auteur_id',  v_membre,
    'cree_le',    v_cree_le
  );
end;
$$;

comment on function public.ajouter_note(uuid, text) is
  'Note interne d''un membre actif sur une demande, avec une ligne d''historique note_ajoutee sans le texte (story 2.2). EXECUTE réservé à authenticated.';

revoke all on function public.ajouter_note(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.ajouter_note(uuid, text) to authenticated;

-- PostgREST : prise en compte immédiate de la table et de la fonction.
notify pgrst, 'reload schema';
