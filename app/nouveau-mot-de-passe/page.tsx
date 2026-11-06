import type { Metadata } from "next";
import { FormulaireMotDePasse } from "@/components/formulaire-mot-de-passe";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { messageErreur } from "@/lib/erreurs";
import { estPanneAuth, invitationDuClient } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Page « Choisir un mot de passe » (EXPERIENCE.md §9.12, story 4.1) : ouverte
// après /auth/confirmer, avec la session de l'invité. Titre « Bienvenue chez
// Nova Services, [prénom] » (nom lu par `mon_invitation()`). Sans session
// d'invitation (lien jamais ouvert, déjà utilisé, compte déjà actif) :
// « Ce lien n'est plus valable. Contactez votre administrateur. ».
// La story 4.3 y ajoutera la version « mot de passe oublié ».
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choisir un mot de passe — Nova Services",
  robots: { index: false, follow: false },
};

type Etat = { type: "invitation"; prenom: string } | { type: "lien" } | { type: "erreur" };

async function lireEtat(): Promise<Etat> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[nouveau-mot-de-passe] client serveur indisponible");
    return { type: "erreur" };
  }
  try {
    const { data, error } = await client.auth.getClaims();
    if (error) return estPanneAuth(error) ? { type: "erreur" } : { type: "lien" };
    if (!data?.claims) return { type: "lien" };
  } catch {
    return { type: "erreur" };
  }
  const invitation = await invitationDuClient(client);
  if (invitation === undefined) return { type: "erreur" };
  if (invitation === null) return { type: "lien" };
  return { type: "invitation", prenom: invitation.prenom };
}

export default async function PageNouveauMotDePasse() {
  const etat = await lireEtat();

  return (
    <main className="mx-auto w-full max-w-[400px] flex-1 px-4 py-10 md:py-16">
      <header>
        <p className="text-lg font-semibold leading-[1.4] text-primary">Nova Services</p>
      </header>

      {etat.type === "invitation" ? (
        <>
          <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">
            {`Bienvenue chez Nova Services, ${etat.prenom}`}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Choisissez votre mot de passe pour accéder à l&apos;espace équipe.
          </p>
          <FormulaireMotDePasse />
        </>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">Choisir un mot de passe</h1>
          <div
            role="alert"
            className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="font-medium text-destructive">
              {messageErreur(etat.type === "lien" ? "LIEN_INVALIDE" : "ERREUR_INATTENDUE")}
            </p>
            {etat.type === "erreur" ? <BoutonReessayer /> : null}
          </div>
        </>
      )}
    </main>
  );
}
