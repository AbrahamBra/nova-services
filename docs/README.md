# Documentation de Nova Services

Fiches courtes pour faire fonctionner l'application, aider l'équipe et répondre aux questions de sécurité, même sans Abraham. Les parties marquées « À compléter », suivies du numéro de la story ou de « fin de projet », attendent une étape du projet qui n'est pas encore faite. L'installation sur un poste de développement est décrite dans le [README du projet](../README.md).

| Document | À quoi il sert |
|---|---|
| [exploitation/deploiement.md](exploitation/deploiement.md) | Mettre une nouvelle version en ligne : règles, réglages Netlify, variables, crédits. |
| [exploitation/maintenance.md](exploitation/maintenance.md) | Sauvegarde nocturne, réveil des bases, mises à jour, migrations, limites des offres gratuites. |
| [exploitation/indisponibilite.md](exploitation/indisponibilite.md) | Que faire, étape par étape, quand l'application ne répond plus. |
| [exploitation/restauration.md](exploitation/restauration.md) | Remettre la base dans l'état d'une sauvegarde (story 3.4). |
| [exploitation/retour-arriere.md](exploitation/retour-arriere.md) | Remettre en ligne la version précédente (story 3.5). |
| [support.md](support.md) | Qui aide qui, dans quel délai : support en deux niveaux, avec trois cas d'exemple. |
| [securite.md](securite.md) | Accès, secrets, mots de passe, et que faire si un secret a fuité. |
| [protection-des-donnees.md](protection-des-donnees.md) | Données personnelles gardées, pourquoi, combien de temps, où. |
| [carnet-ia.md](carnet-ia.md) | Carnet d'usage de l'IA : ce que l'IA a produit, ce qu'Abraham a vérifié et corrigé. |
| [cahier-des-charges.md](cahier-des-charges.md) | Sujet de départ de la formation. |
| [prompts-formation.md](prompts-formation.md) | Consignes utilisées pendant la formation. |

## Limites connues de ce premier jet

- Un seul responsable technique (Abraham), sans suppléant.
- La phrase qui déchiffre les sauvegardes est détenue par lui seul.
- Lui seul a accès aux tableaux de bord Netlify, Supabase, GitHub, Resend et Sentry.

À compléter (fin de projet) : désigner un suppléant et ranger une copie scellée de la phrase de sauvegarde.
