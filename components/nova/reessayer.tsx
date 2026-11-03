"use client";

import { Button } from "@/components/ui/button";

// Bouton « Réessayer » du bandeau d'erreur serveur (EXPERIENCE.md §5).
// Par défaut, recharge la page, qui relit les informations sur le serveur.
// Dans un formulaire, `onReessayer` renvoie la saisie sans la perdre.
export function BoutonReessayer({ onReessayer }: { onReessayer?: () => void } = {}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 rounded-md bg-surface px-4 text-sm"
      onClick={onReessayer ?? (() => window.location.reload())}
    >
      Réessayer
    </Button>
  );
}
