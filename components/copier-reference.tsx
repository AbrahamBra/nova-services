"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Bouton « Copier » de la référence (EXPERIENCE.md §6) : affiche « Copié »
// pendant 2 secondes après la copie, ou « Copie impossible » si le navigateur
// refuse.

const DUREE_COPIE_MS = 2000;

async function copierTexte(texte: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
  } catch {
    // Presse-papiers refusé : on tente l'ancienne méthode.
  }
  const zone = document.createElement("textarea");
  try {
    zone.value = texte;
    zone.setAttribute("readonly", "");
    zone.style.position = "fixed";
    zone.style.opacity = "0";
    document.body.appendChild(zone);
    zone.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    zone.remove();
  }
}

export function CopierReference({ reference }: { reference: string }) {
  const [etat, setEtat] = useState<"attente" | "copie" | "echec">("attente");
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (minuteur.current) clearTimeout(minuteur.current);
    },
    [],
  );

  async function copier() {
    const reussi = await copierTexte(reference);
    setEtat(reussi ? "copie" : "echec");
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setEtat("attente"), DUREE_COPIE_MS);
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copier}
      className="h-11 min-w-24 rounded-md bg-surface px-4 text-sm font-medium"
    >
      <span aria-live="polite">{etat === "copie" ? "Copié" : etat === "echec" ? "Copie impossible" : "Copier"}</span>
    </Button>
  );
}
