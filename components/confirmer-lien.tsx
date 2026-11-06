"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { unstable_rethrow } from "next/navigation";
import { Bouton } from "@/components/nova/bouton";
import { confirmerLien } from "@/lib/actions/comptes";
import { messageErreur } from "@/lib/erreurs";
import {
  ETAT_CONFIRMATION_INITIAL,
  type EtatConfirmation,
} from "@/lib/schemas/mot-de-passe";

// Bouton « Continuer » de /auth/confirmer (story 4.1, décision d'Abraham) :
// le lien n'est vérifié qu'au clic, par l'action serveur `confirmerLien`,
// puis la page du mot de passe s'ouvre. Lien refusé : « Ce lien n'est plus
// valable. Contactez votre administrateur. », le bouton disparaît.

async function envoyerAuServeur(
  etat: EtatConfirmation,
  donnees: FormData,
): Promise<EtatConfirmation> {
  try {
    return (await confirmerLien(etat, donnees)) ?? etat;
  } catch (erreur) {
    // La redirection vers /nouveau-mot-de-passe est laissée à Next.js.
    unstable_rethrow(erreur);
    return { erreur: messageErreur("ERREUR_INATTENDUE"), tentative: etat.tentative + 1 };
  }
}

export function ConfirmerLien({ jeton, type }: { jeton: string; type: string }) {
  const [etat, envoyer, enCours] = useActionState(envoyerAuServeur, ETAT_CONFIRMATION_INITIAL);
  const alerteRef = useRef<HTMLDivElement>(null);
  const lienRefuse = etat.erreur === messageErreur("LIEN_INVALIDE");

  useEffect(() => {
    if (etat.erreur) alerteRef.current?.focus();
  }, [etat]);

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        if (enCours) return;
        const donnees = new FormData(evenement.currentTarget);
        startTransition(() => envoyer(donnees));
      }}
    >
      <input type="hidden" name="token_hash" value={jeton} />
      <input type="hidden" name="type" value={type} />

      {etat.erreur ? (
        <div
          ref={alerteRef}
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p className="font-medium text-destructive">{etat.erreur}</p>
        </div>
      ) : null}

      {lienRefuse ? null : (
        <Bouton type="submit" disabled={enCours} className="w-full">
          {enCours ? "Vérification…" : "Continuer"}
        </Bouton>
      )}
    </form>
  );
}
