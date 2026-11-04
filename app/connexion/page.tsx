import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireConnexion } from "@/components/formulaire-connexion";
import { redirect } from "next/navigation";
import { adresseDeRetour } from "@/lib/schemas/connexion";
import { PARAMETRE_EXPIREE } from "@/lib/supabase/proxy";
import { lireProfil } from "@/lib/session";

// Page « Connexion » (EXPERIENCE.md §9.12) : colonne centrée, logo, un
// formulaire court. Pas d'inscription libre ni de mot de passe oublié
// (epic 4). L'adresse de retour n'est suivie que si elle commence par
// `/equipe` (AD-28). Story 1.9 : `?expiree=1` (posé par proxy.ts après
// 8 h de session) affiche « Votre session a expiré. Reconnectez-vous. ».
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connexion — Nova Services",
  robots: { index: false, follow: false },
};

export default async function PageConnexion({ searchParams }: PageProps<"/connexion">) {
  const parametres = await searchParams;
  const adresse = adresseDeRetour(parametres.retour);
  const expiree = parametres[PARAMETRE_EXPIREE] === "1";

  // Membre actif déjà connecté : directement vers la page demandée. Une
  // session sans membre actif reste sur le formulaire (pas de boucle).
  const profil = await lireProfil();
  if (profil.ok && profil.donnees !== null) redirect(adresse);

  return (
    <main className="mx-auto w-full max-w-[400px] flex-1 px-4 py-10 md:py-16">
      <header>
        <Link
          href="/"
          className="rounded-sm text-lg font-semibold leading-[1.4] text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Nova Services
        </Link>
      </header>

      <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">Connexion</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Espace réservé à l&apos;équipe.</p>

      <FormulaireConnexion retour={adresse} sessionExpiree={expiree} />
    </main>
  );
}
