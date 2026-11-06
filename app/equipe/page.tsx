import { Suspense } from "react";
import type { Metadata } from "next";
import { LienSaisirDemande } from "@/components/nova/lien-saisir";
import {
  ContenuTableauDeBord,
  SqueletteTableauDeBord,
} from "@/components/nova/tableau-de-bord";
import { lireProfil } from "@/lib/session";

// Tableau de bord de l'espace équipe (story 2.8, EXPERIENCE.md §9.3), qui
// remplace l'accueil minimal : « Bonjour [prénom] » (premier mot du nom),
// « Saisir une demande » en haut à droite, puis les cinq cartes chiffrées et
// « Mes demandes en cours ». Les chiffres sont lus dans un Suspense : les
// squelettes des cartes s'affichent pendant la lecture (pas de loading.tsx
// à ce niveau, qui s'appliquerait aussi aux sous-pages). Jamais mis en cache
// (mise en page en force-dynamic), pas de rafraîchissement automatique.
export const metadata: Metadata = {
  title: "Accueil — Nova Services",
};

export default async function AccueilEquipe() {
  const profil = await lireProfil();
  // La mise en page affiche l'erreur ou renvoie vers la connexion.
  if (!profil.ok || profil.donnees === null) return null;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold leading-[1.3]">Bonjour {profil.donnees.prenom}</h1>
        <LienSaisirDemande />
      </div>
      <Suspense fallback={<SqueletteTableauDeBord />}>
        <ContenuTableauDeBord />
      </Suspense>
    </>
  );
}
