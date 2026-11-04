import type { Metadata } from "next";
import Link from "next/link";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { lireProfil } from "@/lib/session";

// Page provisoire de l'administration : les rubriques (comptes, catégories,
// paramètres, données, journal) arrivent avec les epics 4 et 5.
// Le titre suit ce qui est affiché : un non-administrateur voit le refus.
export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return { title: admin ? "Administration — Nova Services" : "Accès refusé — Nova Services" };
}

export default async function AccueilAdmin() {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  // Revérifié ici : une mise en page n'est pas recalculée à chaque navigation.
  if (!profil.donnees.estAdmin) return <AccesRefuse />;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold leading-[1.3]">Administration</h1>
      <p className="mt-3 text-[15px] leading-normal text-muted-foreground">
        Les outils d&apos;administration (comptes, catégories, paramètres, données personnelles et
        journal) apparaîtront ici au fil des prochaines versions.
      </p>
      <p className="mt-6 text-[15px] leading-normal">
        <Link
          href="/equipe/admin/test-erreur"
          className="font-medium text-primary underline underline-offset-4 outline-none hover:text-primary-hover focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Page de test du suivi des erreurs
        </Link>
      </p>
    </div>
  );
}
