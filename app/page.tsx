import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireDepot } from "@/components/formulaire-depot";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { formaterDuree } from "@/lib/format";
import { lireInfosPubliques } from "@/lib/infos-publiques";

// Formulaire public « Déposer une demande » (EXPERIENCE.md §9.1).
// Jamais mise en cache : les catégories et les paramètres peuvent changer, et
// chaque affichage reçoit une nouvelle clé d'envoi.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Déposer une demande — Nova Services",
};

export default async function Accueil() {
  const infos = await lireInfosPubliques();

  return (
    <>
    <main className="mx-auto w-full max-w-[560px] flex-1 px-4 py-6 md:px-8 md:py-10">
      <header>
        <p className="text-lg font-semibold leading-[1.4] text-primary">
          {infos.ok ? infos.donnees.nomAffiche : "Nova Services"}
        </p>
      </header>

      <h1 className="mt-5 text-2xl font-semibold leading-[1.3]">Déposer une demande</h1>

      {infos.ok ? (
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Notre équipe vous répond au plus vite. Les champs sans mention sont obligatoires.
          </p>
          <FormulaireDepot
            categories={infos.donnees.categories}
            emailContact={infos.donnees.emailContact}
            dureeConservation={formaterDuree(infos.donnees.dureeConservationMois)}
            // Clé anti-doublon, nouvelle à chaque affichage (AD-26).
            cleEnvoi={crypto.randomUUID()}
          />
        </>
      ) : (
        <div
          role="alert"
          className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{infos.message}</p>
          <BoutonReessayer />
        </div>
      )}
    </main>

    {/* Pied de page : accès discret à l'espace équipe (EXPERIENCE.md §9.1). */}
    <footer className="mx-auto w-full max-w-[560px] px-4 pb-6 md:px-8">
      <div className="border-t border-border pt-4 text-center">
        <Link
          href="/connexion"
          className="inline-flex min-h-11 items-center rounded-sm px-2 text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Espace équipe
        </Link>
      </div>
    </footer>
    </>
  );
}
