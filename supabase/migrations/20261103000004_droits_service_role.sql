-- Story 1.3 (correctif) — La clé secrète n'écrit ni ne lit les tables directement
-- (AD-4, AD-5, AD-6).
--
-- `service_role` contourne RLS et garde par défaut tous les droits sur les
-- tables de `public`. Les données ne doivent pourtant changer que par les
-- fonctions SQL (toutes en SECURITY DEFINER, propriétaire postgres : elles
-- continuent de fonctionner). On retire donc à `service_role` tout droit
-- direct sur ces tables ; l'historique ne peut plus être effacé ou vidé à la main.

revoke select, insert, update, delete, truncate, references, trigger
  on table public.demandes,
           public.historique,
           public.compteurs_reference,
           public.categories,
           public.parametres
  from service_role;

-- Séquence de l'identifiant de l'historique : aucun usage direct non plus.
revoke all on sequence public.historique_id_seq from service_role;
