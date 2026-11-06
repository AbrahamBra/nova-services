import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireMotDePasseOublie } from "@/components/formulaire-mot-de-passe-oublie";

// Page publique « Mot de passe oublié » (story 4.3, EXPERIENCE.md §9.12) :
// colonne centrée comme /connexion, un champ Email et « Recevoir un lien ».
// Toujours le même message, que l'adresse corresponde à un compte ou non ;
// l'email (lien valable 24 h) n'est envoyé qu'aux membres actifs dont
// l'adresse est dans EMAILS_AUTORISES (mode démonstration).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mot de passe oublié — Nova Services",
  robots: { index: false, follow: false },
};

export default function PageMotDePasseOublie() {
  return (
    <main className="mx-auto w-full max-w-[400px] flex-1 px-4 py-10 md:py-16">
      <header>
        <Link
          href="/"
          className="rounded-sm text-lg font-semibold leading-[1.4] text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Nova Services
        </Link>
      </header>

      <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">Mot de passe oublié</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Indiquez l&apos;adresse email de votre compte : vous recevrez un lien pour choisir un
        nouveau mot de passe.
      </p>

      <FormulaireMotDePasseOublie />

      <p className="mt-6 text-sm">
        <Link
          href="/connexion"
          className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Retour à la connexion
        </Link>
      </p>
    </main>
  );
}
