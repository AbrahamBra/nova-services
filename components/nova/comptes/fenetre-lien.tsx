"use client";

import { useId } from "react";
import { CLASSE_CHAMP, CLASSE_LIBELLE } from "@/components/formulaire-depot";
import { CopierReference } from "@/components/copier-reference";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RAPPEL_VALIDITE_LIEN } from "@/lib/schemas/invitation";

// Contenu de la fenêtre du lien (mode démonstration, epic 4) : le lien en
// lecture seule, « Copier » et « Ce lien est valable 24 h. ». Partagé par
// l'invitation (story 4.1) et le lien de mot de passe (story 4.3) ; à placer
// dans un `DialogContent`.

export function ContenuLien({
  titre,
  description,
  libelle,
  lien,
}: {
  titre: string;
  description: string;
  /** Libellé du champ (« Lien d'invitation », « Lien de mot de passe »). */
  libelle: string;
  lien: string;
}) {
  const id = useId();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{titre}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-lien`} className={CLASSE_LIBELLE}>
          {libelle}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${id}-lien`}
            readOnly
            value={lien}
            onFocus={(evenement) => evenement.currentTarget.select()}
            aria-describedby={`${id}-rappel`}
            className={`${CLASSE_CHAMP} min-w-0 flex-1 font-mono text-[13px] md:text-[13px]`}
          />
          <CopierReference reference={lien} />
        </div>
        <p id={`${id}-rappel`} className="text-[13px] text-muted-foreground">
          {RAPPEL_VALIDITE_LIEN}
        </p>
      </div>
    </>
  );
}
