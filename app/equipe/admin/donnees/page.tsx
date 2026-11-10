import type { Metadata } from "next";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { DemandesExpirees } from "@/components/nova/donnees/demandes-expirees";
import { EffacementDemandeur } from "@/components/nova/donnees/effacement-demandeur";
import { EnTeteDonnees } from "@/components/nova/donnees/en-tete-donnees";
import { lireExpirees } from "@/lib/expirees";
import { lireProfil } from "@/lib/session";

// Page « Données personnelles » : bloc « Droit à l'effacement » (story 5.4 :
// recherche des demandes d'une personne par son email, puis effacement
// définitif), puis bloc « Demandes expirées » (story 5.5 : nombre de demandes
// traitées depuis plus que la durée de conservation, lu au chargement, et
// leur suppression). L'adresse reste /equipe/admin/donnees, sans paramètre :
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

  const expirees = await lireExpirees();

  return (
    <div className="max-w-5xl">
      <EnTeteDonnees />
      <div className="space-y-6">
        <EffacementDemandeur />
        <DemandesExpirees initiales={expirees.ok ? expirees.donnees : null} />
      </div>
    </div>
  );
}
