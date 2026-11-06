-- Story 4.1 (correction) — vérifier qu'une adresse est libre AVANT de créer
-- le compte Auth d'une invitation.
--
-- Constat sur nova-dev : `auth.admin.generateLink({ type: "invite" })` sur
-- l'adresse d'un compte Auth existant NON confirmé (invitation en attente)
-- ne renvoie pas d'erreur : il renvoie CE compte existant avec un nouveau
-- jeton (l'ancien lien devient invalide). Seul un compte confirmé donne
-- `email_exists`. L'action `inviter` vérifie donc d'abord l'adresse ici, et
-- ne supprime jamais un compte qu'elle n'a pas créé.
--
-- Erreur prévue : EMAIL_DEJA_UTILISE (adresse présente dans `membres` ou
-- dans `auth.users`, casse ignorée).

create function public.verifier_email_libre(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email, E' \t\n\r\f\v'));
begin
  -- Droit : EXECUTE réservé à service_role (aucun contrôle de session ici).
  if v_email is null or v_email = '' then
    raise exception using errcode = 'P0001', message = 'DONNEES_INVALIDES';
  end if;

  if exists (select 1 from public.membres m where m.email = v_email)
     or exists (select 1 from auth.users u where lower(u.email) = v_email)
  then
    raise exception using errcode = 'P0001', message = 'EMAIL_DEJA_UTILISE';
  end if;

  return jsonb_build_object('libre', true);
end;
$$;

comment on function public.verifier_email_libre(text) is
  'EMAIL_DEJA_UTILISE si l''adresse est déjà dans membres ou auth.users (avant une invitation). EXECUTE réservé à service_role.';

revoke all on function public.verifier_email_libre(text) from public, anon, authenticated, service_role;
grant execute on function public.verifier_email_libre(text) to service_role;
