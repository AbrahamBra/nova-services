"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RenommerCategorie } from "@/components/nova/categories/fenetre-nom-categorie";
import { useToasts } from "@/components/nova/toasts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { desactiverCategorie, reactiverCategorie } from "@/lib/actions/categories";
import type { CategorieAdmin } from "@/lib/categories-admin";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import { MESSAGES_CATEGORIE, texteDesactivationCategorie } from "@/lib/schemas/categorie";

// Actions d'une catégorie (story 5.2), selon son état :
//   - Active : Renommer, Désactiver (fenêtre de confirmation) ;
//   - Désactivée : Renommer, Réactiver (bouton direct).
// Chaque action donne un toast ; la liste est rafraîchie par l'action
// serveur (revalidatePath). Après un changement d'état, le bouton d'origine
// disparaît : le focus va au premier bouton de la ligne mise à jour.

const CLASSE_ACTION = "h-9 rounded-md bg-surface px-3 text-[13px] font-semibold text-foreground";

type ResultatSimple = { ok: true } | { ok: false; code: CodeErreur; message: string };

function echecInattendu(): { ok: false; code: CodeErreur; message: string } {
  return { ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") };
}

export function ActionsCategorie({ categorie }: { categorie: CategorieAdmin }) {
  const groupeRef = useRef<HTMLDivElement>(null);
  const focusApresChangement = useRef(false);
  useEffect(() => {
    if (!focusApresChangement.current) return;
    focusApresChangement.current = false;
    groupeRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [categorie.actif]);

  const prevoirFocus = (actif: boolean) => {
    focusApresChangement.current = actif;
  };

  return (
    <div
      ref={groupeRef}
      role="group"
      aria-label={`Actions pour ${categorie.nom}`}
      className="flex flex-wrap gap-2"
    >
      <RenommerCategorie categorie={categorie} />
      {categorie.actif ? (
        <FenetreDesactiver categorie={categorie} prevoirFocus={prevoirFocus} />
      ) : (
        <BoutonReactiver categorie={categorie} prevoirFocus={prevoirFocus} />
      )}
    </div>
  );
}

function NomCache({ nom }: { nom: string }) {
  return <span className="sr-only">{` ${nom}`}</span>;
}

/**
 * Fenêtre de confirmation « Désactiver » (modèle `FenetreDesactiver` des
 * comptes) : « Annuler » à gauche et sélectionné à l'ouverture, bouton
 * destructeur à droite. Annonce le nombre de demandes qui gardent la
 * catégorie. Dernière catégorie active : toast « Il doit rester au moins une
 * catégorie active. ».
 */
function FenetreDesactiver({
  categorie,
  prevoirFocus,
}: {
  categorie: CategorieAdmin;
  prevoirFocus: (actif: boolean) => void;
}) {
  const [ouverte, setOuverte] = useState(false);
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  const { afficher } = useToasts();

  function changerOuverture(valeur: boolean) {
    if (!valeur && enVol.current) return;
    setOuverte(valeur);
  }

  function confirmer() {
    if (enVol.current) return;
    enVol.current = true;
    prevoirFocus(true);
    demarrer(async () => {
      let resultat: ResultatSimple;
      try {
        const reponse = await desactiverCategorie(categorie.id);
        resultat = reponse.ok ? { ok: true } : reponse;
      } catch {
        resultat = echecInattendu();
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        afficher("succes", MESSAGES_CATEGORIE.desactivee);
      } else {
        // État déjà changé ailleurs : la ligne bascule quand même (liste
        // rafraîchie), le focus doit suivre comme après une réussite.
        if (resultat.code !== "ETAT_CATEGORIE_INVALIDE") prevoirFocus(false);
        afficher("erreur", resultat.message);
      }
      setOuverte(false);
    });
  }

  return (
    <AlertDialog open={ouverte} onOpenChange={changerOuverture}>
      <Button
        type="button"
        variant="outline"
        className={CLASSE_ACTION}
        onClick={() => setOuverte(true)}
      >
        Désactiver
        <NomCache nom={categorie.nom} />
      </Button>
      <AlertDialogContent className="rounded-lg bg-surface p-5 shadow-sm data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="text-lg font-semibold leading-[1.4]">
            Désactiver la catégorie
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left text-sm leading-[1.5] text-foreground">
            {texteDesactivationCategorie(categorie.nom, categorie.demandes)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* « Annuler » à gauche, bouton destructeur à droite. */}
        <AlertDialogFooter className="-mx-5 -mb-5 bg-surface p-5 sm:justify-between">
          <AlertDialogCancel
            disabled={envoi}
            className="h-11 rounded-md bg-surface px-5 text-[15px] font-semibold text-foreground"
          >
            Annuler
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={envoi}
            onClick={confirmer}
            className="h-11 rounded-md bg-destructive px-5 text-[15px] font-semibold text-white hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/40"
          >
            {envoi ? "Désactivation…" : "Désactiver"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** « Réactiver » : action réversible, sans confirmation. */
function BoutonReactiver({
  categorie,
  prevoirFocus,
}: {
  categorie: CategorieAdmin;
  prevoirFocus: (actif: boolean) => void;
}) {
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  const { afficher } = useToasts();

  function reactiver() {
    if (enVol.current) return;
    enVol.current = true;
    prevoirFocus(true);
    demarrer(async () => {
      let resultat: ResultatSimple;
      try {
        const reponse = await reactiverCategorie(categorie.id);
        resultat = reponse.ok ? { ok: true } : reponse;
      } catch {
        resultat = echecInattendu();
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        afficher("succes", MESSAGES_CATEGORIE.reactivee);
      } else {
        // État déjà changé ailleurs : la ligne bascule quand même (liste
        // rafraîchie), le focus doit suivre comme après une réussite.
        if (resultat.code !== "ETAT_CATEGORIE_INVALIDE") prevoirFocus(false);
        afficher("erreur", resultat.message);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={envoi}
      onClick={reactiver}
      className={CLASSE_ACTION}
    >
      {envoi ? "Réactivation…" : "Réactiver"}
      <NomCache nom={categorie.nom} />
    </Button>
  );
}
