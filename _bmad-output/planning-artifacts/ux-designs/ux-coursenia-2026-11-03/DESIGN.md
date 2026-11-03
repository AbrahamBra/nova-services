---
name: Nova Services
description: Application de gestion des demandes clients de Nova Services. shadcn/ui sur Next.js + Tailwind ; ce DESIGN.md ne précise que la couche aux couleurs de Nova.
status: final
created: 2026-11-03
updated: 2026-11-03
sources:
  - ../../prds/prd-coursenia-2026-11-03/prd.md
colors:
  # Couche Nova par-dessus les valeurs par défaut de shadcn.
  # Les jetons non listés (popover, card, input…) gardent les valeurs shadcn.
  primary: '#1E3A8A'
  primary-foreground: '#FFFFFF'
  primary-hover: '#1E40AF'
  background: '#F8FAFC'
  surface: '#FFFFFF'
  foreground: '#0F172A'
  muted-foreground: '#64748B'
  border: '#E2E8F0'
  ring: '#2563EB'
  destructive: '#B91C1C'
  status-nouvelle-bg: '#DBEAFE'
  status-nouvelle-fg: '#1E40AF'
  status-encours-bg: '#FFEDD5'
  status-encours-fg: '#9A3412'
  status-traitee-bg: '#DCFCE7'
  status-traitee-fg: '#166534'
  priority-haute-bg: '#FEE2E2'
  priority-haute-fg: '#B91C1C'
  priority-normale-bg: '#F1F5F9'
  priority-normale-fg: '#334155'
  priority-basse-bg: '#F8FAFC'
  priority-basse-fg: '#64748B'
typography:
  # Police unique : Inter. Tailles en px.
  title:
    fontFamily: 'Inter'
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  section:
    fontFamily: 'Inter'
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body:
    fontFamily: 'Inter'
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: 'Inter'
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  small:
    fontFamily: 'Inter'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
  reference:
    fontFamily: 'ui-monospace, Consolas, monospace'
    fontSize: 14px
    fontWeight: '500'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  # Échelle Tailwind par défaut (4, 8, 12, 16, 24, 32, 48), aucune modification.
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    hover: '{colors.primary-hover}'
    radius: '{rounded.md}'
  button-destructive:
    background: '{colors.destructive}'
    foreground: '#FFFFFF'
    radius: '{rounded.md}'
  badge-status:
    radius: '{rounded.full}'
    typography: '{typography.small}'
  badge-priority:
    radius: '{rounded.sm}'
    typography: '{typography.small}'
  sidebar:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
  card:
    background: '{colors.surface}'
    border: '{colors.border}'
    radius: '{rounded.lg}'
---

## Brand & Style

Nova Services est une entreprise de services numériques pour des professionnels. L'application doit inspirer **confiance et sérieux** : un client qui dépose une demande doit sentir qu'elle est prise au sérieux, et l'équipe doit lire l'état de son travail d'un coup d'œil.

Le style est **sobre et professionnel** : beaucoup de blanc, un seul bleu marine pour l'identité, et la couleur réservée à ce qui a un sens (statuts et priorité Haute). Le logo est le texte « Nova Services » en `{typography.section}`, couleur `{colors.primary}` ; il n'y a pas d'image de logo.

L'application utilise **shadcn/ui** (une bibliothèque gratuite de composants pour Next.js). Ce document ne précise que ce qui change par rapport à shadcn : les couleurs de Nova, la police et quelques composants propres à l'application. Tout le reste reprend shadcn tel quel.

## Colors

- **Bleu marine Nova (`#1E3A8A`)** — couleur principale : boutons principaux, liens, menu latéral de l'espace équipe, logo. Au survol, `#1E40AF`.
- **Fond (`#F8FAFC`) et surfaces (`#FFFFFF`)** — les pages ont un fond gris très clair ; les cartes, tableaux et formulaires sont blancs avec une bordure `#E2E8F0`.
- **Texte (`#0F172A`) et texte secondaire (`#64748B`)** — le secondaire sert aux dates, aides et libellés de colonnes.
- **Couleurs de statut** (toujours avec le texte du statut, jamais seules) :
  - Nouvelle : texte `#1E40AF` sur fond `#DBEAFE` (bleu) ;
  - En cours : texte `#9A3412` sur fond `#FFEDD5` (orange) ;
  - Traitée : texte `#166534` sur fond `#DCFCE7` (vert).
