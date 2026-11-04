import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { CopierReference } from "@/components/copier-reference";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { lireConfirmation } from "@/lib/confirmation";

// Page de confirmation (EXPERIENCE.md §9.2, AD-16) : référence et contact de
// Nova seulement, jamais le nom, l'email ni la description du demandeur.
// Valable 24 h. La phrase « Un email de confirmation vous a été envoyé. »
// (sans l'adresse) s'affiche seulement si l'email est parti (story 1.7).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmation — Nova Services",
  // Le jeton est dans l'adresse : ni indexation, ni transmission aux liens sortants.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const CLASSE_LIEN_SECONDAIRE =
  "inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-surface px-5 text-[15px] font-semibold text-primary outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto";

function Colonne({ nomAffiche, children }: { nomAffiche: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 px-4 py-6 md:px-8 md:py-10">
      <header>
        <p className="text-lg font-semibold leading-[1.4] text-primary">{nomAffiche}</p>
      </header>
      {children}
    </main>
  );
}

export default async function PageConfirmation({ params }: PageProps<"/confirmation/[jeton]">) {
  const { jeton } = await params;
  const resultat = await lireConfirmation(jeton);

  if (!resultat.ok) {
    return (
      <Colonne nomAffiche="Nova Services">
        <div
          role="alert"
          className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{resultat.message}</p>
          <BoutonReessayer />
        </div>
      </Colonne>
    );
  }

  if (resultat.donnees === null) {
    return (
      <Colonne nomAffiche="Nova Services">
        <h1 className="mt-10 text-2xl font-semibold leading-[1.3]">
          Cette page n&apos;est plus disponible.
        </h1>
        <p className="mt-6">
          <Link href="/" className={CLASSE_LIEN_SECONDAIRE}>
            Déposer une demande
          </Link>
        </p>
      </Colonne>
    );
  }

  const { reference, nomAffiche, emailContact, etatEmail } = resultat.donnees;

  return (
    <Colonne nomAffiche={nomAffiche}>
      <div className="text-center">
        <div
          aria-hidden="true"
          className="mx-auto mt-10 mb-4 flex size-14 items-center justify-center rounded-full bg-status-traitee-bg text-status-traitee-fg"
        >
          <CheckIcon className="size-7" strokeWidth={2.5} />
        </div>

        <h1 className="text-2xl font-semibold leading-[1.3]">
          Votre demande a bien été enregistrée.
        </h1>

        <div className="my-5 rounded-lg border border-border bg-surface p-4">
          <p className="text-[13px] text-muted-foreground">Votre référence</p>
          <p
            className="mt-1.5 mb-3 font-mono text-[22px] font-semibold tracking-wide break-all text-primary"
          >
            {reference}
          </p>
          <CopierReference reference={reference} />
        </div>

        <p className="text-sm leading-normal text-foreground">
          Conservez-la pour tout échange avec notre équipe.
        </p>

        {etatEmail === "envoye" ? (
          <p className="mt-3 text-sm leading-normal text-foreground">
            Un email de confirmation vous a été envoyé.
          </p>
        ) : null}

        <p className="mt-5 mb-6 text-[13px] leading-normal text-muted-foreground">
          Une question ? Contactez {nomAffiche}
          <br />
          <a
            href={`mailto:${emailContact}`}
            className="break-all text-primary underline underline-offset-2"
          >
            {emailContact}
          </a>
        </p>

        <Link href="/" className={CLASSE_LIEN_SECONDAIRE}>
          Déposer une autre demande
        </Link>
      </div>
    </Colonne>
  );
}
