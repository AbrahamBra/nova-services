# Prompts de la formation

Consignes fournies par les séquences de la formation, conservées pour les réutiliser et pour le document « Méthode IA ».

## Séquence 4 — Créer le PRD

```text
Utilise bmad-prd pour créer le PRD de mon projet à partir du cahier des charges ci-dessous.

Je suis débutant : explique les termes simplement.

Pour éviter une longue série de questions :
- pose-moi tes questions par groupes de 3 maximum, en 3 tours au plus ;
- pour chaque question, propose une réponse par défaut que je peux accepter ou corriger ;
- pour tout ce qui reste flou, fais des hypothèses raisonnables et signale-les clairement.

Identifie :
- les utilisateurs ;
- leurs besoins ;
- les fonctionnalités obligatoires ;
- les règles métier importantes ;
- les limites du MVP.

Prévois des critères de réussite observables pour les principales fonctionnalités.

Distingue clairement les exigences présentes dans le cahier des charges de tes hypothèses.

Crée et enregistre les documents nécessaires dans le projet, puis présente-moi le PRD pour validation.

Ne commence pas le développement.

Voici le cahier des charges :
[Coller ici le cahier des charges ou le challenge]
```

## Séquence 4 — Valider le PRD

```text
Valide le PRD avec bmad-prd.

Signale les oublis, contradictions et hypothèses non confirmées.

Explique simplement les corrections proposées, puis mets le document à jour après ma validation.
```

## Séquence 5 — Créer l'UX

```text
Utilise bmad-ux pour créer l'UX de mon projet, avec le fast path.

Pars de mon PRD validé. Je suis débutant : explique les termes simplement.

Pour aller vite :
- pose-moi un seul tour de 5 questions maximum ;
- pour chaque question, propose une réponse par défaut que je peux accepter ou corriger ;
- pour tout le reste, fais des hypothèses raisonnables et signale-les clairement à part ;
- pas d'exercices créatifs, pas de relecture par des sous-agents.

Crée :
- DESIGN.md : couleurs, typographie, boutons et composants principaux ;
- EXPERIENCE.md : les parcours clés, le contenu de chaque écran, et les états (vide, chargement, erreur, complet) ;
- les maquettes des 3 écrans clés.

Ne code pas l'application. Présente-moi le résultat pour validation.
```

## Séquence 5 — Créer l'architecture

```text
Utilise bmad-architecture pour créer l'architecture de mon projet.

Pars de mon PRD et de mon UX validés. Je suis débutant : explique les termes simplement,
et justifie chaque choix technique en une phrase que je peux comprendre.

Pour aller vite :
- pose-moi un seul tour de 5 questions maximum ;
- pour chaque question, propose une réponse par défaut que je peux accepter ou corriger ;
- pour tout le reste, fais des hypothèses raisonnables et signale-les clairement à part.

Mes contraintes : [votre budget] et [le nombre de membres ou d'utilisateurs attendus].

Crée architecture.md avec :
- la stack retenue, et pourquoi chaque outil a été choisi ;
- le découpage en briques, et ce que fait chacune ;
- les données principales et leurs liens ;
- les règles communes : comptes, droits d'accès, gestion des erreurs ;
- l'hébergement, et ce que ça coûte au démarrage.

Ne code pas l'application. Présente-moi le résultat pour validation.
```

## Séquence 5 — Valider l'architecture

```text
Valide l'architecture avec bmad-architecture.

Vérifie que chaque fonctionnalité du PRD et chaque écran de l'UX ont leur brique.

Dis-moi en langage simple, sans jargon :
- ce que ces choix imposent pour la suite ;
- ce qui coûtera de l'argent, et à partir de quand ;
- ce qui serait difficile à changer plus tard.

Signale les hypothèses non confirmées, puis mets le document à jour après ma validation.
```

## Séquence 6 — Créer les epics et les stories

```text
Découpe mon projet en epics et en stories, avec BMAD.

Pars de mon PRD, de mon UX et de mon architecture validés.

Pour que je puisse tout relire :
- écris chaque story en français simple, du point de vue de l'utilisateur
  (« En tant que [qui], je veux [quoi], pour [pourquoi] ») ;
- donne à chaque story 2 à 4 critères d'acceptation vérifiables à l'écran ;
- pose-moi un seul tour de 3 questions maximum, avec une réponse proposée pour chacune.

Le plus important pour moi : [la fonction sans laquelle l'appli ne servirait à rien].

Classe les epics par priorité, et dis-moi clairement ce qui peut attendre.

Crée le document epics.md. Ne code rien pour l'instant.
```

