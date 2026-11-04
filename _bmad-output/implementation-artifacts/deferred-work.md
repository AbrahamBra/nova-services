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
