"use client";

import { useActionState } from "react";
import { Bouton } from "@/components/nova/bouton";
import type { Resultat } from "@/lib/server/appeler";
import { provoquerErreurTest } from "./actions";

// Bouton qui lance l'action d'erreur volontaire. L'erreur levée par l'action
// est affichée par error.tsx ; un refus (AD-1) s'affiche ici.
export function FormulaireErreurTest() {
  const [etat, envoyer, enCours] = useActionState<Resultat<never> | null>(
    () => provoquerErreurTest(),
    null,
  );

  return (
    <form action={envoyer} className="mt-6 flex flex-col gap-4">
      {etat && !etat.ok && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 font-medium text-destructive"
        >
          {etat.message}
        </p>
      )}
      <div>
        <Bouton type="submit" disabled={enCours}>
          Provoquer une erreur de test
        </Bouton>
      </div>
    </form>
  );
}
