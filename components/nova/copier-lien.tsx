"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { copierTexte } from "@/lib/copier";

// « Copier le lien » du tableau de bord vide (story 2.8, EXPERIENCE.md §5) :
// copie l'adresse du formulaire public (la page d'accueil du site, `/`),
// puis affiche « Lien copié » ou « Copie impossible » pendant 2 secondes,
// comme « Copier » de la référence.

const DUREE_COPIE_MS = 2000;

export function CopierLien() {
  const [etat, setEtat] = useState<"attente" | "copie" | "echec">("attente");
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (minuteur.current) clearTimeout(minuteur.current);
    },
    [],
  );

  async function copier() {
    const reussi = await copierTexte(`${window.location.origin}/`);
    setEtat(reussi ? "copie" : "echec");
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setEtat("attente"), DUREE_COPIE_MS);
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copier}
      className="h-11 min-w-36 rounded-md bg-surface px-4 text-sm font-medium"
    >
      <span aria-live="polite">
        {etat === "copie" ? "Lien copié" : etat === "echec" ? "Copie impossible" : "Copier le lien"}
      </span>
    </Button>
  );
}
