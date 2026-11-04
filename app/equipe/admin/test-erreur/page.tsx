import type { Metadata } from "next";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { lireProfil } from "@/lib/session";
import { FormulaireErreurTest } from "./formulaire";

// Page de test du suivi des erreurs (story 3.3, OPS-1), réservée à
// l'administrateur : la mise en page de l'administration la garde, la page
// et l'action revérifient le rôle (AD-1, AD-28).
export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return {
    title: admin
      ? "Test du suivi des erreurs — Nova Services"
      : "Accès refusé — Nova Services",
  };
}

export default async function PageTestErreur() {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  if (!profil.donnees.estAdmin) return <AccesRefuse />;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold leading-[1.3]">Test du suivi des erreurs</h1>
      <p className="mt-3 text-[15px] leading-normal text-muted-foreground">
        Ce bouton provoque une erreur volontaire, sans effet sur les demandes. Elle doit apparaître
        dans Sentry en moins de 5 minutes, sans aucune donnée personnelle.
      </p>
      <FormulaireErreurTest />
    </div>
  );
}
