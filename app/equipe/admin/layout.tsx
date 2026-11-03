import { AccesRefuse } from "@/components/nova/acces-refuse";
import { lireProfil } from "@/lib/session";

// Mise en page de l'administration (AD-28) : réservée aux administrateurs
// actifs, lus dans `membres` (AD-3). Les actions d'administration
// revérifient elles-mêmes le rôle (AD-1).
export default async function MiseEnPageAdmin({ children }: LayoutProps<"/equipe/admin">) {
  const profil = await lireProfil();
  // Erreur ou session sans membre actif : la mise en page parente s'en charge.
  if (!profil.ok || profil.donnees === null) return null;
  if (!profil.donnees.estAdmin) return <AccesRefuse />;
  return children;
}
