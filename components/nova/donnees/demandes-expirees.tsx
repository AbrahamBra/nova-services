"use client";

import { useId, useRef, useState, useTransition } from "react";
import { EnTeteExpirees } from "@/components/nova/donnees/en-tete-donnees";
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
import { purgerExpirees, type ResultatPurge } from "@/lib/actions/donnees";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import {
  texteConfirmationPurge,
  texteDemandesSupprimees,
  texteExpirees,
  type Expirees,
} from "@/lib/schemas/donnees";

// Bloc « Demandes expirées » de la page Données personnelles (story 5.5) :
// « N demandes sont traitées depuis plus de [durée]. » (nombre lu au
// chargement de la page) et le bouton destructeur « Supprimer les demandes
// expirées », désactivé avec « Aucune demande expirée. » à 0. Fenêtre de
// confirmation (« Annuler » à gauche et sélectionné, bouton destructeur à
// droite). Après la suppression : toast « N demandes supprimées. », bloc à
// « Aucune demande expirée. ». Si le nombre a changé entre-temps, rien n'est
// supprimé : le nouveau nombre s'affiche avec un bandeau. Erreur imprévue
// (la suppression a pu avoir lieu) : bandeau, bouton désactivé jusqu'au
// rechargement de la page. Autres refus (rien n'a été supprimé) : bandeau,
// bouton inchangé. Le passage d'un état à l'autre est `etatApresPurge`
// (fonction pure, testée sans navigateur).

export const TEXTE_EXPIREES_ILLISIBLES =
  "Le nombre de demandes expirées n'a pas pu être lu. Rechargez la page.";
export const TEXTE_RECHARGER =
  "La suppression a peut-être eu lieu : rechargez la page pour vérifier.";

export const LIBELLE_PURGE = "Supprimer les demandes expirées";

/** État du bloc après le chargement ou une confirmation. */
export type EtatExpirees = {
  /** Nombre et durée affichés ; null si le nombre n'a pas pu être lu. */
  expirees: Expirees | null;
  /** Bandeau d'erreur. */
  erreur: { code: CodeErreur; message: string } | null;
  /** Faux après une erreur imprévue (la suppression a pu avoir lieu) : bouton désactivé. */
  incertain: boolean;
};

/** Suite d'une confirmation : nouvel état, toast éventuel, élément à focaliser. */
export type IssuePurge = {
  etat: EtatExpirees;
  toast: string | null;
  focus: "texte" | "bandeau";
};

/** État au chargement de la page. */
export function etatInitial(expirees: Expirees | null): EtatExpirees {
  return { expirees, erreur: null, incertain: false };
}

/** Le bouton « Supprimer les demandes expirées » est-il utilisable ? */
export function peutSupprimer(etat: EtatExpirees, enVol: boolean): boolean {
  return etat.expirees !== null && etat.expirees.nombre > 0 && !etat.incertain && !enVol;
}

/**
 * Résultat de `purgerExpirees` (null : l'action a levé une exception) →
 * état suivant. Succès : toast, « Aucune demande expirée. ». Nombre changé
 * et relu : le nouveau nombre et le bandeau. Erreur imprévue : bandeau,
 * « La suppression a peut-être eu lieu… », bouton désactivé. Autres refus
 * (rien n'a été supprimé) : bandeau seul, bouton inchangé.
 */
export function etatApresPurge(etat: EtatExpirees, resultat: ResultatPurge | null): IssuePurge {
  if (resultat?.ok) {
    return {
      etat: {
        expirees: etat.expirees && { nombre: 0, dureeMois: etat.expirees.dureeMois },
        erreur: null,
        incertain: false,
      },
      toast: texteDemandesSupprimees(resultat.donnees.nombre),
      focus: "texte",
    };
  }
  const refus = resultat ?? {
    ok: false as const,
    code: "ERREUR_INATTENDUE" as const,
    message: messageErreur("ERREUR_INATTENDUE"),
  };
  const erreur = { code: refus.code, message: refus.message };
  if (refus.code === "ERREUR_INATTENDUE") {
    return { etat: { ...etat, erreur, incertain: true }, toast: null, focus: "bandeau" };
  }
  if (refus.code === "EXPIREES_CHANGEES" && refus.expirees) {
    return { etat: { ...etat, expirees: refus.expirees, erreur }, toast: null, focus: "bandeau" };
  }
  return { etat: { ...etat, erreur }, toast: null, focus: "bandeau" };
}

