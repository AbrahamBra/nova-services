import type { Metadata } from "next";
import { ConfirmerLien } from "@/components/confirmer-lien";
import { DemanderNouveauLien } from "@/components/lien-plus-valable";
import { messageErreur } from "@/lib/erreurs";
import { lireTypeLien, schemaLien } from "@/lib/schemas/mot-de-passe";

// Entrée des liens envoyés aux membres : invitation (story 4.1,
// « Bienvenue chez Nova Services ») et réinitialisation du mot de passe
// (story 4.3, « Nouveau mot de passe »), avec un bouton « Continuer ». La
// page ne touche pas au lien à l'affichage (l'aperçu d'une messagerie ou
// d'une conversation ne le consomme pas) : il n'est vérifié qu'au clic, par
// l'action `confirmerLien`. Lien mal formé : « Ce lien n'est plus
// valable. Contactez votre administrateur. » (invitation) ou « Ce lien
// n'est plus valable. » avec « Demander un nouveau lien » (réinitialisation).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: PageProps<"/auth/confirmer">): Promise<Metadata> {
  const { type } = await searchParams;
  return {
    title:
      lireTypeLien(type) === "recovery"
        ? "Nouveau mot de passe — Nova Services"
        : "Bienvenue — Nova Services",
    robots: { index: false, follow: false },
    // Le jeton est dans l'adresse : jamais transmis à un autre site.
    referrer: "no-referrer",
  };
}

export default async function PageConfirmer({ searchParams }: PageProps<"/auth/confirmer">) {
  const parametres = await searchParams;
  const lien = schemaLien.safeParse({ token_hash: parametres.token_hash, type: parametres.type });
  const reinitialisation = lireTypeLien(parametres.type) === "recovery";

  return (
    <main className="mx-auto w-full max-w-[400px] flex-1 px-4 py-10 md:py-16">
      <header>
        <p className="text-lg font-semibold leading-[1.4] text-primary">Nova Services</p>
      </header>

      <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">
        {reinitialisation ? "Nouveau mot de passe" : "Bienvenue chez Nova Services"}
      </h1>

      {lien.success ? (
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {reinitialisation
              ? "Continuez pour choisir un nouveau mot de passe."
              : "Vous avez été invité à rejoindre l'espace équipe. Continuez pour choisir votre mot de passe."}
          </p>
          <ConfirmerLien jeton={lien.data.token_hash} type={lien.data.type} />
        </>
      ) : (
        <>
          <div role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="font-medium text-destructive">
              {messageErreur(reinitialisation ? "LIEN_REINITIALISATION_INVALIDE" : "LIEN_INVALIDE")}
            </p>
          </div>
          {reinitialisation ? <DemanderNouveauLien className="mt-4 w-full" /> : null}
        </>
      )}
    </main>
  );
}
