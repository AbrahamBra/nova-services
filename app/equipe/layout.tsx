import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MenuEquipe } from "@/components/nova/menu-equipe";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { FournisseurToasts } from "@/components/nova/toasts";
import { LIBELLES_ROLE } from "@/lib/domaine";
import { adresseDeRetour } from "@/lib/schemas/connexion";
import { lireProfil } from "@/lib/session";
import { lireCompteurMenu } from "@/lib/tableau-de-bord";
import { ENTETE_CHEMIN } from "@/lib/supabase/proxy";

// Mise en page de l'espace équipe (AD-28) : vérifie que la personne
// connectée est un membre actif (lu dans `membres`, AD-3), puis affiche le
// menu latéral. Sans session, proxy.ts a déjà renvoyé vers la connexion.
// Story 2.1 : fournisseur des toasts, commun à toutes les actions.
// Story 3.1 : version de l'application en bas de chaque page interne
// (AD-11), injectée au build par next.config.ts.
// Story 2.8 : compteur du menu (demandes « À prendre en charge »), lu ici en
// même temps que le profil comme valeur initiale ; la mise en page n'étant
// pas rendue de nouveau lors d'une navigation dans l'application, le menu le
// relit ensuite à chaque changement de page (action `lireCompteurDemandes`).
// Masqué à 0 ou en cas d'erreur.
// Jamais mise en cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function MiseEnPageEquipe({ children }: LayoutProps<"/equipe">) {
  // Profil et compteur du menu lus en parallèle (sans membre actif, la vue ne
  // renvoie rien : le compteur n'est jamais affiché).
  const [profil, aPrendreEnCharge] = await Promise.all([lireProfil(), lireCompteurMenu()]);

  if (!profil.ok) {
    return (
      <main className="mx-auto w-full max-w-[560px] flex-1 px-4 py-10">
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{profil.message}</p>
          <BoutonReessayer />
        </div>
      </main>
    );
  }

  // Session sans membre actif (compte invité, désactivé ou inconnu) : retour
  // à la connexion, en gardant la page demandée (transmise par proxy.ts).
  if (profil.donnees === null) {
    const retour = adresseDeRetour((await headers()).get(ENTETE_CHEMIN));
    redirect(`/connexion?retour=${encodeURIComponent(retour)}`);
  }

  const { nom, role, estAdmin } = profil.donnees;

  return (
    <FournisseurToasts>
      <div className="flex min-h-full flex-1 flex-col lg:flex-row">
        <MenuEquipe
          nom={nom}
          libelleRole={LIBELLES_ROLE[role]}
          estAdmin={estAdmin}
          aPrendreEnCharge={aPrendreEnCharge}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
          <footer className="px-4 pb-4 text-[13px] text-muted-foreground md:px-8">
            {process.env.NEXT_PUBLIC_APP_VERSION
              ? `Version ${process.env.NEXT_PUBLIC_APP_VERSION}`
              : "Version inconnue"}
          </footer>
        </div>
      </div>
    </FournisseurToasts>
  );
}
