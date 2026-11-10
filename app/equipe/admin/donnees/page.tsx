import type { Metadata } from "next";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { EffacementDemandeur } from "@/components/nova/donnees/effacement-demandeur";
import { EnTeteDonnees } from "@/components/nova/donnees/en-tete-donnees";
import { lireProfil } from "@/lib/session";

// Page « Données personnelles » (story 5.4) : bloc « Droit à l'effacement »
// (recherche des demandes d'une personne par son email, puis effacement
// définitif). L'adresse reste /equipe/admin/donnees, sans paramètre :
// l'email passe par une action serveur. Réservée aux administrateurs : la
// mise en page de l'administration la garde, la page le revérifie, et
// chaque action et fonction SQL le vérifie aussi.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return {
    title: admin ? "Données personnelles — Nova Services" : "Accès refusé — Nova Services",
  };
}

export default async function PageDonnees() {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  if (!profil.donnees.estAdmin) return <AccesRefuse />;

  return (
    <div className="max-w-5xl">
      <EnTeteDonnees />
      <EffacementDemandeur />
    </div>
  );
}
