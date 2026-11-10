"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { CLASSE_CHAMP, CLASSE_LIBELLE, MessageErreur } from "@/components/formulaire-depot";
import { BadgeStatut } from "@/components/nova/badges";
import { Bouton } from "@/components/nova/bouton";
import { EnTeteEffacement } from "@/components/nova/donnees/en-tete-donnees";
import { adresseDetail } from "@/components/nova/liste-demandes";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  chercherDemandesDemandeur,
  effacerDemandeur,
  type ResultatRechercheDemandeur,
} from "@/lib/actions/donnees";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import { formaterDate } from "@/lib/format";
import {
  MESSAGES_DONNEES,
  texteBoutonEffacer,
  texteConfirmationEffacement,
  texteDemandesEffacees,
  verifierEmailDemandeur,
  type DemandeDemandeur,
} from "@/lib/schemas/donnees";

// Bloc « Droit à l'effacement » de la page Données personnelles (story 5.4) :
// champ « Email du demandeur » et « Rechercher » ; la recherche passe par une
// action serveur, JAMAIS par l'adresse de la page (aucun paramètre) : le
// résultat vit dans l'état de l'écran et se perd au rechargement (voulu).
// Résultat : « Aucune demande avec cet email. », ou la liste (Référence,
// Date, Objet, Statut) et « Effacer ces N demandes », avec une fenêtre de
// confirmation (« Annuler » à gauche et sélectionné, bouton destructeur à
// droite). Après l'effacement : toast « N demandes effacées. », résultat
// vidé. Échec : bandeau seul (pas de toast), « Effacer » désactivé jusqu'à
// une nouvelle recherche ; liste changée ou erreur inattendue (l'effacement
// a pu avoir lieu) : « Relancer la recherche », et pour l'erreur inattendue
// l'ancienne liste est retirée.

export type Trouvees = { email: string; demandes: DemandeDemandeur[] };

export type ResultatEffacement =
  | { ok: true; nombre: number }
  | { ok: false; code: CodeErreur; message: string };

/** Codes après lesquels « Relancer la recherche » est proposé. */
const CODES_RELANCE: readonly CodeErreur[] = ["DEMANDES_CHANGEES", "ERREUR_INATTENDUE"];

/**
 * Focus donné après la fermeture de la fenêtre et son retrait éventuel
 * (Radix rend le focus au déclencheur au démontage, après un délai nul).
 */
function focaliserPlusTard(element: () => HTMLElement | null) {
  requestAnimationFrame(() => setTimeout(() => element()?.focus(), 0));
}

