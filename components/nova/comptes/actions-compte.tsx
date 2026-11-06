"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { CLASSE_CHAMP, CLASSE_LIBELLE, MessageErreur } from "@/components/formulaire-depot";
import { Bouton } from "@/components/nova/bouton";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  desactiverMembre,
  modifierMembre,
  reactiverMembre,
  type ResultatModification,
} from "@/lib/actions/admin";
import type { Compte } from "@/lib/comptes";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import {
  MESSAGES_COMPTE,
  premierChampModificationEnErreur,
  texteDesactivation,
  verifierModification,
  type ChampModification,
  type ErreursModification,
} from "@/lib/schemas/compte";
import { OPTIONS_ROLE } from "@/lib/schemas/invitation";

// Actions d'un compte (EXPERIENCE.md §9.7, story 4.2), selon son état :
//   - Invité : Modifier ;
//   - Actif : Modifier, Désactiver ;
//   - Désactivé : Modifier, Réactiver.
// Sur la ligne de l'administrateur connecté : « Modifier » sans champ Rôle,
// jamais « Désactiver » (la base refuse de toute façon : PROPRE_COMPTE).
// Chaque action donne un toast ; la liste est rafraîchie par l'action
// serveur (revalidatePath).

const CLASSE_ACTION = "h-9 rounded-md bg-surface px-3 text-[13px] font-semibold text-foreground";

type ResultatSimple = { ok: true } | { ok: false; code: CodeErreur; message: string };

