import Link from "next/link";

// Bouton principal « Saisir une demande » (story 2.6 : en haut de la liste ;
// story 2.8 : en haut à droite du tableau de bord), lien vers la saisie
// interne. Pleine largeur sur téléphone.
const CLASSE_LIEN_SAISIR =
  "inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-[15px] font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-hover focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto";

export function LienSaisirDemande() {
  return (
    <Link href="/equipe/demandes/nouvelle" className={CLASSE_LIEN_SAISIR}>
      Saisir une demande
    </Link>
  );
}