function echecRecherche(): ResultatRechercheDemandeur {
  return { ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") };
}

const CLASSE_ENTETE =
  "border-b border-border bg-background px-3 py-2.5 text-left text-[13px] font-medium whitespace-nowrap text-muted-foreground";
const CLASSE_CELLULE = "border-b border-muted px-3 py-3 align-top";
const CLASSE_LIEN_REFERENCE =
  "font-mono font-medium whitespace-nowrap text-primary underline-offset-2 outline-none hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-ring";

export function EffacementDemandeur() {
  const id = useId();
  const idEmail = `${id}-email`;
  const idErreur = `${id}-email-erreur`;
  const idTitre = `${id}-titre`;
  const champRef = useRef<HTMLInputElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [erreurEmail, setErreurEmail] = useState<string | null>(null);
  const [erreurGenerale, setErreurGenerale] = useState<{
    code: CodeErreur;
    message: string;
    relancer?: boolean;
  } | null>(null);
  const [trouvees, setTrouvees] = useState<Trouvees | null>(null);
  // Email de la dernière recherche réussie (pour « Relancer la recherche »).
  const [emailCherche, setEmailCherche] = useState<string | null>(null);
  // Faux après un échec d'effacement : la liste affichée n'est plus sûre.
  const [effacable, setEffacable] = useState(true);
  const [recherche, demarrer] = useTransition();
  const enVol = useRef(false);
  // Élément à focaliser une fois la recherche terminée (le champ est en
  // lecture seule pendant l'envoi).
  const focusApres = useRef<"champ" | "bandeau" | null>(null);

  useEffect(() => {
    const cible = focusApres.current;
    if (recherche || cible === null) return;
    focusApres.current = null;
    if (cible === "champ") champRef.current?.focus();
    else bandeauRef.current?.focus();
  }, [recherche, trouvees, erreurEmail, erreurGenerale]);

  /** Recherche par l'action serveur (jamais par l'adresse). */
  function lancer(saisie: string) {
    if (enVol.current) return;
    const verification = verifierEmailDemandeur(saisie);
    if (!verification.ok) {
      setErreurEmail(verification.erreur);
      setErreurGenerale(null);
      champRef.current?.focus();
      return;
    }
    setErreurEmail(null);
    setErreurGenerale(null);
    enVol.current = true;
    demarrer(async () => {
      let resultat: ResultatRechercheDemandeur;
      try {
        resultat = await chercherDemandesDemandeur(saisie);
      } catch {
        resultat = echecRecherche();
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        // Annoncé par la zone `aria-live` du résultat ; le focus reste au formulaire.
        setTrouvees(resultat.donnees);
        setEmailCherche(resultat.donnees.email);
        setEffacable(true);
        return;
      }
      setTrouvees(null);
      if (resultat.erreurEmail) {
        setErreurEmail(resultat.erreurEmail);
        focusApres.current = "champ";
        return;
      }
      setErreurGenerale({ code: resultat.code, message: resultat.message });
      focusApres.current = "bandeau";
    });
  }

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    lancer(email);
  }

  /** « Relancer la recherche » : même email, remis dans le champ. */
  function relancer() {
    if (emailCherche === null) return;
    setEmail(emailCherche);
    lancer(emailCherche);
  }

  /**
   * Après la fenêtre : succès (résultat vidé) ou refus (bandeau seul, Effacer
   * désactivé). Erreur inattendue : l'effacement a pu avoir lieu, l'ancienne
   * liste est retirée. Quand la liste reste, la fenêtre se ferme et donne
   * elle-même le focus au bandeau (`focaliserBandeau`).
   */
  function apresEffacement(resultat: ResultatEffacement) {
    if (resultat.ok) {
      setTrouvees(null);
      setErreurGenerale(null);
      focaliserPlusTard(() => champRef.current);
      return;
    }
    setEffacable(false);
    setErreurGenerale({
      code: resultat.code,
      message: resultat.message,
      relancer: CODES_RELANCE.includes(resultat.code),
    });
    if (resultat.code === "ERREUR_INATTENDUE") {
      setTrouvees(null);
      focaliserPlusTard(() => bandeauRef.current);
    }
  }

  const enErreur = erreurEmail !== null;

  return (
    <section
      aria-labelledby={idTitre}
      className="rounded-lg border border-border bg-surface p-5"
    >
      <EnTeteEffacement id={idTitre} />

      {/* method="post" : même avant le chargement du script, jamais l'email dans l'adresse. */}
      <form noValidate method="post" className="max-w-[560px]" onSubmit={soumettre}>
        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idEmail} className={CLASSE_LIBELLE}>
              Email du demandeur
            </Label>
            <Input
              ref={champRef}
              id={idEmail}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (erreurEmail) setErreurEmail(null);
              }}
              readOnly={recherche}
              className={CLASSE_CHAMP}
              aria-invalid={enErreur || undefined}
              aria-describedby={enErreur ? idErreur : undefined}
            />
          </div>
          <MessageErreur id={idErreur} message={erreurEmail ?? undefined} />
        </div>
        <div className="mt-4">
          <Bouton type="submit" disabled={recherche} pleineLargeurTelephone>
            {recherche ? "Recherche…" : "Rechercher"}
          </Bouton>
        </div>
      </form>

      {erreurGenerale ? (
        <div
          ref={bandeauRef}
          role="alert"
          tabIndex={-1}
          className="mt-5 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-medium text-destructive">{erreurGenerale.message}</p>
            {erreurGenerale.relancer && erreurGenerale.code === "ERREUR_INATTENDUE" ? (
              <p className="mt-1 text-sm text-destructive">{MESSAGES_DONNEES.relancer}</p>
            ) : null}
          </div>
          {erreurGenerale.relancer && emailCherche !== null ? (
            <Button
              type="button"
              variant="outline"
              disabled={recherche}
              onClick={relancer}
              className="h-11 rounded-md bg-surface px-5 text-[15px] font-semibold text-foreground"
            >
              Relancer la recherche
            </Button>
          ) : null}
        </div>
      ) : null}

      <div aria-live="polite" className="mt-5 empty:hidden">
        {trouvees ? (
          <ResultatRecherche
            trouvees={trouvees}
            desactive={!effacable || recherche}
            apresEffacement={apresEffacement}
            focaliserBandeau={() => bandeauRef.current?.focus()}
          />
        ) : null}
      </div>
    </section>
  );
}

