---
title: 'Story 3.5 — Revenir à la version précédente (essai réel)'
type: 'chore'
created: '2026-11-06'
status: 'done'
baseline_commit: '23de91510bd04fb1cb9c4313b5552ad200e633b1'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/docs/exploitation/deploiement.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem :** si une mise en ligne casse le site, personne n'a encore essayé de remettre la version d'avant, et la procédure n'est pas écrite.

**Approach :** mettre en ligne une petite version `v1.0.1` (numéro de version et carnet de la story 3.1, sans changement de fonctionnement ni de base), puis faire l'essai réel avec Abraham : « Publish deploy » de la version `v1.0.0` sur Netlify, vérifier « Version v1.0.0 » et un dépôt, puis revenir à `v1.0.1` et réactiver la publication automatique. Écrire la procédure, la date et le résultat dans `docs/exploitation/retour-arriere.md`.

## Boundaries & Constraints

**Always :**
- `package.json` (et les deux entrées racine de `package-lock.json`) passent à `1.0.1` ; la demande de fusion n° 7 (carnet et spec 3.1) part avec, pour une seule mise en ligne (15 crédits Netlify).
- Sauvegarde nocturne lancée à la main avant la fusion (règle 4 du guide) ; aucune migration dans cette version.
- Fusion de la demande seulement avec l'accord d'Abraham ; étiquette `v1.0.1` posée sur `main` après la fusion.
- Essai : Netlify → *Deploys* → déploiement de production `main@e980271` (v1.0.0) → *Publish deploy*. Vérifier en production : « Version v1.0.0 » en bas des pages internes (connexion administrateur), et un dépôt de contrôle accepté (nom « Contrôle retour arrière », objet « Contrôle v1.0.0 »).
- Puis revenir : *Publish deploy* sur le déploiement `v1.0.1`, et **déverrouiller la publication automatique** (« Unlock to start auto publishing » / « Start auto publishing »), sans quoi les fusions suivantes ne seraient plus publiées.
- `docs/exploitation/retour-arriere.md` : procédure pas à pas (quand l'utiliser, publier la version précédente, vérifier, ce qu'on ne peut pas défaire : la base n'est pas remise en arrière — d'où la règle « on ajoute d'abord, on retire à la version suivante » —, déverrouiller ensuite, limite de 30 jours), puis « Essai réel » avec date, durée et résultat.
- Carnet IA : ligne 3.5.

**Never :** aucun code applicatif, aucune migration, aucune modification de la base de production pendant l'essai (hors la demande de contrôle).

</frozen-after-approval>

## Implementation Notes

- La publication d'un déploiement existant ne reconstruit rien : elle ne coûte pas de crédits de construction.
- Les deux demandes de contrôle restent en production comme demandes réelles (effacement : epic 5).
- 06/11/2026 : essai réel réussi (14 h 48 → 14 h 57), voir `docs/exploitation/retour-arriere.md`. La publication automatique n'a pas été verrouillée par Netlify.
