import type { Metadata } from "next";
import { ConfirmerLien } from "@/components/confirmer-lien";
import { messageErreur } from "@/lib/erreurs";
import { schemaLien } from "@/lib/schemas/mot-de-passe";

// Entrée du lien d'invitation (story 4.1) : « Bienvenue chez Nova Services »
// et un bouton « Continuer ». La page ne touche pas au lien à l'affichage
// (l'aperçu d'une messagerie ou d'une conversation ne le consomme pas) : il
// n'est vérifié qu'au clic, par l'action `confirmerLien`. Lien mal formé :
// « Ce lien n'est plus valable. Contactez votre administrateur. ».
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bienvenue — Nova Services",
  robots: { index: false, follow: false },
  // Le jeton est dans l'adresse : jamais transmis à un autre site.
  referrer: "no-referrer",
};

export default async function PageConfirmer({ searchParams }: PageProps<"/auth/confirmer">) {
  const parametres = await searchParams;
  const lien = schemaLien.safeParse({ token_hash: parametres.token_hash, type: parametres.type });

  return (
    <main className="mx-auto w-full max-w-[400px] flex-1 px-4 py-10 md:py-16">
      <header>
        <p className="text-lg font-semibold leading-[1.4] text-primary">Nova Services</p>
      </header>

      <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">Bienvenue chez Nova Services</h1>

      {lien.success ? (
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Vous avez été invité à rejoindre l&apos;espace équipe. Continuez pour choisir votre mot
            de passe.
          </p>
          <ConfirmerLien jeton={lien.data.token_hash} type={lien.data.type} />
        </>
      ) : (
        <div role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="font-medium text-destructive">{messageErreur("LIEN_INVALIDE")}</p>
        </div>
      )}
    </main>
  );
}
