import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BoutonPrendreEnCharge } from "@/components/nova/actions-demande";
import { BadgePriorite, BadgeStatut } from "@/components/nova/badges";
import { Historique } from "@/components/nova/historique";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireDetail, type DetailDemande } from "@/lib/detail-demande";
import { LIBELLES_CANAL, type EtatEmail } from "@/lib/domaine";
import { adresseAvecPage, lireNumeroPage } from "@/lib/filtres";
import { formaterDateHeure } from "@/lib/format";

// Détail d'une demande (EXPERIENCE.md §9.5, maquette key-detail-demande.html,
// story 1.6) : en-tête, description telle que saisie, demandeur, bandeau si
// l'email de confirmation n'est pas parti, historique, et panneau d'actions
// à droite (en dessous sur téléphone) : responsable, statut, priorité,
// catégorie. Story 2.1 : « Prendre en charge » si la demande est Nouvelle
// et sans responsable.
// Les autres actions et les notes internes arrivent avec l'epic 2.
// Lu avec la session de la personne connectée (RLS), jamais mis en cache.
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

function Info({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <dt className="mb-1 text-[13px] text-muted-foreground">{libelle}</dt>
      <dd className="text-[15px] font-medium break-words">{children}</dd>
    </div>
  );
}

function Detail({ demande }: { demande: DetailDemande }) {
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
            </Info>
            <Info libelle="Priorité">
              <BadgePriorite priorite={demande.priorite} />
            </Info>
            <Info libelle="Catégorie">{categorie}</Info>
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
  // Retour à la même page de la liste (et, plus tard, aux mêmes filtres).
  const retour = adresseAvecPage(CHEMIN_LISTE, parametres, lireNumeroPage(parametres.page));
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

  return (
    <>
      {lienRetour}
      <Detail demande={resultat.donnees} />
    </>
  );
}
