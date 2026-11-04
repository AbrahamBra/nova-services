"use client";

import { useRef, useTransition } from "react";
import { Bouton } from "@/components/nova/bouton";
import { useToasts } from "@/components/nova/toasts";
import { prendreEnCharge } from "@/lib/actions/demandes";
import { messageErreur } from "@/lib/erreurs";

// Actions du panneau du détail d'une demande (EXPERIENCE.md §4, §9.5).
// La page n'affiche que les actions permises pour l'état de la demande ;
// la base refuse de toute façon une action interdite (droits compris).
// Chaque action donne un toast, puis le détail est rafraîchi par l'action
// serveur (sans recharger la page).
// Story 2.1 : « Prendre en charge », si la demande est Nouvelle et sans
// responsable (aucune condition de rôle : tout membre actif).

/** Message de réussite de la prise en charge (EXPERIENCE.md §10, flow 2). */
export const MESSAGE_PRISE_EN_CHARGE = "Vous êtes responsable de cette demande.";

export function BoutonPrendreEnCharge({ demandeId }: { demandeId: string }) {
  const [envoi, demarrer] = useTransition();
  // Appel « en vol » : deux clics avant le nouveau rendu n'envoient qu'un appel.
  const enVol = useRef(false);
  const { afficher } = useToasts();

  function prendre() {
    if (enVol.current) return;
    enVol.current = true;
    demarrer(async () => {
      try {
        const resultat = await prendreEnCharge(demandeId);
        if (resultat.ok) afficher("succes", MESSAGE_PRISE_EN_CHARGE);
        else afficher("erreur", resultat.message);
      } catch {
        // Action injoignable (réseau coupé) : rien ne change à l'écran.
        afficher("erreur", messageErreur("ERREUR_INATTENDUE"));
      } finally {
        enVol.current = false;
      }
    });
  }

  return (
    <Bouton type="button" onClick={prendre} disabled={envoi} className="mt-3 w-full">
      {envoi ? "Prise en charge…" : "Prendre en charge"}
    </Bouton>
  );
}
