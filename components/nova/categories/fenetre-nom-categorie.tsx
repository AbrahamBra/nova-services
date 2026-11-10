"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { CLASSE_CHAMP, CLASSE_LIBELLE, MessageErreur } from "@/components/formulaire-depot";
import { Bouton } from "@/components/nova/bouton";
import { useToasts } from "@/components/nova/toasts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ajouterCategorie,
  renommerCategorie,
  type ResultatNomCategorie,
} from "@/lib/actions/categories";
import type { CategorieAdmin } from "@/lib/categories-admin";
import { messageErreur } from "@/lib/erreurs";
import { MESSAGES_CATEGORIE, verifierNomCategorie } from "@/lib/schemas/categorie";

// Fenêtre « Ajouter une catégorie » / « Renommer » (story 5.2) : un seul
// champ Nom (1 à 80 caractères, espaces retirés aux extrémités), erreurs
// sous le champ (nom vide, trop long, déjà pris, pris par une catégorie
// désactivée), focus sur le champ en erreur, saisie conservée,
// « Envoi en cours… ». La liste est rafraîchie par l'action (revalidatePath).

const CLASSE_ACTION = "h-9 rounded-md bg-surface px-3 text-[13px] font-semibold text-foreground";

function echecInattendu(): ResultatNomCategorie {
  return { ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") };
}

type Mode = { type: "ajout" } | { type: "renommage"; categorie: CategorieAdmin };

/** Bouton principal « Ajouter une catégorie » et sa fenêtre. */
export function AjouterCategorie() {
  return <FenetreNomCategorie mode={{ type: "ajout" }} />;
}

/** Bouton « Renommer » d'une ligne et sa fenêtre préremplie. */
export function RenommerCategorie({ categorie }: { categorie: CategorieAdmin }) {
  return <FenetreNomCategorie mode={{ type: "renommage", categorie }} />;
}

function FenetreNomCategorie({ mode }: { mode: Mode }) {
  const [ouverte, setOuverte] = useState(false);
  // Clé du formulaire : une nouvelle ouverture repart d'une fenêtre vierge.
  const [cle, setCle] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const boutonRef = useRef<HTMLButtonElement>(null);

  const ouvrir = () => {
    setCle((c) => c + 1);
    setOuverte(true);
  };

  return (
    <Dialog
      open={ouverte}
      onOpenChange={(ouvert) => {
        if (!ouvert && envoi) return;
        if (ouvert) setCle((c) => c + 1);
        setOuverte(ouvert);
      }}
    >
      {mode.type === "ajout" ? (
        <Bouton ref={boutonRef} type="button" pleineLargeurTelephone onClick={ouvrir}>
          Ajouter une catégorie
        </Bouton>
      ) : (
        <Button
          ref={boutonRef}
          type="button"
          variant="outline"
          className={CLASSE_ACTION}
          onClick={ouvrir}
        >
          Renommer
          <span className="sr-only">{` ${mode.categorie.nom}`}</span>
        </Button>
      )}
      <DialogContent
        fermetureDesactivee={envoi}
        onEscapeKeyDown={(evenement) => {
          if (envoi) evenement.preventDefault();
        }}
        onPointerDownOutside={(evenement) => {
          if (envoi) evenement.preventDefault();
        }}
        onCloseAutoFocus={(evenement) => {
          // Le focus revient au bouton d'origine (toujours présent : la ligne
          // renommée reste dans la liste).
          evenement.preventDefault();
          boutonRef.current?.focus();
        }}
      >
        <FormulaireNomCategorie
          key={cle}
          mode={mode}
          onOccupe={setEnvoi}
          onTermine={() => setOuverte(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormulaireNomCategorie({
  mode,
  onOccupe,
  onTermine,
}: {
  mode: Mode;
  onOccupe: (occupe: boolean) => void;
  onTermine: () => void;
}) {
  const id = useId();
  const idChamp = `${id}-nom`;
  const idErreur = `${id}-nom-erreur`;
  const champRef = useRef<HTMLInputElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  const { afficher } = useToasts();

  useEffect(() => {
    onOccupe(envoi);
  }, [envoi, onOccupe]);

  function montrerErreur(message: string) {
    setErreur(message);
    setErreurGenerale(null);
    champRef.current?.focus();
  }

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enVol.current) return;

    const saisie = new FormData(evenement.currentTarget).get("nom");
    const verification = verifierNomCategorie(typeof saisie === "string" ? saisie : "");
    if (!verification.ok) {
      montrerErreur(verification.erreur);
      return;
    }

    setErreur(undefined);
    setErreurGenerale(null);
    enVol.current = true;
    demarrer(async () => {
      let resultat: ResultatNomCategorie;
      try {
        resultat =
          mode.type === "ajout"
            ? await ajouterCategorie(verification.nom)
            : await renommerCategorie(mode.categorie.id, verification.nom);
      } catch {
        resultat = echecInattendu();
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        // Nom inchangé : la fenêtre se ferme sans toast (rien n'a changé).
        if (resultat.donnees.modifie) {
          afficher(
            "succes",
            mode.type === "ajout" ? MESSAGES_CATEGORIE.ajoutee : MESSAGES_CATEGORIE.renommee,
          );
        }
        onTermine();
        return;
      }
      if (resultat.erreurNom) {
        montrerErreur(resultat.erreurNom);
        return;
      }
      setErreurGenerale(resultat.message);
      requestAnimationFrame(() => bandeauRef.current?.focus());
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {mode.type === "ajout" ? "Ajouter une catégorie" : "Renommer la catégorie"}
        </DialogTitle>
        <DialogDescription>
          {mode.type === "ajout"
            ? "La catégorie sera aussitôt proposée dans le formulaire public et dans la saisie interne."
            : "Le nouveau nom s'affichera partout, y compris sur les demandes déjà classées dans cette catégorie."}
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        className="space-y-4"
        onSubmit={soumettre}
        onChange={() => {
          if (erreur) setErreur(undefined);
        }}
      >
        {erreurGenerale ? (
          <div
            ref={bandeauRef}
            role="alert"
            tabIndex={-1}
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <p className="font-medium text-destructive">{erreurGenerale}</p>
          </div>
        ) : null}

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp} className={CLASSE_LIBELLE}>
              Nom
            </Label>
            <Input
              ref={champRef}
              id={idChamp}
              name="nom"
              autoComplete="off"
              required
              defaultValue={mode.type === "renommage" ? mode.categorie.nom : ""}
              readOnly={envoi}
              className={CLASSE_CHAMP}
              aria-invalid={erreur ? true : undefined}
              aria-describedby={erreur ? idErreur : undefined}
            />
          </div>
          <MessageErreur id={idErreur} message={erreur} />
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onTermine}
            disabled={envoi}
            className="h-11 rounded-md bg-surface px-5 text-[15px] font-semibold"
          >
            Annuler
          </Button>
          <Bouton type="submit" disabled={envoi}>
            {envoi ? "Envoi en cours…" : mode.type === "ajout" ? "Ajouter" : "Enregistrer"}
          </Bouton>
        </DialogFooter>
      </form>
    </>
  );
}