## Séquence 6 — Vérifier que le projet est prêt pour la construction

```text
Vérifie que mon projet est prêt pour la construction.

- Chaque story vient-elle bien du PRD, de l'UX ou de l'architecture ?
- Chaque story a-t-elle des critères d'acceptation vérifiables ?
- Manque-t-il un écran, une donnée ou une règle pour réaliser une story ?

Propose-moi un ordre de construction, de la story la plus utile à la moins utile.

Explique les manques en langage simple, et propose une solution pour chacun.

Mets epics.md à jour après ma validation.
```

## Séquence 7 — Construire une story

```text
Construis la story 1.1 de mon projet, avec BMAD.

Relis d'abord le PRD, l'UX, l'architecture et la story elle-même.

Ne construis que cette story : rien d'autre, même si tu vois quoi faire ensuite.

Respecte la stack et les règles décidées dans l'architecture.

Lance l'application pour que je puisse la regarder.

Dis-moi en français, sans jargon, ce que tu as fait, puis donne-moi la liste
des critères que je dois vérifier à l'écran.

Ne sauvegarde pas encore : j'ai d'abord besoin de vérifier.
```

## Séquence 7 — Corriger après vérification à l'écran

```text
Voici ce que j'ai vérifié à l'écran pour la story 1.1 :
- ce que j'ai fait : [votre geste]
- ce que je vois : [le résultat obtenu]
- ce que j'attendais : [le critère de la story]

Corrige uniquement ce point, sans toucher au reste.

Puis redis-moi quels critères je dois revérifier.

Quand tout est bon : sauvegarde la story avec un message clair.

Ne commence pas la story suivante sans mon accord.
```

## Séquence 8 — Tester et sécuriser l'application

