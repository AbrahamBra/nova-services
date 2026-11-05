import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  FiltresDemandes,
  ResultatsFiltres,
  ZoneFiltres,
} from "@/components/nova/filtres-demandes";
import { ListeDemandes } from "@/components/nova/liste-demandes";
import { Pagination } from "@/components/nova/pagination";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireDemandes } from "@/lib/demandes";
import {
  aDesFiltres,
  adresseListe,
  estAdresseCanonique,
  lireFiltres,
  lireNumeroPage,
  parametresListe,
} from "@/lib/filtres";
import { formaterNombre } from "@/lib/format";
import { lireOptionsFiltres } from "@/lib/options-filtres";

// Liste des demandes (EXPERIENCE.md §9.4, story 1.5) : toutes les demandes,
// des plus récentes aux plus anciennes, 25 par page (`?page=2`). Lue avec la
// session de la personne connectée (RLS), jamais mise en cache.
// Story 2.5 : barre de recherche et de filtres, filtres dans l'adresse
// (`?q=dupont&statut=non_traitees`, lib/filtres.ts) ; le total et la
// pagination portent sur la liste filtrée ; sans résultat : « Aucune demande
// ne correspond à ces filtres. » et « Effacer les filtres ». Une adresse non
// canonique (valeur invalide, page hors bornes) redirige vers sa forme
// canonique. « Saisir une demande » : story 2.6.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demandes — Nova Services",
};

const CHEMIN = "/equipe/demandes";

const MESSAGE_AUCUNE_DEMANDE =
  "Aucune demande pour l'instant. Partagez le lien du formulaire à vos clients.";

const MESSAGE_SANS_RESULTAT = "Aucune demande ne correspond à ces filtres.";

const CLASSE_LIEN_EFFACER =
  "inline-flex h-11 items-center justify-center rounded-md border border-border bg-surface px-5 text-[15px] font-semibold text-primary outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Le total est dans une zone `role="status"` : son changement après un
// filtre est annoncé par les lecteurs d'écran.
function Entete({ total }: { total?: number }) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-2xl font-semibold leading-[1.3]">Demandes</h1>
      <p role="status" data-testid="total" className="text-[15px] text-muted-foreground">
        {total !== undefined && total > 0
          ? `${formaterNombre(total)} ${total > 1 ? "demandes" : "demande"}`
          : null}
      </p>
    </div>
  );
}

function LienEffacer() {
  return (
    <Link href={CHEMIN} className={CLASSE_LIEN_EFFACER}>
      Effacer les filtres
    </Link>
  );
}

export default async function PageDemandes({ searchParams }: PageProps<"/equipe/demandes">) {
  const parametres = await searchParams;
  const filtres = lireFiltres(parametres);
  const [resultat, options] = await Promise.all([
    lireDemandes(lireNumeroPage(parametres.page), filtres),
    lireOptionsFiltres(),
  ]);

  const filtre = aDesFiltres(filtres);
  // Listes illisibles : « Liste indisponible » dans la barre.
  const barre = (
    <FiltresDemandes
      chemin={CHEMIN}
      filtres={filtres}
      categories={options.ok ? options.donnees.categories : null}
      membres={options.ok ? options.donnees.membres : null}
    />
  );

  if (!resultat.ok) {
    // La barre reste, et « Effacer les filtres » si un filtre est actif :
    // une recherche en échec n'enferme pas la personne.
    return (
      <ZoneFiltres>
        <Entete />
        {barre}
        <ResultatsFiltres>
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="font-medium text-destructive">{resultat.message}</p>
            <div className="flex flex-wrap gap-2">
              {filtre ? <LienEffacer /> : null}
              <BoutonReessayer />
            </div>
          </div>
        </ResultatsFiltres>
      </ZoneFiltres>
    );
  }

  const { lignes, total, page, taillePage } = resultat.donnees;

  // Adresse canonique de la page réellement affichée : `?page=abc` mène à la
  // page 1, un numéro au-delà de la fin à la dernière page, une valeur de
  // filtre invalide (`statut=fermee`) est retirée.
  if (!estAdresseCanonique(parametres, filtres, page)) {
    redirect(adresseListe(CHEMIN, filtres, page));
  }

  if (total === 0 && !filtre) {
    return (
      <>
        <Entete total={0} />
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center">
          <p className="text-[15px]">{MESSAGE_AUCUNE_DEMANDE}</p>
        </div>
      </>
    );
  }

  // Paramètres transmis au détail et à la pagination : tous les filtres.
  const parametresFiltres = parametresListe(filtres);

  return (
    <ZoneFiltres>
      <Entete total={total} />
      {barre}
      <ResultatsFiltres>
        {total === 0 ? (
          <div
            role="status"
            className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-4 py-10 text-center"
          >
            <p className="text-[15px]">{MESSAGE_SANS_RESULTAT}</p>
            <LienEffacer />
          </div>
        ) : (
          <>
            <ListeDemandes lignes={lignes} parametres={parametresFiltres} page={page} />
            <Pagination
              chemin={CHEMIN}
              parametres={parametresFiltres}
              page={page}
              total={total}
              taillePage={taillePage}
            />
          </>
        )}
      </ResultatsFiltres>
    </ZoneFiltres>
  );
}
