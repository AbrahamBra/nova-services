import Link from "next/link";
import { Bouton } from "@/components/nova/bouton";
import { PAGE_MOT_DE_PASSE_OUBLIE } from "@/lib/schemas/mot-de-passe";

// Bouton « Demander un nouveau lien » (story 4.3) : affiché sous « Ce lien
// n'est plus valable. » quand un lien de réinitialisation est refusé
// (invalide, expiré, déjà utilisé ou remplacé). Mène à /mot-de-passe-oublie.
// L'invitation garde « … Contactez votre administrateur. », sans bouton.

export function DemanderNouveauLien({ className }: { className?: string }) {
  return (
    <Bouton asChild className={className}>
      <Link href={PAGE_MOT_DE_PASSE_OUBLIE}>Demander un nouveau lien</Link>
    </Bouton>
  );
}
