# Travail reporté

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-installer-le-socle.md` (TRAITÉ en story 1.2)
  summary: Envelopper le bouton shadcn aux règles de DESIGN.md (coins 6 px, survol `--primary-hover`, couleurs secondaires).
  evidence: Le bouton généré utilise `rounded-lg` (8 px) et `hover:bg-primary/80` ; à traiter en story 1.2, premier bouton à l'écran.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-installer-le-socle.md`
  summary: Étendre `tests/securite/droits-anon.test.ts` aux droits par colonne.
  evidence: La story 1.5 accorde des droits par colonne sur `membres` ; le test actuel ne les voit pas.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-installer-le-socle.md`
  summary: Vérifier que le garde-fou d'environnement est bien branché dans Vitest et l'ajouter à Playwright.
  evidence: Seule la fonction est testée ; Playwright n'a pas de garde-fou (sans risque tant que les pages n'utilisent pas la base).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-afficher-le-formulaire-de-depot.md`
  summary: Compteur de description : signaler le dépassement de 5 000 caractères et compter les caractères comme le serveur (emojis).
  evidence: Le compteur compte des unités UTF-16 et n'alerte pas au-delà de la limite ; à aligner avec la validation Zod de la story 1.3.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-afficher-le-formulaire-de-depot.md`
  summary: Mettre à jour `parametres.mis_a_jour_le` à chaque modification.
  evidence: La colonne n'a qu'une valeur par défaut ; à gérer dans `modifier_parametres` (story 5.3).
