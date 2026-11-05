-- Story 2.3 — Marquer traitée, rouvrir, classer sans suite (AD-4, AD-15,
-- AD-19, AD-20, AD-22 ; règle 1 du PRD).
--
-- `prive.texte_note_valide(texte)` : règle unique du texte d'une note
-- (1 à 2 000 caractères, au moins un caractère visible, espaces Unicode
-- compris), utilisée par `ajouter_note` (redéfinie ici, même comportement)
-- et par `classer_sans_suite`. Même classe d'espaces que la contrainte CHECK
-- de `notes` (migration 0015). Aucun droit EXECUTE, pour personne.
--
-- `changer_statut(p_demande_id, p_statut)` : seuls passages permis,
--   En cours → Traitée (responsable inchangé) ;
--   Traitée  → En cours (« Rouvrir ») : responsable inchangé s'il est encore
--              un membre actif (ligne du membre verrouillée en partage contre
--              une désactivation simultanée) ; sinon la demande revient en
--              Nouvelle, sans responsable (règle 1).
-- Tout autre passage, y compris vers le même statut ou un statut inconnu,
-- donne `PASSAGE_INTERDIT` : Nouvelle → En cours passe seulement par la prise
-- en charge (ou l'attribution), En cours → Nouvelle seulement par « Libérer »,
-- Nouvelle → Traitée seulement par le classement sans suite.
-- Une ligne d'historique `changement_statut` (ancien → nouveau statut réel).
-- Renvoie aussi `avait_responsable` (pour le message affiché à la réouverture).
--
-- `classer_sans_suite(p_demande_id, p_note)` : seulement depuis Nouvelle ;
-- en un bloc, la demande passe Traitée sans responsable, la note (raison du
-- classement) est ajoutée aux notes internes et UNE seule ligne d'historique
-- `classement_sans_suite` (`nouvelle` → `traitee`) est écrite, sans le texte
-- de la note (AD-19).
--
-- Lecture de la demande verrouillée (`FOR UPDATE`) avant toute décision :
-- deux changements simultanés s'exécutent l'un après l'autre, le second voit
-- le nouvel état et reçoit `PASSAGE_INTERDIT`. Si la modification ne touche
-- aucune ligne, rien n'est écrit (`PASSAGE_INTERDIT`, transaction annulée).
--
-- Erreurs prévues (P0001) :
--   DROIT_INSUFFISANT   pas un membre actif (première instruction) ;
--   DEMANDE_INTROUVABLE identifiant inconnu ;
--   PASSAGE_INTERDIT    passage non permis depuis le statut actuel ;
--   DONNEES_INVALIDES   note du classement vide ou trop longue.
--
-- `mis_a_jour_le` et `traitee_le` sont écrites par le déclencheur
-- `demandes_dates` (AD-22), jamais par ces fonctions.
-- EXECUTE de `changer_statut` et `classer_sans_suite` à `authenticated` seulement.

-- 1. Règle du texte d'une note ---------------------------------------------

create function prive.texte_note_valide(p_texte text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_texte is not null
     and char_length(p_texte) between 1 and 2000
     -- Au moins un caractère qui n'est pas un espace, espaces Unicode compris.
     and p_texte ~ '[^\s\u0085\u00a0\u1680\u180e\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]';
$$;

comment on function prive.texte_note_valide(text) is
  'Texte d''une note déjà sans espaces de début et de fin : 1 à 2 000 caractères, au moins un caractère visible (story 2.3).';

revoke all on function prive.texte_note_valide(text) from public, anon, authenticated, service_role;

-- 2. ajouter_note, redéfinie avec la règle commune (même comportement) ----

create or replace function public.ajouter_note(p_demande_id uuid, p_texte text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre  uuid := auth.uid();
  v_texte   text;
  v_id      bigint;
  v_cree_le timestamptz;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  -- Espaces retirés en début et fin (comme le trim de Zod pour l'ASCII).
  v_texte := btrim(p_texte, E' \t\n\r\f\v');

  -- Demande verrouillée contre l'effacement jusqu'à la fin de la transaction.
  perform 1 from public.demandes d where d.id = p_demande_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  if not coalesce(prive.texte_note_valide(v_texte), false) then
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

-- Droits inchangés (create or replace les garde) ; réaffirmés par prudence.
revoke all on function public.ajouter_note(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.ajouter_note(uuid, text) to authenticated;

-- 3. Changement de statut -------------------------------------------------

create function public.changer_statut(p_demande_id uuid, p_statut text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre       uuid := auth.uid();
  v_statut       text;
  v_responsable  uuid;
  v_nouveau      text;
  v_nouveau_resp uuid;
  v_lignes       integer;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  select d.statut, d.responsable_id
    into v_statut, v_responsable
    from public.demandes d
   where d.id = p_demande_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  if v_statut = 'en_cours' and p_statut = 'traitee' then
    v_nouveau := 'traitee';
    v_nouveau_resp := v_responsable;
  elsif v_statut = 'traitee' and p_statut = 'en_cours' then
    -- Ligne du membre verrouillée en partage : une désactivation simultanée
    -- attend la fin de cette transaction.
    perform 1 from public.membres m
      where m.id = v_responsable and m.etat = 'actif'
      for share;
    if v_responsable is not null and found then
      v_nouveau := 'en_cours';
      v_nouveau_resp := v_responsable;
    else
      -- Responsable désactivé (ou absent : demande classée sans suite) :
      -- retour en Nouvelle, sans responsable (règle 1).
      v_nouveau := 'nouvelle';
      v_nouveau_resp := null;
    end if;
  else
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  update public.demandes d
     set statut = v_nouveau,
         responsable_id = v_nouveau_resp
   where d.id = p_demande_id
     and d.statut = v_statut;

  get diagnostics v_lignes = row_count;
  if v_lignes <> 1 then
    -- Jamais d'historique sans changement.
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  perform prive.ecrire_historique(p_demande_id, 'changement_statut', v_membre,
                                  v_statut, v_nouveau);
  return jsonb_build_object(
    'id',                p_demande_id,
    'statut',            v_nouveau,
    'responsable_id',    v_nouveau_resp,
    'avait_responsable', v_responsable is not null
  );
end;
$$;

comment on function public.changer_statut(uuid, text) is
  'Passages En cours → Traitée et Traitée → En cours (ou Nouvelle si le responsable n''est plus actif), avec une ligne d''historique (story 2.3). EXECUTE réservé à authenticated.';

revoke all on function public.changer_statut(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.changer_statut(uuid, text) to authenticated;

-- 4. Classement sans suite ------------------------------------------------

create function public.classer_sans_suite(p_demande_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre uuid := auth.uid();
  v_texte  text;
  v_statut text;
  v_note   bigint;
  v_lignes integer;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  -- Espaces retirés en début et fin, comme ajouter_note.
  v_texte := btrim(p_note, E' \t\n\r\f\v');

  select d.statut
    into v_statut
    from public.demandes d
   where d.id = p_demande_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  if v_statut <> 'nouvelle' then
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  if not coalesce(prive.texte_note_valide(v_texte), false) then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  update public.demandes d
     set statut = 'traitee',
         responsable_id = null
   where d.id = p_demande_id
     and d.statut = 'nouvelle';

  get diagnostics v_lignes = row_count;
  if v_lignes <> 1 then
    -- Jamais de note ni d'historique sans changement.
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  insert into public.notes (demande_id, auteur_id, texte)
  values (p_demande_id, v_membre, v_texte)
  returning id into v_note;

  -- Une seule ligne d'historique, jamais le texte de la note (AD-19).
  perform prive.ecrire_historique(p_demande_id, 'classement_sans_suite', v_membre,
                                  'nouvelle', 'traitee');
  return jsonb_build_object(
    'id',                p_demande_id,
    'statut',            'traitee',
    'responsable_id',    null,
    'avait_responsable', false,
    'note_id',           v_note
  );
end;
$$;

comment on function public.classer_sans_suite(uuid, text) is
  'Classement sans suite d''une demande Nouvelle : Traitée sans responsable, note obligatoire, une ligne d''historique (story 2.3). EXECUTE réservé à authenticated.';

revoke all on function public.classer_sans_suite(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.classer_sans_suite(uuid, text) to authenticated;

notify pgrst, 'reload schema';
