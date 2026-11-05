import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ActionsStatut,
  BoutonPrendreEnCharge,
  ChoixCategorie,
  ChoixPriorite,
} from "@/components/nova/actions-demande";
import { BadgePriorite, BadgeStatut } from "@/components/nova/badges";
import { Historique } from "@/components/nova/historique";
import { FormulaireNote, ListeNotes } from "@/components/nova/notes";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireCategoriesActives, type CategoriesDetail } from "@/lib/categories";
import { lireDetail, type DetailDemande } from "@/lib/detail-demande";
import { LIBELLES_CANAL, type EtatEmail } from "@/lib/domaine";
import { adresseListe, lireFiltres, lireNumeroPage } from "@/lib/filtres";
import { formaterDateHeure } from "@/lib/format";

// Détail d'une demande (EXPERIENCE.md §9.5, maquette key-detail-demande.html,
// story 1.6) : en-tête, description telle que saisie, demandeur, bandeau si
// l'email de confirmation n'est pas parti, historique, et panneau d'actions
// à droite (en dessous sur téléphone) : responsable, statut, priorité,
// catégorie. Story 2.1 : « Prendre en charge » si la demande est Nouvelle
// et sans responsable. Story 2.2 : bloc « Notes internes », entre Demandeur
// et Historique (liste et ajout, quel que soit le statut). Story 2.3 :
// boutons de statut sous le badge (« Marquer comme traitée », « Rouvrir »,
// « Classer sans suite » avec sa fenêtre de confirmation). Story 2.4 :
// listes « Priorité » et « Catégorie » (catégories actives dans l'ordre des
// formulaires, et état réel de la catégorie actuelle, lus seulement pour une
// demande trouvée ; liste vide ou illisible : le nom seul et « Liste des
// catégories indisponible. »). Libérer et attribuer : story 2.7.
// Tout est lu avec la session de la personne connectée (RLS), jamais mis en cache.
export const dynamic = "force-dynamic";

/** Référence de l'adresse, décodée (une référence valide ne change pas). */
function decoder(brute: string): string {
  try {
    return decodeURIComponent(brute);
  } catch {
    return brute;
  }
}

// Titre : la référence, ou « Demande introuvable ». Même lecture que la page
// (mise en commun par `cache` dans lib/detail-demande.ts).
export async function generateMetadata({
  params,
}: PageProps<"/equipe/demandes/[reference]">): Promise<Metadata> {
  const { reference } = await params;
  const resultat = await lireDetail(decoder(reference));
  if (!resultat.ok) return { title: "Demandes — Nova Services" };
  if (resultat.donnees === null) return { title: "Demande introuvable — Nova Services" };
  return { title: `${resultat.donnees.reference} — Nova Services` };
}

const CHEMIN_LISTE = "/equipe/demandes";

const BANDEAUX_EMAIL: Partial<Record<EtatEmail, string>> = {
  non_envoye_demo: "Email non envoyé (mode démonstration)",
  echec: "Email de confirmation non envoyé",
};

const CLASSE_LIEN_RETOUR =
  "inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

const CLASSE_LIEN_SECONDAIRE =
  "inline-flex h-11 items-center justify-center rounded-md border border-border bg-surface px-5 text-[15px] font-semibold text-primary outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const CLASSE_LIEN_TEXTE = "break-all text-primary underline underline-offset-2";

function Carte({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <h2 className="mb-3 text-lg font-semibold leading-[1.4]">{titre}</h2>
      {children}
    </section>
  );
}

function NonRenseigne() {
  return <span className="text-muted-foreground">Non renseigné</span>;
}

/** Numéro composable pour `tel:` (chiffres et « + » seulement), ou null sans chiffre. */
function adresseTelephone(telephone: string): string | null {
  const numero = telephone.replace(/[^\d+]/g, "");
  return /\d/.test(numero) ? `tel:${numero}` : null;
}

/** `mailto:` avec la partie locale encodée (le domaine reste lisible). */
function adresseEmail(email: string): string {
  const arobase = email.lastIndexOf("@");
  if (arobase < 0) return `mailto:${encodeURIComponent(email)}`;
  return `mailto:${encodeURIComponent(email.slice(0, arobase))}@${encodeURIComponent(email.slice(arobase + 1))}`;
}

function Info({ libelle, id, children }: { libelle: string; id?: string; children: ReactNode }) {
  return (
    <div className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <dt id={id} className="mb-1 text-[13px] text-muted-foreground">
        {libelle}
      </dt>
      <dd className="text-[15px] font-medium break-words">{children}</dd>
    </div>
  );
}

/** Libellés du panneau, cibles de `aria-labelledby` des deux listes. */
const ID_LIBELLE_PRIORITE = "libelle-priorite";
const ID_LIBELLE_CATEGORIE = "libelle-categorie";

const MESSAGE_CATEGORIES_INDISPONIBLES = "Liste des catégories indisponible.";

