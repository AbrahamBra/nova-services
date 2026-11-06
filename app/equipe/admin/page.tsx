import type { Metadata } from "next";
import { redirect, RedirectType } from "next/navigation";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { lireProfil } from "@/lib/session";

// Accueil de l'administration : renvoie l'administrateur vers « Comptes »
// (story 4.1, première rubrique). Un non-administrateur voit le refus, à
// cette adresse. La page de test du suivi des erreurs reste accessible par
// son adresse (/equipe/admin/test-erreur).
export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return { title: admin ? "Comptes — Nova Services" : "Accès refusé — Nova Services" };
}

export default async function AccueilAdmin() {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  // Revérifié ici : une mise en page n'est pas recalculée à chaque navigation.
  if (!profil.donnees.estAdmin) return <AccesRefuse />;
  redirect("/equipe/admin/comptes", RedirectType.replace);
}
