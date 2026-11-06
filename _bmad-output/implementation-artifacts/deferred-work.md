# Travail reporté

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-installer-le-socle.md` (TRAITÉ en story 1.2)
  summary: Envelopper le bouton shadcn aux règles de DESIGN.md (coins 6 px, survol `--primary-hover`, couleurs secondaires).
  evidence: Le bouton généré utilise `rounded-lg` (8 px) et `hover:bg-primary/80` ; à traiter en story 1.2, premier bouton à l'écran.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-installer-le-socle.md`
  summary: (TRAITÉ en story 1.5) Étendre `tests/securite/droits-anon.test.ts` aux droits par colonne.
  evidence: La story 1.5 accorde des droits par colonne sur `membres` ; le test actuel ne les voit pas.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-installer-le-socle.md`
  summary: Vérifier que le garde-fou d'environnement est bien branché dans Vitest et l'ajouter à Playwright.
  evidence: Seule la fonction est testée ; Playwright n'a pas de garde-fou (sans risque tant que les pages n'utilisent pas la base).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-afficher-le-formulaire-de-depot.md` (TRAITÉ en story 1.3)
  summary: Compteur de description : signaler le dépassement de 5 000 caractères et compter les caractères comme le serveur (emojis).
  evidence: Le compteur compte des unités UTF-16 et n'alerte pas au-delà de la limite ; à aligner avec la validation Zod de la story 1.3.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-afficher-le-formulaire-de-depot.md`
  summary: Mettre à jour `parametres.mis_a_jour_le` à chaque modification.
  evidence: La colonne n'a qu'une valeur par défaut ; à gérer dans `modifier_parametres` (story 5.3).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-envoyer-ma-demande.md`
  summary: Test navigateur du double clic sur « Envoyer ma demande » (une seule demande créée).
  evidence: L'idempotence par `cle_envoi` est testée en base et le bouton est désactivé, mais aucun test ne double-clique.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-envoyer-ma-demande.md`
  summary: Tester la branche d'erreur de la page de confirmation (`lireConfirmation` en échec → bandeau « Réessayer »).
  evidence: Aucun test ne couvre `lib/confirmation.ts` en échec.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-me-connecter-espace-equipe.md`
  summary: Tester les chemins d'échec de la connexion avec un client simulé (erreur Auth, `mon_profil` en échec, `signOut` en échec).
  evidence: Les tests actuels utilisent la vraie base ; la story 1.9 modifie la même action.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-me-connecter-espace-equipe.md`
  summary: Menu mobile : bloquer le défilement et rendre la page inerte quand le panneau est ouvert ; rubrique active par préfixe.
  evidence: Accessibilité du panneau incomplète ; sous-pages de l'administration à venir (epic 4).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-voir-toutes-les-demandes.md`
  summary: Test automatique et isolé de `donnees:remplir` (40 lignes, relance sans doublon, historique).
  evidence: Vérifié à la main seulement ; un test sur la base partagée gênerait les autres tests.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-voir-toutes-les-demandes.md`
  summary: (TRAITÉ en story 1.6) Liste : la colonne Responsable déborde à 1 440 px (défilement horizontal) ; resserrer les colonnes.
  evidence: Constaté sur capture à 1 440 px de large avec le menu ouvert.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-email-de-confirmation.md`
  summary: Créer le compte Resend, renseigner `RESEND_API_KEY` et `EMAILS_AUTORISES` dans `.env.local`, puis vérifier la réception réelle de l'email (critère 1 de la story 1.7).
  evidence: Reporté par Abraham ; le mode démonstration fonctionne sans clé. À faire avant la mise en ligne (story 3.1).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-bloquer-les-envois-en-masse.md`
  summary: Les empreintes d'IP ne sont effacées qu'au dépôt suivant ; sans trafic, elles restent au-delà d'une heure.
  evidence: le delete est dans deposer_demande, après un dépôt accepté ; une purge planifiée (pg_cron ou tâche Supabase) garantirait AD-23.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-bloquer-les-envois-en-masse.md`
  summary: En IPv6, chaque adresse d'un même client compte à part (pas de regroupement /64 ni de normalisation de l'écriture).
  evidence: lireAdresseIp passe la chaîne brute au HMAC ; un client IPv6 peut changer d'adresse dans son préfixe pour contourner la limite.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-bloquer-les-envois-en-masse.md`
  summary: HMAC_SECRET à poser sur Netlify (tous les contextes) et alerte si absent ; vérifier x-nf-client-connection-ip sur une prévisualisation.
  evidence: sans secret en production, chaque dépôt renvoie ERREUR_INATTENDUE avec une simple trace console ; sans secret en prévisualisation, chaque instance tire sa propre clé (story 3.1, 3.3).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-securiser-la-connexion.md`
  summary: La limite de 8 h n'est appliquée que par proxy.ts ; les jetons restent utilisables directement auprès de Supabase.
  evidence: rien dans la base ne lit l'horodatage `amr` ; la limite de session de Supabase est réservée à l'offre payante.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-securiser-la-connexion.md`
  summary: Le compte d'un membre peut être bloqué volontairement par n'importe qui ; le journal n'indique pas quel membre, et il n'y a pas de déblocage.
  evidence: la ligne de journal `connexion_bloquee` n'a ni email ni identifiant ; aucune action d'administration ne lève un blocage.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-securiser-la-connexion.md`
  summary: Ajouter `tentatives_connexion` (plus d'un jour) et `envois_formulaire` (plus d'une heure) à `purger_technique`.
  evidence: l'effacement n'a lieu qu'à la connexion ou au dépôt suivant (AD-23).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-ajouter-une-note.md`
  summary: Le refus du serveur dans le formulaire de note (et le bouton de prise en charge) n'est pas testé à l'écran.
  evidence: aucun test ne fait renvoyer `ok: false` à l'action depuis un composant client ; il faudrait un montage de test de composant (Testing Library) ou un refus forcé en e2e.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-sauvegarder-chaque-nuit.md`
  summary: Documenter que GitHub suspend les tâches planifiées après 60 jours sans activité (sauvegarde et réveil), avec un rappel de surveillance.
  evidence: Limite de l'offre gratuite (epic-3-context) ; à écrire dans la fiche de maintenance, story 3.6.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-sauvegarder-chaque-nuit.md`
  summary: Épingler les actions GitHub par empreinte de commit dans toutes les tâches qui voient des secrets.
  evidence: `tests.yml`, `sauvegarde-nocturne.yml` et `reveil.yml` utilisent des étiquettes mobiles (`@v4`, `@v1`).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-sauvegarder-chaque-nuit.md`
  summary: Sortir la garde d'adresse et le choix de l'environnement de la sauvegarde dans un script exécuté par un test (5 cas).
  evidence: Le test actuel ne lit que le texte du fichier ; un `||` changé en `&&` passerait. À faire avec l'ajout de `purger_technique`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-sauvegarder-chaque-nuit.md`
  summary: Vérifier que `donnees.sql` contient bien les comptes (`auth.users`) — non vérifié.
  evidence: Si absents, les membres restaurés n'auraient pas de compte ; à prouver pendant la restauration réelle (story 3.4).

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-suivre-les-erreurs.md`
  summary: Vérifier en production (Netlify) que les erreurs arrivent dans Sentry sans perte (flush des fonctions) et en un seul exemplaire.
  evidence: Non vérifiable en développement ; critère « moins de 5 minutes » à refaire en story 3.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-suivre-les-erreurs.md`
  summary: Au build Netlify, nommer la version Sentry comme `NEXT_PUBLIC_APP_VERSION`, supprimer les cartes du code source après envoi, et n'envoyer que si org et projet sont remplis.
  evidence: `withSentryConfig` n'est actif qu'avec `SENTRY_AUTH_TOKEN` sur Netlify (story 3.1).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-suivre-les-erreurs.md`
  summary: Envoyer aussi à Sentry les erreurs imprévues qui ne passent pas par `appeler()` (`lib/session.ts`, `lib/demandes.ts`, `lib/detail-demande.ts`, `lib/actions/demandes.ts`).
  evidence: Elles ne laissent qu'une ligne de console ; `lib/actions/` était interdit à cette session.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-mettre-en-ligne.md`
  summary: Tester `db:push --production` jusqu'à l'appel de la CLI (adresse transmise, option `--production` retirée des arguments).
  evidence: La CLI est résolue par `require.resolve` ; il faudrait exposer la liste des arguments ou simuler la CLI.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-mettre-en-ligne.md`
  summary: Vérifier en CI que l'étiquette `vX.Y.Z` d'une mise en ligne est égale à la version de `package.json`.
  evidence: Règle écrite dans `docs/exploitation/deploiement.md`, appliquée à la main pour l'instant.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-priorite-et-categorie.md`
  summary: Sur ordinateur, les toasts en bas à droite recouvrent la liste Catégorie du panneau d'actions pendant 5 secondes.
  evidence: capture de la vérification à l'écran (1280 × 720) : deux toasts empilés masquent la liste juste après un changement ; placement conforme à EXPERIENCE.md, à revoir (décalage ou une seule ligne).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-saisir-une-demande.md`
  summary: `FormulaireSaisie` n'a pas de test de composant (synchronisation des réponses, effacement des erreurs, garde du double clic).
  evidence: aucun banc de test de composants client dans le projet ; seul le navigateur couvre ce formulaire.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-liberer-ou-attribuer.md`
  summary: Les états « Liste des membres indisponible. » et « Aucun autre membre actif. » de la fenêtre d'attribution n'ont pas de test.
  evidence: difficile à provoquer contre la base partagée ; un test unitaire de `actionsPermises` avec lectures simulées suffirait.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-8-tableau-de-bord.md`
  summary: « Copier le lien » (tableau de bord vide) n'a aucun test au clic : adresse copiée (`origin + "/"`) et libellés « Lien copié » / « Copie impossible ».
  evidence: l'état vide est inatteignable sur la base partagée des tests navigateur, et vitest tourne en environnement `node` (pas de banc de composants).

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-inviter-un-membre.md`
  summary: Deux invitations simultanées de la même adresse (ou une horloge serveur en avance de plus de 2 min) peuvent remplacer le jeton du premier lien, voire supprimer un compte Auth créé par l'autre appel.
  evidence: non vérifié (medium s'il est réel) ; à trancher par un test qui lance deux `inviter` en parallèle sur la même adresse, et corriger par un verrou par adresse (advisory lock) avant `generateLink`.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-modifier-desactiver-reactiver.md`
  summary: Désactiver et réactiver le même compte au même instant peut laisser un compte actif dans la base mais bloqué dans Auth.
  evidence: non vérifié (medium s'il est réel) ; désactiver = base puis Auth, réactiver = Auth puis base ; à trancher par un test qui entrelace les deux actions, corriger en relisant l'état avant d'agir sur Auth ou en sérialisant.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-modifier-desactiver-reactiver.md`
  summary: La branche DERNIER_ADMIN de modifier_membre et desactiver_membre n'est jamais exécutée par un test.
  evidence: non vérifié (medium s'il est réel) ; inatteignable sur la base partagée ; à prouver sur une base locale jetable (supabase start) où les seuls administrateurs sont des comptes de test.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-modifier-desactiver-reactiver.md`
  summary: Une prise en charge au même instant qu'une désactivation peut laisser une demande En cours au nom d'un compte désactivé.
  evidence: non vérifié (medium s'il est réel) ; `prendre_en_charge` ne verrouille pas la ligne `membres` ; à corriger par un `for share` sur le membre dans `prendre_en_charge`.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-restaurer-une-sauvegarde.md`
  summary: Faire écrire `effacer_demandeur` (epic 5) dans `effacements`, avec un test, puis refaire l'essai de restauration après la story 5.4 en vérifiant un vrai rejeu.
  evidence: Le registre n'est rempli par rien aujourd'hui ; seul un commentaire de la migration le rappelle.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-restaurer-une-sauvegarde.md`
  summary: Sortir le comptage des lignes et la comparaison de « Restauration de test » dans un script testé par Vitest avec un `donnees.sql` d'exemple.
  evidence: Le test actuel ne lit que le texte du fichier ; la première exécution réelle sert de vérification.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-restaurer-une-sauvegarde.md`
  summary: Épingler `supabase/setup-cli` par empreinte de commit dans les tâches qui voient `SAUVEGARDE_PHRASE`.
  evidence: Même report que pour la story 3.2.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-mot-de-passe-oublie.md`
  summary: Le toast d'erreur de « Générer un lien de mot de passe » (compte désactivé entre-temps, panne) n'est vérifié par aucun test.
  evidence: `BoutonLienMotDePasse` (components/nova/comptes/actions-compte.tsx) ; seuls les codes de refus de l'action sont testés ; à couvrir si un test de toasts est écrit pour ce fichier.
