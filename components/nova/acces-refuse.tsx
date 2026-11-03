import Link from "next/link";

// État « Accès refusé » (EXPERIENCE.md §5) : page interne réservée à un
// autre rôle. Le refus est aussi appliqué côté serveur par chaque action.
export function AccesRefuse() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold leading-[1.3]">Vous n&apos;avez pas accès à cette page.</h1>
      <p className="mt-6">
        <Link
          href="/equipe"
          className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-surface px-5 text-[15px] font-semibold text-primary outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Retour à l&apos;accueil
        </Link>
      </p>
    </div>
  );
}
