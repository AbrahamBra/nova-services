import type { Metadata } from "next";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { InviterMembre } from "@/components/nova/comptes/inviter-membre";
import { ListeComptes } from "@/components/nova/comptes/liste-comptes";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireComptes } from "@/lib/comptes";
import { lireProfil } from "@/lib/session";

// Page « Comptes » (EXPERIENCE.md §9.7, story 4.1) : liste des comptes (Nom,
// Email, Rôle, État), triée par nom, et bouton « Inviter un membre ».
// Réservée aux administrateurs : la mise en page de l'administration la
// garde, la page le revérifie (une mise en page n'est pas recalculée à
// chaque navigation) et `lister_comptes()` le vérifie en base.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return { title: admin ? "Comptes — Nova Services" : "Accès refusé — Nova Services" };
}

export default async function PageComptes() {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  if (!profil.donnees.estAdmin) return <AccesRefuse />;

  const comptes = await lireComptes();
  // Refus de la base (rôle changé entre-temps) : le refus seul, comme ci-dessus.
  if (!comptes.ok && comptes.code === "DROIT_INSUFFISANT") return <AccesRefuse />;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold leading-[1.3]">Comptes</h1>
        <InviterMembre />
      </div>

      {comptes.ok ? (
        <ListeComptes comptes={comptes.donnees} idConnecte={profil.donnees.id} />
      ) : (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{comptes.message}</p>
          <BoutonReessayer />
        </div>
      )}
    </div>
  );
}
