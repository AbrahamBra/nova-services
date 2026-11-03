# Addendum PRD — notes techniques pour la suite

## Piste vue en cours (séquence 2, Supabase)

- Les rôles des comptes peuvent être stockés dans les métadonnées applicatives de Supabase Auth (`raw_app_meta_data`, ex. `{"role": "admin"}`), modifiables seulement côté serveur.
- Les droits sont appliqués dans la base par des politiques RLS (Row Level Security : règles qui filtrent les lignes selon qui est connecté).
- À décider dans l'architecture (séquence 5).
