"use client";

import { Button } from "@/components/ui/button";

// Bouton « Réessayer » du bandeau d'erreur serveur (EXPERIENCE.md §5) :
// recharge la page, qui relit les informations sur le serveur.
export function BoutonReessayer() {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 rounded-md bg-surface px-4 text-sm"
      onClick={() => window.location.reload()}
    >
      Réessayer
    </Button>
  );
}
