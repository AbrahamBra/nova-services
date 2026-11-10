-- Story 5.3 — Modifier les paramètres généraux (AD-1, AD-19, AD-20).
--
-- Crée :
--   - `lire_parametres_admin()` : nom affiché, email de contact, durée de
--     conservation (mois) et date de mise à jour, pour préremplir la page
--     Paramètres ;
--   - `modifier_parametres(p_nom_affiche, p_email_contact, p_duree_mois)` :
--     vérifie, enregistre et écrit le journal.
--
-- Les deux : SECURITY DEFINER, search_path vide, administrateur actif vérifié
-- en premier (DROIT_INSUFFISANT), EXECUTE à authenticated seulement.
--
-- Valeurs normalisées : nom sans espaces aux extrémités, email sans espaces
-- et en minuscules. Nom vide ou de plus de 150 caractères, email sans la
-- forme x@y.z, durée hors 6–60 mois : DONNEES_INVALIDES.
-- Rien de changé : `{modifie: false}`, aucune écriture (ni journal ni
-- `mis_a_jour_le`). Sinon `mis_a_jour_le` = now() et une ligne de journal
-- `parametre` `{evenement: "parametres_modifies", …}` avec, pour chaque champ
-- changé SEULEMENT, la nouvelle et l'ancienne valeur (nom_affiche /
-- ancien_nom_affiche, email_contact / ancien_email_contact,
-- duree_conservation_mois / ancienne_duree_conservation_mois).
--
-- Le formulaire public (`infos_publiques`), la page de confirmation
-- (`lire_confirmation`) et l'email de confirmation lisent déjà la ligne en
-- direct : rien à changer de leur côté.

-- 1. Lecture (page Paramètres) ---------------------------------------------

create function public.lire_parametres_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resultat jsonb;
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  select jsonb_build_object(
           'nom_affiche',             p.nom_affiche,
           'email_contact',           p.email_contact,
           'duree_conservation_mois', p.duree_conservation_mois,
           'mis_a_jour_le',           p.mis_a_jour_le
         )
    into v_resultat
    from public.parametres p;

  return v_resultat;
end;
$$;

comment on function public.lire_parametres_admin() is
  'Paramètres généraux (nom affiché, email de contact, durée de conservation, mise à jour) pour la page Paramètres (story 5.3). Administrateur actif seulement, sinon DROIT_INSUFFISANT. EXECUTE réservé à authenticated.';

revoke all on function public.lire_parametres_admin() from public, anon, authenticated, service_role;
grant execute on function public.lire_parametres_admin() to authenticated;

-- 2. Modification ------------------------------------------------------------

create function public.modifier_parametres(
  p_nom_affiche   text,
  p_email_contact text,
  p_duree_mois    integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auteur      uuid := auth.uid();
  v_nom         text := btrim(p_nom_affiche, E' \t\n\r\f\v');
  v_email       text := lower(btrim(p_email_contact, E' \t\n\r\f\v'));
  v_ancien_nom   text;
  v_ancien_email text;
  v_ancienne_duree integer;
  v_details     jsonb := jsonb_build_object('evenement', 'parametres_modifies');
begin
  if not prive.est_admin() then
    raise exception using errcode = 'P0001', message = 'DROIT_INSUFFISANT';
  end if;

  if v_nom is null or char_length(v_nom) not between 1 and 150
     or v_email is null or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_duree_mois is null or p_duree_mois not between 6 and 60 then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  -- Deux enregistrements simultanés : le second voit le résultat du premier
  -- (anciennes valeurs exactes au journal).
  select p.nom_affiche, p.email_contact, p.duree_conservation_mois
    into v_ancien_nom, v_ancien_email, v_ancienne_duree
    from public.parametres p
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if v_nom = v_ancien_nom and v_email = v_ancien_email and p_duree_mois = v_ancienne_duree then
    -- Rien ne change : réussite, rien n'est écrit.
    return jsonb_build_object(
      'nom_affiche',             v_nom,
      'email_contact',           v_email,
      'duree_conservation_mois', p_duree_mois,
      'modifie',                 false
    );
  end if;

  if v_nom <> v_ancien_nom then
    v_details := v_details || jsonb_build_object(
      'nom_affiche', v_nom, 'ancien_nom_affiche', v_ancien_nom);
  end if;
  if v_email <> v_ancien_email then
    v_details := v_details || jsonb_build_object(
      'email_contact', v_email, 'ancien_email_contact', v_ancien_email);
  end if;
  if p_duree_mois <> v_ancienne_duree then
    v_details := v_details || jsonb_build_object(
      'duree_conservation_mois', p_duree_mois,
      'ancienne_duree_conservation_mois', v_ancienne_duree);
  end if;

  update public.parametres p
     set nom_affiche             = v_nom,
         email_contact           = v_email,
         duree_conservation_mois = p_duree_mois,
         mis_a_jour_le           = now()
   where p.id;

  perform prive.ecrire_journal('parametre', v_details, v_auteur);

  return jsonb_build_object(
    'nom_affiche',             v_nom,
    'email_contact',           v_email,
    'duree_conservation_mois', p_duree_mois,
    'modifie',                 true
  );
end;
$$;

comment on function public.modifier_parametres(text, text, integer) is
  'Modifie nom affiché (1 à 150 caractères), email de contact (x@y.z, en minuscules) et durée de conservation (6 à 60 mois), sinon DONNEES_INVALIDES (story 5.3). Rien de changé : {modifie: false}, sans journal. Sinon journal parametre « parametres_modifies » avec les seuls champs changés. Administrateur actif seulement. EXECUTE réservé à authenticated.';

revoke all on function public.modifier_parametres(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.modifier_parametres(text, text, integer) to authenticated;

-- PostgREST : prise en compte immédiate des nouvelles fonctions.
notify pgrst, 'reload schema';