Texte du support remis en ordre (l'original était un extrait de PDF mélangé).

### Ce qu'on teste, et dans cet ordre

1. Le parcours principal : l'enchaînement sans lequel l'appli ne sert à rien.
2. Les règles qui comptent (exemple du cours : une réservation enlève une place, pas deux).
3. Les états prévus par l'UX : complet, erreur réseau, liste vide.

Un test rouge est une bonne nouvelle : il a trouvé un écart entre ce qui était décidé et ce qui existe. On corrige le code, jamais le test. Supprimer un test qui échoue, c'est cacher le problème.

### Prompt 1 — Écrire les tests de tout le projet

À lancer une fois que deux ou trois stories sont terminées.

```text
Écris les tests automatiques de tout mon projet, avec BMAD.

Parcours toutes les stories déjà construites.
Un test par critère d'acceptation, pas plus.
Teste aussi les états prévus dans l'UX : complet, erreur, vide.
Donne à chaque test un nom en français, lisible par moi.
Range les tests par story, pour que je m'y retrouve.

Lance tout, et explique en français chaque test qui échoue.
Ne corrige rien tant que je n'ai pas décidé.
```

Pour une story construite plus tard :

```text
Ajoute les tests de la story 2.1, de la même façon que les autres, puis relance tout.
```

Avant chaque sauvegarde (c'est ce geste qui attrape les régressions) :

```text
Relance tous les tests du projet, et dis-moi en français lesquels échouent et pourquoi.
```

### Prompt 2 — L'audit de sécurité

```text
Fais l'audit de sécurité de mon projet, avec BMAD. Je ne suis pas développeur :
explique chaque point en français, sans jargon.

Regarde les six points suivants :
1. Les droits d'accès : qui peut voir quoi, qui peut faire quoi —
   et vérifie que ces règles sont contrôlées côté serveur, pas seulement cachées à l'écran.
2. La connexion : comment on se connecte, et ce qui se passe en cas d'oubli.
3. Les clés et les mots de passe : sont-ils écrits quelque part dans le code ?
4. Les données personnelles : lesquelles sont enregistrées, et pourquoi.
5. Les briques utilisées : y en a-t-il d'anciennes, avec des failles connues ?
6. La sauvegarde des données : que récupère-t-on si tout s'efface ?

Classe ce que tu trouves : grave, à corriger, ou acceptable pour un petit projet.
Pour chaque point : ce que c'est, ce que ça risque concrètement, et ce que tu proposes.

Ne corrige rien pour l'instant.
```

### Prompt 3 — Corriger, un point à la fois

```text
Corrige uniquement le point [numéro], le plus grave, sans toucher au reste.
Explique-moi en français ce que tu as changé, et pourquoi le problème est réglé.
Vérifie que les droits sont contrôlés côté serveur, et pas seulement masqués à l'écran.
Puis relance tous les tests et dis-moi si quelque chose s'est cassé.
Quand tout est vert : sauvegarde, avec un message clair.
```

Puis on recommence avec le point suivant.

### À retenir

- **Cacher n'est pas interdire.** Ne pas afficher un bouton n'empêche personne d'agir : qui connaît l'adresse contourne l'écran. La règle doit être vérifiée côté serveur, là où sont les données.
- **Données personnelles :** ne demander que l'utile ; dire ce qu'on garde, en une phrase simple dans l'application ; permettre la suppression.
- **Rythme :** tests relancés après chaque story et avant chaque sauvegarde ; audit de sécurité une fois par semaine, et toujours avant de montrer l'application à quelqu'un.

## Séquence 9 — Mettre l'application en ligne

Texte du support remis en ordre (l'original était un extrait de PDF mélangé).

### La liste d'avant-vol (avant de publier, pas après)

- Tous les tests sont au vert, pas « presque tous ».
- L'audit de sécurité est passé, et ses points graves sont corrigés.
- Les fausses données sont parties (essais, utilisateurs inventés).
- Les clés sont chez l'hébergeur, pas dans le code.
- Les documents lus par l'assistant sont à jour.
- La version publiée est sauvegardée.

### Prompt 1 — Mettre en ligne

```text
Mets mon application en ligne, avec BMAD.

Avant tout : relance tous les tests et dis-moi s'ils sont au vert. Si l'un échoue, arrête-toi.

Propose-moi un hébergeur adapté à ma stack, gratuit pour démarrer, et explique ton choix en une phrase.

Je ne suis pas développeur : guide-moi pas à pas, en français, sans supposer que je sais faire.

Dis-moi quelles clés je dois recopier, et exactement où les coller chez l'hébergeur.

Publie d'abord une version accessible seulement par lien, pas référencée publiquement.

Donne-moi l'adresse obtenue, et la liste de ce que je dois vérifier dessus.

Explique-moi comment publier une correction plus tard, et comment revenir en arrière.
```

### Prompt 2 — Publier une correction à partir d'un retour

```text
Voici un retour d'utilisateur : « … »

Transforme-le en story, avec 2 à 3 critères vérifiables à l'écran.
Montre-la-moi avant de construire : je veux la valider.
Puis construis-la seule, sans toucher au reste.
Relance tous les tests, et dis-moi s'ils sont tous au vert.
Publie la nouvelle version, et dis-moi son numéro.
Explique-moi comment revenir à la version précédente si ça se passe mal.
```

### Le groupe pilote

- Trois personnes, pas trois cents, bienveillantes mais pas complaisantes.
- Leur donner une mission précise (exemple pour Nova : « dépose une demande, puis retrouve-la côté équipe »), jamais « dis-moi ce que tu en penses ».
- Les regarder faire sans rien expliquer : chaque hésitation est un défaut d'expérience à corriger.
- Retour « c'est pas clair » → demander « qu'est-ce que tu cherchais, et où l'as-tu cherché ? » → en faire une story avec ses critères.

### Les trois erreurs de la mise en ligne

1. Annoncer à tout le monde d'un coup : trente personnes découvrent le même défaut en même temps.
2. Publier sans relancer les tests : la correction de la veille a pu casser autre chose.
3. Publier juste avant de partir : un problème arrive toujours quand personne ne peut corriger.

### Une fois en ligne, chaque semaine

L'adresse répond · le nombre de visites · les erreurs (la colonne qui compte) · le coût du mois.

### La boucle

Un retour → une story avec ses critères → on construit cette seule chose → tous les tests au vert → on publie.
