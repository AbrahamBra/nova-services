import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireSaisie } from "@/components/formulaire-saisie";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireCategoriesSaisie } from "@/lib/categories";

// Saisie interne « Saisir une demande » (EXPERIENCE.md §9.6, story 2.6) :
// réservée aux membres actifs, comme tout l'espace équipe (proxy.ts renvoie
// à la connexion sans session, la mise en page vérifie le membre). Les
// catégories actives sont lues avec la session. Jamais mise en cache :
// chaque affichage reçoit une nouvelle clé d'envoi (AD-26).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Saisir une demande — Nova Services",
};

const CLASSE_LIEN_RETOUR =
  "inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export default async function PageSaisie() {
  const categories = await lireCategoriesSaisie();

  return (
    <div className="max-w-[560px]">
      <Link href="/equipe/demandes" className={CLASSE_LIEN_RETOUR}>
        ← Retour aux demandes
      </Link>
      <h1 className="mt-2 text-2xl font-semibold leading-[1.3]">Saisir une demande</h1>

      {categories.ok ? (
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Demande reçue par téléphone ou par email. Les champs sans mention sont obligatoires.
          </p>
          <FormulaireSaisie categories={categories.donnees} cleEnvoi={crypto.randomUUID()} />
        </>
      ) : (
        <div
          role="alert"
          className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{categories.message}</p>
          <BoutonReessayer />
        </div>
      )}
    </div>
  );
}
