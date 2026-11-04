-- Story 2.1 — Prendre en charge une demande (AD-4, AD-15, AD-19, AD-20).
--
-- `prendre_en_charge(p_demande_id)` : en un seul bloc, le membre connecté
-- devient responsable d'une demande Nouvelle sans responsable, la demande
-- passe En cours et UNE ligne d'historique est écrite (`prise_en_charge`,
-- `nouvelle` → `en_cours`, règle 6 du PRD).
--
-- Simultanéité : la ligne est lue avec `FOR UPDATE` avant toute décision.
-- Deux appels en même temps : le second attend le verrou, relit la ligne
-- déjà modifiée et reçoit `DEJA_PRISE` (avec le nom du responsable dans le
-- détail JSON). La modification reste conditionnelle (Nouvelle et sans
-- responsable).
--
-- Idempotente pour le responsable : s'il la reprend (onglet ancien, double
-- clic), l'état actuel est renvoyé comme une réussite, sans nouvelle ligne
-- d'historique.
--
-- Erreurs prévues (P0001) :
--   DROIT_INSUFFISANT   pas un membre actif (première instruction) ;
--   DEMANDE_INTROUVABLE identifiant inconnu ;
--   DEJA_PRISE          demande En cours d'un autre membre, détail {"responsable": "<nom>"} ;
--   PASSAGE_INTERDIT    demande Traitée (ou Nouvelle avec un responsable).
--
-- `mis_a_jour_le` est écrite par le déclencheur `demandes_dates` (AD-22),
-- seul endroit qui écrit cette date.
-- EXECUTE accordé à `authenticated` seulement.

create function public.prendre_en_charge(p_demande_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membre      uuid := auth.uid();
  v_statut      text;
  v_responsable uuid;
  v_nom         text;
begin
  if not prive.est_membre_actif() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  -- Ligne verrouillée jusqu'à la fin de la transaction : personne ne la
  -- change entre la lecture et la décision.
  select d.statut, d.responsable_id
    into v_statut, v_responsable
    from public.demandes d
   where d.id = p_demande_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEMANDE_INTROUVABLE';
  end if;

  -- Déjà responsable : réussite, rien n'est écrit.
  if v_statut = 'en_cours' and v_responsable = v_membre then
    return jsonb_build_object(
      'id',             p_demande_id,
      'statut',         'en_cours',
      'responsable_id', v_membre
    );
  end if;

  if v_statut = 'en_cours' then
    select m.nom into v_nom from public.membres m where m.id = v_responsable;
    raise exception using
      errcode = 'P0001',
      message = 'DEJA_PRISE',
      detail  = jsonb_build_object('responsable', v_nom)::text;
  end if;

  if v_statut <> 'nouvelle' or v_responsable is not null then
    raise exception using errcode = 'P0001', message = 'PASSAGE_INTERDIT';
  end if;

  update public.demandes d
     set statut = 'en_cours',
         responsable_id = v_membre
   where d.id = p_demande_id
     and d.statut = 'nouvelle'
     and d.responsable_id is null;

  perform prive.ecrire_historique(p_demande_id, 'prise_en_charge', v_membre,
                                  'nouvelle', 'en_cours');
  return jsonb_build_object(
    'id',             p_demande_id,
    'statut',         'en_cours',
    'responsable_id', v_membre
  );
end;
$$;

comment on function public.prendre_en_charge(uuid) is
  'Prise en charge d''une demande Nouvelle par le membre connecté : responsable, En cours, une ligne d''historique (story 2.1). EXECUTE réservé à authenticated.';

revoke all on function public.prendre_en_charge(uuid) from public, anon, authenticated, service_role;
grant execute on function public.prendre_en_charge(uuid) to authenticated;