/** Résultat d'une recherche : « Aucune demande… », ou la liste et « Effacer ». */
export function ResultatRecherche({
  trouvees,
  desactive = false,
  apresEffacement,
  focaliserBandeau = () => {},
}: {
  trouvees: Trouvees;
  /** « Effacer » désactivé (recherche en cours, ou échec d'effacement). */
  desactive?: boolean;
  apresEffacement: (resultat: ResultatEffacement) => void;
  focaliserBandeau?: () => void;
}) {
  const { email, demandes } = trouvees;
  if (demandes.length === 0) {
    return <p className="text-[15px]">{MESSAGES_DONNEES.aucune}</p>;
  }
  const libelle = `Demandes de ${email}`;
  return (
    <div className="space-y-4">
      <p className="text-[15px]">
        {demandes.length === 1
          ? `1 demande trouvée pour ${email}.`
          : `${demandes.length} demandes trouvées pour ${email}.`}
      </p>

      {/* Tablette et ordinateur. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table aria-label={libelle} className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={CLASSE_ENTETE}>Référence</th>
              <th scope="col" className={CLASSE_ENTETE}>Date</th>
              <th scope="col" className={CLASSE_ENTETE}>Objet</th>
              <th scope="col" className={CLASSE_ENTETE}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {demandes.map((demande) => (
              <tr key={demande.id} data-reference={demande.reference} className="last:[&>td]:border-b-0">
                <td className={CLASSE_CELLULE}>
                  <Link href={adresseDetail(demande.reference)} prefetch={false} className={CLASSE_LIEN_REFERENCE}>
                    {demande.reference}
                  </Link>
                </td>
                <td className={`${CLASSE_CELLULE} whitespace-nowrap text-foreground/80`}>
                  {formaterDate(demande.creeLe)}
                </td>
                <td className={`${CLASSE_CELLULE} min-w-40 break-words`}>{demande.objet}</td>
                <td className={CLASSE_CELLULE}>
                  <BadgeStatut statut={demande.statut} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Téléphone : une carte par demande. */}
      <ul className="space-y-3 sm:hidden" aria-label={libelle}>
        {demandes.map((demande) => (
          <li
            key={demande.id}
            data-reference={demande.reference}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link href={adresseDetail(demande.reference)} prefetch={false} className={CLASSE_LIEN_REFERENCE}>
                {demande.reference}
              </Link>
              <span className="text-[13px] text-muted-foreground">{formaterDate(demande.creeLe)}</span>
            </div>
            <p className="mt-1.5 font-medium break-words">{demande.objet}</p>
            <div className="mt-2">
              <BadgeStatut statut={demande.statut} />
            </div>
          </li>
        ))}
      </ul>

      <FenetreEffacer
        trouvees={trouvees}
        desactive={desactive}
        apresEffacement={apresEffacement}
        focaliserBandeau={focaliserBandeau}
      />
    </div>
  );
}

/**
 * Fenêtre de confirmation (modèle `FenetreDesactiver`) : « Annuler » à
 * gauche et sélectionné à l'ouverture, bouton destructeur à droite.
 */
function FenetreEffacer({
  trouvees,
  desactive,
  apresEffacement,
  focaliserBandeau,
}: {
  trouvees: Trouvees;
  desactive: boolean;
  apresEffacement: (resultat: ResultatEffacement) => void;
  focaliserBandeau: () => void;
}) {
  const [ouverte, setOuverte] = useState(false);
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  // Échec : à la fermeture, le focus va au bandeau, pas au déclencheur.
  const echec = useRef(false);
  const { afficher } = useToasts();
  const nombre = trouvees.demandes.length;

  function changerOuverture(valeur: boolean) {
    if (!valeur && enVol.current) return;
    setOuverte(valeur);
  }

  function confirmer() {
    if (enVol.current) return;
    enVol.current = true;
    demarrer(async () => {
      let resultat: ResultatEffacement;
      try {
        const reponse = await effacerDemandeur(
          trouvees.email,
          trouvees.demandes.map((d) => d.id),
        );
        resultat = reponse.ok ? { ok: true, nombre: reponse.donnees.nombre } : reponse;
      } catch {
        resultat = {
          ok: false,
          code: "ERREUR_INATTENDUE",
          message: messageErreur("ERREUR_INATTENDUE"),
        };
      } finally {
        enVol.current = false;
      }
      echec.current = !resultat.ok;
      setOuverte(false);
      // Échec : le bandeau seul (jamais le même message deux fois).
      if (resultat.ok) afficher("succes", texteDemandesEffacees(resultat.nombre));
      apresEffacement(resultat);
    });
  }

  return (
    <AlertDialog open={ouverte} onOpenChange={changerOuverture}>
      <Button
        type="button"
        disabled={desactive}
        onClick={() => setOuverte(true)}
        className="h-11 w-full rounded-md bg-destructive px-5 text-[15px] font-semibold text-white hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/40 sm:w-auto"
      >
        {texteBoutonEffacer(nombre)}
      </Button>
      <AlertDialogContent
        onCloseAutoFocus={(evenement) => {
          if (!echec.current) return;
          echec.current = false;
          evenement.preventDefault();
          focaliserBandeau();
        }}
        className="rounded-lg bg-surface p-5 shadow-sm data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="text-lg font-semibold leading-[1.4]">
            {nombre === 1 ? "Effacer la demande" : "Effacer les demandes"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left text-sm leading-[1.5] break-words text-foreground">
            {texteConfirmationEffacement(nombre, trouvees.email)}
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
            {envoi ? "Effacement…" : texteBoutonEffacer(nombre)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