- **Priorité** : Haute en rouge (`#B91C1C` sur `#FEE2E2`) ; Normale et Basse en gris, pour que seul l'urgent ressorte.
- **Rouge d'action destructrice (`#B91C1C`)** — uniquement pour effacer ou désactiver.
- **Contour de focus (`#2563EB`)** — visible autour de l'élément sélectionné au clavier.

Toutes les paires texte/fond respectent un contraste d'au moins 4,5:1 (norme WCAG AA). Pas de mode sombre.

## Typography

Une seule police : **Inter**, très lisible à l'écran et gratuite.

| Rôle | Taille / graisse | Usage |
|---|---|---|
| `title` | 24 px, semi-gras | Titre de page (« Demandes », « Déposer une demande ») |
| `section` | 18 px, semi-gras | Titre de bloc (« Historique », « Notes internes ») |
| `body` | 15 px | Texte courant, champs, cellules du tableau |
| `label` | 14 px, moyen | Libellés des champs, boutons |
| `small` | 13 px | Dates, aides sous les champs, badges |
| `reference` | 14 px, chasse fixe | Référence des demandes (`NOVA-2026-0042`), pour qu'elle soit facile à recopier |

## Layout & Spacing

Échelle d'espacement Tailwind par défaut (multiples de 4 px).

- **Pages publiques** (formulaire, confirmation, connexion) : une colonne centrée de 560 px maximum, pensée d'abord pour le téléphone.
- **Espace équipe** : menu latéral de 240 px à gauche, contenu jusqu'à 1 200 px. En dessous de 1 024 px de large, le menu se replie derrière un bouton « Menu » en haut.
- Marges de page : 16 px sur téléphone, 32 px sur ordinateur.

## Elevation & Depth

Valeurs shadcn : ombre légère sur les cartes et les fenêtres de confirmation, aucune autre profondeur.

## Shapes

Coins `{rounded.md}` (6 px) pour les boutons et les champs, `{rounded.lg}` (8 px) pour les cartes et les fenêtres. Les **badges de statut** sont arrondis en pilule (`{rounded.full}`) ; les **badges de priorité** ont des coins légers (`{rounded.sm}`), pour ne pas les confondre avec les statuts.

## Components

Composants shadcn utilisés tels quels : `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Card`, `Table`, `Dialog`, `AlertDialog`, `DropdownMenu`, `Toast`, `Skeleton`, `Pagination`, `Badge`, `Separator`.

Composants propres à Nova :

- **Bouton principal** — fond `{colors.primary}`, texte blanc, coins `{rounded.md}`. Un seul bouton principal par écran.
- **Bouton destructeur** — fond `{colors.destructive}` ; utilisé seulement dans les fenêtres de confirmation (désactiver, effacer, purger).
- **Badge de statut** — pilule aux couleurs du statut, toujours avec le mot (« Nouvelle », « En cours », « Traitée »).
- **Badge de priorité** — rectangle léger ; « Haute » en rouge, « Normale » et « Basse » en gris.
- **Référence** — texte `{typography.reference}`, avec un bouton « Copier » à côté sur l'écran de confirmation.
- **Menu latéral** — fond `{colors.primary}`, texte blanc ; l'élément actif a un fond blanc à 15 % d'opacité. Le compteur de nouvelles demandes est une pastille blanche à texte bleu marine.
- **Ligne d'historique** — date et heure en `{typography.small}` gris, puis le nom en gras et l'action.
- **Version** — en bas de chaque page interne, en `{typography.small}` gris (« Version v1.0.0 »).

## Do's and Don'ts

| À faire | À éviter |
|---|---|
| Garder les composants shadcn tels quels, aux couleurs Nova | Redessiner les boutons, champs ou fenêtres |
| Réserver la couleur aux statuts et à la priorité Haute | Colorer des éléments décoratifs |
| Toujours écrire le statut en toutes lettres dans le badge | Indiquer un statut par la seule couleur |
| Un seul bouton principal par écran | Plusieurs boutons bleus qui se disputent l'attention |
| Rouge uniquement pour les actions destructrices et la priorité Haute | Rouge pour des messages d'information |