/** Focus donné après la fermeture de la fenêtre (Radix rend le focus au déclencheur). */
function focaliserPlusTard(element: () => HTMLElement | null) {
  requestAnimationFrame(() => setTimeout(() => element()?.focus(), 0));
}

const CLASSE_DESTRUCTEUR =
  "h-11 rounded-md bg-destructive px-5 text-[15px] font-semibold text-white hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/40";

export function DemandesExpirees({ initiales }: { initiales: Expirees | null }) {
  const id = useId();
  const idTitre = `${id}-titre`;
  const texteRef = useRef<HTMLParagraphElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [etat, setEtat] = useState<EtatExpirees>(() => etatInitial(initiales));
  const [ouverte, setOuverte] = useState(false);
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  // Refus : à la fermeture, le focus va au bandeau, pas au déclencheur.
  const echec = useRef(false);
  const { afficher } = useToasts();

  // Page rafraîchie (ex. effacement dans le bloc du dessus) : nombre relu
  // par le serveur repris, sauf pendant une suppression.
  const [initialesVues, setInitialesVues] = useState(initiales);
  if (initiales !== initialesVues && !envoi) {
    setInitialesVues(initiales);
    setEtat((courant) => ({ ...courant, expirees: initiales }));
  }

  function changerOuverture(valeur: boolean) {
    if (!valeur && enVol.current) return;
    setOuverte(valeur);
  }

  function confirmer() {
    if (enVol.current || !peutSupprimer(etat, false)) return;
    enVol.current = true;
    const depart = etat;
    demarrer(async () => {
      let resultat: ResultatPurge | null;
      try {
        resultat = await purgerExpirees(depart.expirees?.nombre);
      } catch {
        resultat = null;
      } finally {
        enVol.current = false;
      }
      const issue = etatApresPurge(depart, resultat);
      echec.current = issue.focus === "bandeau";
      setOuverte(false);
      setEtat(issue.etat);
      // Le bandeau seul en cas d'échec (jamais le même message deux fois).
      if (issue.toast) afficher("succes", issue.toast);
      if (issue.focus === "texte") focaliserPlusTard(() => texteRef.current);
    });
  }

  const { expirees, erreur } = etat;
  const nombre = expirees?.nombre ?? 0;
  const desactive = !peutSupprimer(etat, envoi);

  return (
    <section aria-labelledby={idTitre} className="rounded-lg border border-border bg-surface p-5">
      <EnTeteExpirees id={idTitre} />

      <p
        ref={texteRef}
        tabIndex={-1}
        data-testid="nombre-expirees"
        className="text-[15px] outline-none"
      >
        {expirees === null ? TEXTE_EXPIREES_ILLISIBLES : texteExpirees(expirees)}
      </p>

      {erreur ? (
        <div
          ref={bandeauRef}
          role="alert"
          tabIndex={-1}
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p className="font-medium text-destructive">{erreur.message}</p>
          {etat.incertain ? <p className="mt-1 text-sm text-destructive">{TEXTE_RECHARGER}</p> : null}
        </div>
      ) : null}

      <div className="mt-4">
        <AlertDialog open={ouverte} onOpenChange={changerOuverture}>
          <Button
            type="button"
            disabled={desactive}
            onClick={() => setOuverte(true)}
            className={`w-full sm:w-auto ${CLASSE_DESTRUCTEUR}`}
          >
            {LIBELLE_PURGE}
          </Button>
          <AlertDialogContent
            onCloseAutoFocus={(evenement) => {
              if (!echec.current) return;
              echec.current = false;
              evenement.preventDefault();
              bandeauRef.current?.focus();
            }}
            className="rounded-lg bg-surface p-5 shadow-sm data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md"
          >
            <AlertDialogHeader className="place-items-start text-left">
              <AlertDialogTitle className="text-lg font-semibold leading-[1.4]">
                {LIBELLE_PURGE}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-left text-sm leading-[1.5] break-words text-foreground">
                {expirees !== null && nombre > 0 ? texteConfirmationPurge(expirees) : null}
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
              <Button type="button" disabled={envoi} onClick={confirmer} className={CLASSE_DESTRUCTEUR}>
                {envoi ? "Suppression…" : LIBELLE_PURGE}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
