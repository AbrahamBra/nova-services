import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccesRefuse } from "@/components/nova/acces-refuse";
import { CHEMIN_JOURNAL, FiltreJournal, ListeJournal } from "@/components/nova/journal";
import { Pagination } from "@/components/nova/pagination";
import { BoutonReessayer } from "@/components/nova/reessayer";
import {
  adresseJournal,
  estAdresseJournalCanonique,
  lireNumeroPage,
  lireTypeJournal,
  parametresJournal,
} from "@/lib/filtres";
import { lireJournal } from "@/lib/journal";
import { lireProfil } from "@/lib/session";

// Page « Journal » (EXPERIENCE.md §9.11, story 5.1) : événements du plus
// récent au plus ancien (Date · Type · Description · Par), filtre par type et
// page dans l'adresse (`?type=compte&page=2`), 50 lignes par page. Une adresse
// non canonique (type inconnu, page hors bornes) redirige vers sa forme
// canonique. Réservée aux administrateurs : la mise en page de
// l'administration la garde, la page le revérifie et `lire_journal()` le
// vérifie en base.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const profil = await lireProfil();
  const admin = profil.ok && profil.donnees?.estAdmin === true;
  return { title: admin ? "Journal — Nova Services" : "Accès refusé — Nova Services" };
}

function Titre() {
  return <h1 className="mb-5 text-2xl font-semibold leading-[1.3]">Journal</h1>;
}

export default async function PageJournal({ searchParams }: PageProps<"/equipe/admin/journal">) {
  const profil = await lireProfil();
  if (!profil.ok || profil.donnees === null) return null;
  if (!profil.donnees.estAdmin) return <AccesRefuse />;

  const parametres = await searchParams;
  const type = lireTypeJournal(parametres.type);
  const resultat = await lireJournal(type, lireNumeroPage(parametres.page));
  // Refus de la base (rôle changé entre-temps) : le refus seul, comme ci-dessus.
  if (!resultat.ok && resultat.code === "DROIT_INSUFFISANT") return <AccesRefuse />;

  if (!resultat.ok) {
    return (
      <div className="max-w-5xl">
        <Titre />
        <FiltreJournal type={type} />
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{resultat.message}</p>
          <BoutonReessayer />
        </div>
      </div>
    );
  }

  const { lignes, total, page, taillePage } = resultat.donnees;

  // Adresse canonique de la page réellement affichée : `?type=xyz` est
  // retiré, `?page=abc` mène à la page 1, un numéro au-delà de la fin à la
  // dernière page.
  if (!estAdresseJournalCanonique(parametres, type, page)) {
    redirect(adresseJournal(CHEMIN_JOURNAL, type, page));
  }

  return (
    <div className="max-w-5xl">
      <Titre />
      <FiltreJournal type={type} />
      <ListeJournal lignes={lignes} />
      <Pagination
        chemin={CHEMIN_JOURNAL}
        parametres={parametresJournal(type)}
        page={page}
        total={total}
        taillePage={taillePage}
      />
    </div>
  );
}
