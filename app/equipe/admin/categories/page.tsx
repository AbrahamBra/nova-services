import type { Metadata } from "next";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { AjouterCategorie } from "@/components/nova/categories/fenetre-nom-categorie";
import { ListeCategories } from "@/components/nova/categories/liste-categories";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireCategoriesAdmin } from "@/lib/categories-admin";
import { lireProfil } from "@/lib/session";

// Page « Catégories » (story 5.2, règle 9) : liste des catégories (Nom, État,
// nombre de demandes, Actions) dans l'ordre des formulaires, et bouton
// « Ajouter une catégorie ». Réservée aux administrateurs : la mise en page
// de l'administration la garde, la page le revérifie et
// `lister_categories_admin()` le vérifie en base.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return { title: admin ? "Catégories — Nova Services" : "Accès refusé — Nova Services" };
}

export default async function PageCategories() {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  if (!profil.donnees.estAdmin) return <AccesRefuse />;

  const categories = await lireCategoriesAdmin();
  // Refus de la base (rôle changé entre-temps) : le refus seul, comme ci-dessus.
  if (!categories.ok && categories.code === "DROIT_INSUFFISANT") return <AccesRefuse />;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold leading-[1.3]">Catégories</h1>
        <AjouterCategorie />
      </div>

      {categories.ok ? (
        <ListeCategories categories={categories.donnees} />
      ) : (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{categories.message}</p>
          <BoutonReessayer />
        </div>
      )}
    </div>
  );
}
