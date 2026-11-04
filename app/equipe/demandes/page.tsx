import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListeDemandes } from "@/components/nova/liste-demandes";
import { Pagination } from "@/components/nova/pagination";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireDemandes } from "@/lib/demandes";
import { adresseAvecPage, lireNumeroPage } from "@/lib/filtres";
import { formaterNombre } from "@/lib/format";

// Liste des demandes (EXPERIENCE.md §9.4, story 1.5) : toutes les demandes,
// des plus récentes aux plus anciennes, 25 par page (`?page=2`). Lue avec la
// session de la personne connectée (RLS), jamais mise en cache.
// Recherche et filtres : story 2.5 ; « Saisir une demande » : story 2.6.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demandes — Nova Services",
};

const CHEMIN = "/equipe/demandes";

const MESSAGE_AUCUNE_DEMANDE =
  "Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients.";

function Entete({ total }: { total?: number }) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-2xl font-semibold leading-[1.3]">Demandes</h1>
      {total !== undefined && total > 0 ? (
        <p className="text-[15px] text-muted-foreground">
          {formaterNombre(total)} {total > 1 ? "demandes" : "demande"}
        </p>
      ) : null}
    </div>
  );
}

export default async function PageDemandes({ searchParams }: PageProps<"/equipe/demandes">) {
  const parametres = await searchParams;
  const resultat = await lireDemandes(lireNumeroPage(parametres.page));

  if (!resultat.ok) {
    return (
      <>
        <Entete />
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{resultat.message}</p>
          <BoutonReessayer />
        </div>
      </>
    );
  }

  const { lignes, total, page, taillePage } = resultat.donnees;

  // Adresse canonique de la page réellement affichée : `?page=abc` mène à la
  // page 1, un numéro au-delà de la fin à la dernière page.
  const attendu = page > 1 ? String(page) : undefined;
  if (parametres.page !== attendu) {
    redirect(adresseAvecPage(CHEMIN, parametres, page));
  }

  if (total === 0) {
    return (
      <>
        <Entete total={0} />
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center">
          <p className="text-[15px]">{MESSAGE_AUCUNE_DEMANDE}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Entete total={total} />
      <ListeDemandes lignes={lignes} />
      <Pagination
        chemin={CHEMIN}
        parametres={parametres}
        page={page}
        total={total}
        taillePage={taillePage}
      />
    </>
  );
}
