import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Bouton principal Nova (DESIGN.md « Bouton principal ») : enveloppe le
// bouton shadcn sans le modifier. Coins 6 px, survol `--primary-hover`,
// hauteur 44 px (zone tactile), option pleine largeur sur téléphone.
// Un seul bouton principal par écran.

type BoutonProps = Omit<React.ComponentProps<typeof Button>, "variant" | "size"> & {
  /** Pleine largeur sous 640 px (téléphone), largeur naturelle au-delà. */
  pleineLargeurTelephone?: boolean;
};

export function Bouton({ className, pleineLargeurTelephone = false, ...props }: BoutonProps) {
  return (
    <Button
      variant="default"
      size="default"
      className={cn(
        "h-11 rounded-md px-5 text-[15px] font-semibold hover:bg-primary-hover",
        pleineLargeurTelephone && "w-full sm:w-auto",
        className,
      )}
      {...props}
    />
  );
}
