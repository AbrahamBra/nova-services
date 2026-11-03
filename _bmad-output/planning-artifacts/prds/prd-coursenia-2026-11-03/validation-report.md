# Rapport de validation — PRD Nova Services

- **PRD :** `_bmad-output/planning-artifacts/prds/prd-coursenia-2026-11-03/prd.md`
- **Grille :** `.claude/skills/bmad-prd/assets/prd-validation-checklist.md`
- **Date :** 2026-11-03
- **Note :** Passable (*Fair*) selon la grille ; la relecture adverse remonte en plus 3 points critiques.

## Verdict global

Le PRD est solide pour un outil interne : les sources sont tracées, chaque fonction a des critères observables, et le périmètre est honnête. Toutes les fonctions du cahier des charges sont présentes. Les faiblesses se concentrent sur :

1. les **données personnelles** : l'effacement contredit l'historique « jamais effaçable », et la conservation de 2 ans n'a aucun mécanisme de suppression ;
2. la **sécurité de base** : rien n'exige qu'un visiteur anonyme ne puisse rien lire ni modifier, ni ne fixe HTTPS, les mots de passe, les tentatives de connexion ou la protection des textes affichés ;
3. le **cycle de vie** : on peut avoir une demande En cours sans responsable, il est impossible de classer un spam, et les demandes d'un compte désactivé restent orphelines ;
4. le **tableau de bord** renvoie vers des filtres qui n'existent pas ;
5. la **partie exploitation** (OPS, NFR-2 à 5) n'a pas de critères vérifiables, alors que le jury note précisément ces points ;
6. la **saisie par l'équipe des demandes reçues par téléphone** via le formulaire public ne tient pas (consentement, anti-spam, traçabilité).

## Verdicts par dimension (grille)

- Prêt pour décider — solide
- Fond plutôt que façade — solide
- Cohérence stratégique — correcte
- Clarté du « terminé » — correcte
- Honnêteté du périmètre — solide
- Utilisable pour la suite — correcte
- Forme adaptée — solide

## Constats par gravité (fusion des deux relectures)

Le détail complet est dans `review-rubric.md` (grille : 0 critique, 5 hauts, 10 moyens, 7 bas) et `review-adversarial-general.md` (avocat du diable : 3 critiques, 11 hauts, 17 moyens, 12 bas). Les doublons sont regroupés ci-dessous.

### Critique (3)

- **Accès anonyme non encadré** (NFR-1, règle 10, FR-2, SM-4). Rien n'exige qu'un visiteur ne puisse ni lire les demandes ni fixer lui-même statut, priorité, responsable ou référence. Correction : NFR de sécurité avec tests.
- **Effacement contre historique non effaçable** (FR-22, règle 6, FR-17, FR-18, OPS-3). Correction : exception explicite, effacement par personne (email), effet sur les sauvegardes.
- **Conservation de 2 ans sans mécanisme** (§8, FR-4, FR-21). Correction : nouvelle FR « purge des demandes expirées ».

### Haute (regroupée)

- Les hypothèses validées sont toujours marquées « à confirmer » (§0, §12).
- Cycle de vie : passage Nouvelle → En cours sans responsable ; attribution par l'administrateur non définie ; responsable désactivé (règles 1, 2 et 4, FR-9, FR-14, FR-15).
- Le tableau de bord exige des filtres absents de FR-12.
- Saisie téléphone via le formulaire public (§2.2, hypothèse 1).
- Anti-spam : « même connexion » non défini, IP partagée, contrôle côté serveur (FR-5).
- Exploitation sans critères vérifiables (NFR-2 à 5, OPS-1 à 7).
- Sécurité de base absente (HTTPS, mots de passe, tentatives, sessions, injection de script, longueurs).
- Désactivation ou changement de rôle à appliquer immédiatement (FR-9).
- Sauvegardes : faisabilité sur l'offre gratuite, lieu de stockage, durée (OPS-3, OPS-4).
- Service d'email non choisi alors que 3 FR en dépendent (FR-3, FR-7, FR-8).
- Suivi des erreurs et journal non situés ; « administration technique » non définie.

### Moyenne (regroupée)

Correspondance cahier des charges → exigences absente ; version déployée non visible ; retour arrière sans les migrations de base ; journal incomplet ; échec d'email invisible pour l'équipe ; invitations sans expiration ni renvoi ; libérer une demande ; garde-fous des catégories ; spam et doublon ; critère « bouton retour » non fiable ; compteur ambigu ; liste des données personnelles incomplète ; support sans canal ni délai ; contenu de la documentation non défini, pas de trace de l'usage de l'IA ; protocoles de mesure absents ; validation des paramètres ; risque de périmètre trop lourd pour un débutant ; « doublons » de la Vision non traités.

### Basse (regroupée)

Balise [Cours] pour les séquences 8 et 9 ; « qui » pour une création anonyme ; format de la référence ; lien vers l'addendum ; longueurs maximales ; « sauvegarde » contre « commit » ; environnement de mesure ; décision « pas d'email à l'équipe » non reprise ; étiquettes de source ; administrateur seulement invité ; recherche partielle, casse et accents.

## Fichiers des relecteurs

- `review-rubric.md`
- `review-adversarial-general.md`

*La version HTML prévue par BMAD n'a pas été générée ; ce fichier Markdown est la version de référence.*
