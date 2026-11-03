# Rapport de validation — architecture Nova Services

- **Document :** `architecture.md`
- **Date :** 2026-11-03
- **Contrôle mécanique (lint_spine) :** 0 constat
- **Relecteurs :** grille et couverture (`review-rubric.md`), vérification sur le web (`review-verification.md`), avocat du diable (`review-adversarial.md`)
- **Bilan :** structure saine ; à corriger avant le découpage en stories. 5 constats critiques (dont 2 doublons), environ 21 hauts, environ 27 moyens et 15 bas, avec beaucoup de recoupements.

## Verdict

Le principe « serveur d'abord, sécurité dans la base » et les règles AD-4, AD-6, AD-7, AD-8 et AD-10 tiennent. Les faiblesses sont de trois ordres :

1. **Sécurité de la base** : les fonctions SQL sont appelables par n'importe quel visiteur avec la clé publique, ce qui contourne l'anti-spam. Elles manquent aussi de garde-fous (`search_path`, droits par défaut de Supabase, vues qui ignorent RLS).
2. **Promesses non tenues par les offres gratuites** (vérifiées sur les documentations officielles) :
   - Supabase ne propose ni blocage après 5 échecs ni session limitée à 8 h en offre gratuite ;
   - les liens d'email ont une seule durée de validité commune, plafonnée à environ 24 h ;
   - Netlify Free coupe le site quand les crédits du mois sont épuisés ;
   - Sentry envoie par défaut des données personnelles ;
   - les anciennes clés Supabase seront retirées fin 2026 ;
   - Next.js 16 a renommé `middleware.ts` en `proxy.ts` et active un nouveau mode de cache par défaut ;
   - la sauvegarde depuis GitHub doit passer par le « pooler » (IPv4).
3. **Points sans propriétaire** entre stories :
   - codes de statut, de priorité et de canal ;
   - format de l'historique et du journal ;
   - remontée des erreurs SQL ;
   - création de la ligne `membres` ;
   - envoi et suivi des emails ;
   - purges planifiées et fuseau horaire ;
   - lecture commune liste / tableau de bord ;
   - double clic, gardes de pages, règle « au moins un admin », registre des effacements pour la restauration, données de départ en production.

## Couverture PRD / UX → briques

Couvert : la plupart des FR, la version affichée, la purge manuelle, FR-23 reporté.

Manquants ou incomplets :
- purges du journal (1 an) et des IP (1 h) ;
- blocage après échecs et session de 8 h ;
- invitations (renvoyer, annuler, passage invité → actif) ;
- **page de confirmation** (aucune lecture permise au visiteur) ;
- gardes de pages ;
- refaire les effacements après une restauration ;
- règle 8 ;
- réactivation et modification d'un compte ;
- fonctions des catégories et des paramètres ;
- état de l'email de confirmation et email de la saisie interne ;
- trace du renommage d'une catégorie ;
- alerte Sentry ;
- environnement de test de restauration ;
- NFR-6, NFR-7 et l'audit des dépendances (NFR-9).

## Décisions qui reviennent à Abraham

1. **Durée des liens d'email** : Supabase n'a qu'un réglage commun (≤ 24 h) pour l'invitation et le mot de passe. Proposé : 24 h pour les deux, avec « Renvoyer l'invitation » ; le PRD (FR-7 et FR-8) est mis à jour en conséquence.
2. **Crédits Netlify** : grouper les mises en ligne (environ 10 par mois au maximum) et vérifier les crédits chaque semaine. Plan B : passer à l'offre payante de Netlify.

## Corrections proposées (après accord)

Nouvelles règles AD-15 à AD-27 et règles existantes durcies : voir la présentation à Abraham et les trois fichiers de revue pour le détail.

*La version HTML prévue par BMAD n'a pas été générée ; ce fichier est la version de référence.*
