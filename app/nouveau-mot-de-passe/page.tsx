import type { Metadata } from "next";
import { FormulaireMotDePasse } from "@/components/formulaire-mot-de-passe";
import { DemanderNouveauLien } from "@/components/lien-plus-valable";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { messageErreur } from "@/lib/erreurs";
import { estPanneAuth, invitationDuClient, profilDuClient } from "@/lib/session";
import { sessionParLien } from "@/lib/supabase/proxy";
import { creerClientServeur } from "@/lib/supabase/serveur";

// Page « Choisir un mot de passe » (EXPERIENCE.md §9.12), ouverte après
// /auth/confirmer :
//   - invitation (story 4.1) : titre « Bienvenue chez Nova Services,
//     [prénom] » (nom lu par `mon_invitation()`) ;
//   - réinitialisation (story 4.3) : membre actif dont la session vient d'un
//     lien (méthode `amr` la plus récente différente de `password`), titre
//     « Choisissez un nouveau mot de passe ».
// Membre actif connecté par mot de passe : « Ce lien n'est plus valable. »
// et « Demander un nouveau lien » (jamais de changement de mot de passe sans
// lien). Sans session ou compte non actif : « Ce lien n'est plus valable.
// Contactez votre administrateur. ».
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choisir un mot de passe — Nova Services",
  robots: { index: false, follow: false },
};

type Etat =
  | { type: "invitation"; prenom: string }
  | { type: "reinitialisation" }
  | { type: "lien" }
  | { type: "lien_reinitialisation" }
  | { type: "erreur" };

async function lireEtat(): Promise<Etat> {
  let client;
  try {
    client = await creerClientServeur();
  } catch {
    console.error("[nouveau-mot-de-passe] client serveur indisponible");
    return { type: "erreur" };
  }
  let claims: unknown;
  try {
    const { data, error } = await client.auth.getClaims();
    if (error) return estPanneAuth(error) ? { type: "erreur" } : { type: "lien" };
    if (!data?.claims) return { type: "lien" };
    claims = data.claims;
  } catch {
    return { type: "erreur" };
  }
  const invitation = await invitationDuClient(client);
  if (invitation === undefined) return { type: "erreur" };
  if (invitation !== null) return { type: "invitation", prenom: invitation.prenom };

  const profil = await profilDuClient(client);
  if (!profil.ok) return { type: "erreur" };
  if (profil.donnees === null) return { type: "lien" };
  return sessionParLien(claims) ? { type: "reinitialisation" } : { type: "lien_reinitialisation" };
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
          <FormulaireMotDePasse parcours="invitation" />
        </>
      ) : etat.type === "reinitialisation" ? (
        <>
          <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">
            Choisissez un nouveau mot de passe
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Il remplacera votre mot de passe actuel.
          </p>
          <FormulaireMotDePasse parcours="reinitialisation" />
        </>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold leading-[1.3]">Choisir un mot de passe</h1>
          <div
            role="alert"
            className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="font-medium text-destructive">
              {messageErreur(
                etat.type === "lien"
                  ? "LIEN_INVALIDE"
                  : etat.type === "lien_reinitialisation"
                    ? "LIEN_REINITIALISATION_INVALIDE"
                    : "ERREUR_INATTENDUE",
              )}
            </p>
            {etat.type === "erreur" ? <BoutonReessayer /> : null}
          </div>
          {etat.type === "lien_reinitialisation" ? (
            <DemanderNouveauLien className="mt-4 w-full" />
          ) : null}
        </>
      )}
    </main>
  );
}
