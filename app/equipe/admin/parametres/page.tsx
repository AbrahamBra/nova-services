import type { Metadata } from "next";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { EnTeteParametres } from "@/components/nova/parametres/en-tete-parametres";
import { FormulaireParametres } from "@/components/nova/parametres/formulaire-parametres";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireParametresAdmin } from "@/lib/parametres-admin";
import { lireProfil } from "@/lib/session";

// Page « Paramètres » (story 5.3) : nom affiché, email de contact et durée de
// conservation montrés aux demandeurs, avec l'aperçu de la phrase du
// formulaire public. Réservée aux administrateurs : la mise en page de
// l'administration la garde, la page le revérifie et
// `lire_parametres_admin()` le vérifie en base.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return { title: admin ? "Paramètres — Nova Services" : "Accès refusé — Nova Services" };
}

export default async function PageParametres() {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  if (!profil.donnees.estAdmin) return <AccesRefuse />;

  const parametres = await lireParametresAdmin();
  // Refus de la base (rôle changé entre-temps) : le refus seul, comme ci-dessus.
  if (!parametres.ok && parametres.code === "DROIT_INSUFFISANT") return <AccesRefuse />;

  return (
    <div className="max-w-5xl">
      <EnTeteParametres />

      {parametres.ok ? (
        <FormulaireParametres parametres={parametres.donnees} />
      ) : (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{parametres.message}</p>
          <BoutonReessayer />
        </div>
      )}
    </div>
  );
}
