import type { Metadata } from "next";
import { lireProfil } from "@/lib/session";

// Accueil de l'espace équipe (EXPERIENCE.md §9.3, version minimale) :
// « Bonjour [prénom] », le prénom étant le premier mot du nom. Le tableau de
// bord chiffré arrive à la story 2.8.
export const metadata: Metadata = {
  title: "Accueil — Nova Services",
};

export default async function AccueilEquipe() {
  const profil = await lireProfil();
  // La mise en page affiche l'erreur ou renvoie vers la connexion.
  if (!profil.ok || profil.donnees === null) return null;

  return <h1 className="text-2xl font-semibold leading-[1.3]">Bonjour {profil.donnees.prenom}</h1>;
}