function echecInattendu(): { ok: false; code: CodeErreur; message: string } {
  return { ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") };
}

/** Réactive un compte (bouton de la liste et « Réactiver ce compte » à l'invitation). */
export async function reactiverDepuisEcran(id: string): Promise<ResultatSimple> {
  try {
    const resultat = await reactiverMembre(id);
    return resultat.ok ? { ok: true } : resultat;
  } catch {
    return echecInattendu();
  }
}

export function ActionsCompte({ compte, estMoi }: { compte: Compte; estMoi: boolean }) {
  const groupeRef = useRef<HTMLDivElement>(null);
  // Après désactivation ou réactivation, le bouton d'origine disparaît : le
  // focus va au premier bouton de la ligne mise à jour.
  const focusApresChangement = useRef(false);
  useEffect(() => {
    if (!focusApresChangement.current) return;
    focusApresChangement.current = false;
    groupeRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [compte.etat]);

  return (
    <div
      ref={groupeRef}
      role="group"
      aria-label={`Actions pour ${compte.nom}`}
      className="flex flex-wrap gap-2"
    >
      <FenetreModifier compte={compte} estMoi={estMoi} />
      {compte.etat === "actif" && !estMoi ? (
        <FenetreDesactiver
          compte={compte}
          prevoirFocus={(actif) => {
            focusApresChangement.current = actif;
          }}
        />
      ) : null}
      {compte.etat === "desactive" ? (
        <BoutonReactiver
          compte={compte}
          prevoirFocus={(actif) => {
            focusApresChangement.current = actif;
          }}
        />
      ) : null}
    </div>
  );
}

function NomCache({ nom }: { nom: string }) {
  return <span className="sr-only">{` ${nom}`}</span>;
}

// --- Modifier ----------------------------------------------------------------

/**
 * Erreurs à afficher : sous les champs présents, sinon dans le bandeau.
 * Sur ma propre ligne, le champ Rôle n'existe pas : une erreur de rôle
 * (PROPRE_COMPTE, DERNIER_ADMIN, Zod) va dans le bandeau, sinon elle serait
 * invisible.
 */
export function repartirErreursModification(
  erreurs: ErreursModification,
  roleAffiche: boolean,
): { champs: ErreursModification; bandeau: string | null } {
  if (roleAffiche || !erreurs.role) return { champs: erreurs, bandeau: null };
  const { role, ...champs } = erreurs;
  return { champs, bandeau: role };
}

function FenetreModifier({ compte, estMoi }: { compte: Compte; estMoi: boolean }) {
  const [ouverte, setOuverte] = useState(false);
  const [cle, setCle] = useState(0);
  const [envoi, setEnvoi] = useState(false);

  return (
    <Dialog
      open={ouverte}
      onOpenChange={(ouvert) => {
        if (!ouvert && envoi) return;
        if (ouvert) setCle((c) => c + 1);
        setOuverte(ouvert);
      }}
    >
      <Button
        type="button"
        variant="outline"
        className={CLASSE_ACTION}
        onClick={() => {
          setCle((c) => c + 1);
          setOuverte(true);
        }}
      >
        Modifier
        <NomCache nom={compte.nom} />
      </Button>
      <DialogContent
        fermetureDesactivee={envoi}
        onEscapeKeyDown={(evenement) => {
          if (envoi) evenement.preventDefault();
        }}
        onPointerDownOutside={(evenement) => {
          if (envoi) evenement.preventDefault();
        }}
      >
        <FormulaireModifier
          key={cle}
          compte={compte}
          estMoi={estMoi}
          onOccupe={setEnvoi}
          onTermine={() => setOuverte(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormulaireModifier({
  compte,
  estMoi,
  onOccupe,
  onTermine,
}: {
  compte: Compte;
  estMoi: boolean;
  onOccupe: (occupe: boolean) => void;
  onTermine: () => void;
}) {
  const id = useId();
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [erreurs, setErreurs] = useState<ErreursModification>({});
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  const { afficher } = useToasts();

  useEffect(() => {
    onOccupe(envoi);
  }, [envoi, onOccupe]);

  const idChamp = (champ: ChampModification) => `${id}-${champ}`;
  const idErreur = (champ: ChampModification) => `${id}-${champ}-erreur`;

  /** Affiche des erreurs par champ (ou dans le bandeau) et place le focus. */
  function montrerErreurs(nouvelles: ErreursModification) {
    const { champs, bandeau } = repartirErreursModification(nouvelles, !estMoi);
    setErreurs(champs);
    setErreurGenerale(bandeau);
    const champ = premierChampModificationEnErreur(champs);
    if (champ) document.getElementById(idChamp(champ))?.focus();
    else if (bandeau) requestAnimationFrame(() => bandeauRef.current?.focus());
  }

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enVol.current) return;

    const donnees = new FormData(evenement.currentTarget);
    const nom = donnees.get("nom");
    const role = estMoi ? compte.role : donnees.get("role");
    const saisie = { id: compte.id, nom: typeof nom === "string" ? nom : "", role };
    const verification = verifierModification(saisie);
    if (!verification.ok) {
      montrerErreurs(verification.erreurs);
      return;
    }

    setErreurs({});
    setErreurGenerale(null);
    enVol.current = true;
    demarrer(async () => {
      let resultat: ResultatModification;
      try {
        resultat = await modifierMembre(verification.donnees);
      } catch {
        resultat = echecInattendu();
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        afficher("succes", MESSAGES_COMPTE.modifie);
        onTermine();
        return;
      }
      if (resultat.erreurs && premierChampModificationEnErreur(resultat.erreurs)) {
        montrerErreurs(resultat.erreurs);
        return;
      }
      setErreurGenerale(resultat.message);
      requestAnimationFrame(() => bandeauRef.current?.focus());
    });
  }

  function aria(champ: ChampModification) {
    const enErreur = Boolean(erreurs[champ]);
    return {
      "aria-invalid": enErreur || undefined,
      "aria-describedby": enErreur ? idErreur(champ) : undefined,
    };
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Modifier le compte</DialogTitle>
        <DialogDescription>
          {estMoi
            ? "Vous pouvez corriger votre nom. Votre rôle ne peut pas être changé depuis votre propre compte."
            : `Nom et rôle de ${compte.nom}. Un nouveau rôle s'applique à son prochain chargement de page.`}
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        className="space-y-4"
        onSubmit={soumettre}
        onChange={(evenement) => {
          const nom = (evenement.target as unknown as { name?: unknown }).name;
          if (typeof nom === "string" && nom in erreurs) {
            setErreurs((actuelles) => {
              const suivantes = { ...actuelles };
              delete suivantes[nom as ChampModification];
              return suivantes;
            });
          }
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
            <Label htmlFor={idChamp("nom")} className={CLASSE_LIBELLE}>
              Nom et prénom
            </Label>
            <Input
              id={idChamp("nom")}
              name="nom"
              autoComplete="off"
              required
              defaultValue={compte.nom}
              readOnly={envoi}
              className={CLASSE_CHAMP}
              {...aria("nom")}
            />
          </div>
          <MessageErreur id={idErreur("nom")} message={erreurs.nom} />
        </div>

        {estMoi ? null : (
          <div>
            <div className="space-y-1.5">
              <Label htmlFor={idChamp("role")} className={CLASSE_LIBELLE}>
                Rôle
              </Label>
              <NativeSelect
                id={idChamp("role")}
                name="role"
                required
                defaultValue={compte.role}
                disabled={envoi}
                className="w-full [&_select]:h-11 [&_select]:rounded-md [&_select]:bg-surface [&_select]:pl-3 [&_select]:text-[15px]"
                {...aria("role")}
              >
                {OPTIONS_ROLE.map((option) => (
                  <NativeSelectOption key={option.valeur} value={option.valeur}>
                    {option.libelle}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <MessageErreur id={idErreur("role")} message={erreurs.role} />
          </div>
        )}

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
            {envoi ? "Envoi en cours…" : "Enregistrer"}
          </Bouton>
        </DialogFooter>
      </form>
    </>
  );
}

// --- Désactiver ----------------------------------------------------------------

/**
 * Fenêtre de confirmation « Désactiver » (modèle `FenetreClasserSansSuite`) :
 * « Annuler » à gauche et sélectionné à l'ouverture, bouton destructeur à
 * droite, focus gardé dans la fenêtre. Annonce le nombre de demandes En
 * cours qui reviendront en Nouvelle.
 */
function FenetreDesactiver({
  compte,
  prevoirFocus,
}: {
  compte: Compte;
  /**
   * Prévient la ligne avant l'appel : la liste peut être rafraîchie avant
   * la fin de l'action (le bouton d'origine disparaît alors).
   */
  prevoirFocus: (actif: boolean) => void;
}) {
  const [ouverte, setOuverte] = useState(false);
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  const { afficher } = useToasts();
  const lignes = texteDesactivation(compte.nom, compte.demandesEnCours);

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
        const reponse = await desactiverMembre(compte.id);
        resultat = reponse.ok ? { ok: true } : reponse;
      } catch {
        resultat = echecInattendu();
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        afficher("succes", MESSAGES_COMPTE.desactive);
      } else {
        prevoirFocus(false);
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
        <NomCache nom={compte.nom} />
      </Button>
      <AlertDialogContent className="rounded-lg bg-surface p-5 shadow-sm data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="text-lg font-semibold leading-[1.4]">
            Désactiver le compte
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left text-sm leading-[1.5] text-foreground">
            {lignes.join(" ")}
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

// --- Réactiver ------------------------------------------------------------------

/** « Réactiver » : action réversible, sans confirmation. */
function BoutonReactiver({
  compte,
  prevoirFocus,
}: {
  compte: Compte;
  /**
   * Prévient la ligne avant l'appel : la liste peut être rafraîchie avant
   * la fin de l'action (le bouton d'origine disparaît alors).
   */
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
      const resultat = await reactiverDepuisEcran(compte.id);
      enVol.current = false;
      if (resultat.ok) {
        afficher("succes", MESSAGES_COMPTE.reactive);
      } else {
        prevoirFocus(false);
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
      <NomCache nom={compte.nom} />
    </Button>
  );
}