function Detail({
  demande,
  categories,
}: {
  demande: DetailDemande;
  /** Catégories de la liste, ou null si elles n'ont pas pu être lues. */
  categories: CategoriesDetail | null;
}) {
  const bandeauEmail = BANDEAUX_EMAIL[demande.etatEmail];
  const lienTelephone = demande.telephone ? adresseTelephone(demande.telephone) : null;
  const categorie = demande.nomsCategories[demande.categorieId] ?? "—";
  const responsable = demande.responsableId
    ? (demande.nomsMembres[demande.responsableId] ?? "Membre de l'équipe")
    : "Aucun";

  return (
    <>
      <header className="mb-5">
        <p className="font-mono text-sm font-semibold text-primary">{demande.reference}</p>
        <h1 className="mt-1 mb-2 text-2xl font-semibold leading-[1.3] break-words">
          {demande.objet}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <BadgeStatut statut={demande.statut} />
          <BadgePriorite priorite={demande.priorite} />
          <span>
            Reçue le {formaterDateHeure(demande.creeLe)} via {LIBELLES_CANAL[demande.canal]}
          </span>
        </div>
      </header>

      <div
        data-testid="colonnes-detail"
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Carte titre="Description">
            <p
              data-testid="description"
              className="text-[15px] leading-[1.55] whitespace-pre-wrap break-words"
            >
              {demande.description}
            </p>
          </Carte>

          <Carte titre="Demandeur">
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Nom</dt>
              <dd className="break-words">{demande.nom}</dd>
              {demande.societe ? (
                <>
                  <dt className="text-muted-foreground">Société</dt>
                  <dd className="break-words">{demande.societe}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Email</dt>
              <dd>
                {demande.email ? (
                  <a href={adresseEmail(demande.email)} className={CLASSE_LIEN_TEXTE}>
                    {demande.email}
                  </a>
                ) : (
                  <NonRenseigne />
                )}
              </dd>
              <dt className="text-muted-foreground">Téléphone</dt>
              <dd>
                {demande.telephone && lienTelephone ? (
                  <a href={lienTelephone} className={CLASSE_LIEN_TEXTE}>
                    {demande.telephone}
                  </a>
                ) : demande.telephone ? (
                  <span className="break-words">{demande.telephone}</span>
                ) : (
                  <NonRenseigne />
                )}
              </dd>
            </dl>
            {bandeauEmail ? (
              <p
                data-testid="bandeau-email"
                className="mt-4 rounded-md border border-status-encours-fg/30 bg-status-encours-bg px-3 py-2 text-sm font-medium text-status-encours-fg"
              >
                {bandeauEmail}
              </p>
            ) : null}
          </Carte>

          <Carte titre="Notes internes">
            <ListeNotes
              notes={demande.notes}
              notesIllisibles={demande.notesIllisibles}
              nomsMembres={demande.nomsMembres}
            />
            <FormulaireNote demandeId={demande.id} />
          </Carte>

          <Carte titre="Historique">
            <Historique
              lignes={demande.historique}
              lignesIllisibles={demande.lignesIllisibles}
              nomsMembres={demande.nomsMembres}
              nomsCategories={demande.nomsCategories}
            />
          </Carte>
        </div>

        <aside
          aria-label="Informations"
          className="rounded-lg border border-border bg-surface p-4 md:p-5"
        >
          <dl>
            <Info libelle="Responsable">
              <span data-testid="responsable">{responsable}</span>
              {/* Même condition que prendre_en_charge : Nouvelle et sans responsable. */}
              {demande.statut === "nouvelle" && demande.responsableId === null ? (
                <BoutonPrendreEnCharge demandeId={demande.id} />
              ) : null}
            </Info>
            <Info libelle="Statut">
              <BadgeStatut statut={demande.statut} />
              {/* Story 2.3 : seul le passage permis pour ce statut (règle 1). */}
              <ActionsStatut demandeId={demande.id} statut={demande.statut} />
            </Info>
            <Info libelle="Priorité" id={ID_LIBELLE_PRIORITE}>
              <BadgePriorite priorite={demande.priorite} />
              {/* Story 2.4 : quel que soit le statut (règle 3). */}
              <ChoixPriorite
                key={demande.id}
                demandeId={demande.id}
                priorite={demande.priorite}
                idLibelle={ID_LIBELLE_PRIORITE}
              />
            </Info>
            <Info libelle="Catégorie" id={ID_LIBELLE_CATEGORIE}>
              {categories && categories.actuelle && categories.actives.length > 0 ? (
                <ChoixCategorie
                  key={demande.id}
                  demandeId={demande.id}
                  actuelle={categories.actuelle}
                  actives={categories.actives}
                  idLibelle={ID_LIBELLE_CATEGORIE}
                />
              ) : (
                <>
                  {categorie}
                  <span
                    data-testid="categories-indisponibles"
                    className="mt-1 block text-[13px] font-normal text-muted-foreground"
                  >
                    {MESSAGE_CATEGORIES_INDISPONIBLES}
                  </span>
                </>
              )}
            </Info>
          </dl>
        </aside>
      </div>
    </>
  );
}

export default async function PageDetailDemande({
  params,
  searchParams,
}: PageProps<"/equipe/demandes/[reference]">) {
  const [{ reference: brute }, parametres] = await Promise.all([params, searchParams]);
  const reference = decoder(brute);
  // Retour à la même page de la liste, avec les mêmes filtres (story 2.5).
  const retour = adresseListe(CHEMIN_LISTE, lireFiltres(parametres), lireNumeroPage(parametres.page));
  const resultat = await lireDetail(reference);

  const lienRetour = (
    <p className="mb-3">
      <Link href={retour} className={CLASSE_LIEN_RETOUR}>
        ← Retour aux demandes
      </Link>
    </p>
  );

  if (!resultat.ok) {
    return (
      <>
        {lienRetour}
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

  if (resultat.donnees === null) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold leading-[1.3]">Demande introuvable.</h1>
        <p className="mt-6">
          <Link href={retour} className={CLASSE_LIEN_SECONDAIRE}>
            Retour aux demandes
          </Link>
        </p>
      </div>
    );
  }

  // Seulement pour une demande trouvée.
  const categories = await lireCategoriesActives(resultat.donnees.categorieId);

  return (
    <>
      {lienRetour}
      <Detail demande={resultat.donnees} categories={categories.ok ? categories.donnees : null} />
    </>
  );
}
