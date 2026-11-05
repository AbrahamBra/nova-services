"use client";

import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  changerCategorie,
  changerPriorite,
  changerStatut,
  classerSansSuite,
  prendreEnCharge,
  type EtatApresStatut,
  type ResultatChangementStatut,
} from "@/lib/actions/demandes";
import {
  LIBELLES_PRIORITE,
  LIBELLES_STATUT,
  PRIORITES,
  type Priorite,
  type Statut,
} from "@/lib/domaine";
import { messageErreur, type CodeErreur } from "@/lib/erreurs";
import { formaterNombre } from "@/lib/format";
import { longueur } from "@/lib/schemas/depot";
import {
  LONGUEUR_MAX_NOTE,
  MESSAGES_CLASSEMENT,
  verifierRaisonClassement,
} from "@/lib/schemas/traitement";

// Actions du panneau du détail d'une demande (EXPERIENCE.md §4, §9.5).
// La page n'affiche que les actions permises pour l'état de la demande ;
// la base refuse de toute façon une action interdite (droits compris).
// Chaque action donne un toast, puis le détail est rafraîchi par l'action
// serveur (sans recharger la page).
// Story 2.1 : « Prendre en charge », si la demande est Nouvelle et sans
// responsable (aucune condition de rôle : tout membre actif).
// Story 2.3 : partie « Statut », seuls passages permis par la règle 1 :
// « Marquer comme traitée » (En cours), « Rouvrir » (Traitée), « Classer
// sans suite » (Nouvelle, fenêtre de confirmation avec raison obligatoire).
// Story 2.4 : listes « Priorité » et « Catégorie », quel que soit le statut ;
// le choix d'une valeur l'enregistre aussitôt.

/** Message de réussite de la prise en charge (EXPERIENCE.md §10, flow 2). */
export const MESSAGE_PRISE_EN_CHARGE = "Vous êtes responsable de cette demande.";

export function BoutonPrendreEnCharge({ demandeId }: { demandeId: string }) {
  const [envoi, demarrer] = useTransition();
  // Appel « en vol » : deux clics avant le nouveau rendu n'envoient qu'un appel.
  const enVol = useRef(false);
  const { afficher } = useToasts();

  function prendre() {
    if (enVol.current) return;
    enVol.current = true;
    demarrer(async () => {
      try {
        const resultat = await prendreEnCharge(demandeId);
        if (resultat.ok) afficher("succes", MESSAGE_PRISE_EN_CHARGE);
        else afficher("erreur", resultat.message);
      } catch {
        // Action injoignable (réseau coupé) : rien ne change à l'écran.
        afficher("erreur", messageErreur("ERREUR_INATTENDUE"));
      } finally {
        enVol.current = false;
      }
    });
  }

  return (
    <Bouton type="button" onClick={prendre} disabled={envoi} className="mt-3 w-full">
      {envoi ? "Prise en charge…" : "Prendre en charge"}
    </Bouton>
  );
}

// --- Statut (story 2.3) ------------------------------------------------------

/** Messages de réussite des changements de statut. */
export const MESSAGES_STATUT = {
  traitee: "Demande marquée comme traitée.",
  rouverte: "Demande rouverte.",
  rouverteNouvelle:
    "Demande rouverte. Son responsable n'est plus actif : elle revient en Nouvelle.",
  rouverteSansResponsable: "Demande rouverte. Elle revient en Nouvelle, sans responsable.",
  classee: "Demande classée sans suite.",
} as const;

/** Texte de la fenêtre « Classer sans suite » : ce qui va se passer. */
export const TEXTE_FENETRE_CLASSEMENT =
  "La demande passera à Traitée sans être traitée. Indiquez la raison (spam, doublon…) : elle sera ajoutée aux notes internes.";

/** Libellé de la zone de la raison. */
export const LIBELLE_RAISON_CLASSEMENT = "Raison du classement";

/** Refus « attendus » : l'action n'est plus possible, le détail est rafraîchi. */
const CODES_REFUS_ATTENDUS: readonly CodeErreur[] = [
  "PASSAGE_INTERDIT",
  "DEMANDE_INTROUVABLE",
  "DROIT_INSUFFISANT",
];

/**
 * Message de réussite d'un changement de statut, selon le statut demandé
 * (`vers`) et l'état obtenu. Rouvrir : la base renvoie Nouvelle si le
 * responsable n'est plus actif, ou si la demande n'en avait pas (classée
 * sans suite).
 */
export function messageReussiteStatut(
  vers: "en_cours" | "traitee",
  obtenu: Pick<EtatApresStatut, "statut" | "avaitResponsable">,
): string {
  if (vers === "traitee") return MESSAGES_STATUT.traitee;
  if (obtenu.statut !== "nouvelle") return MESSAGES_STATUT.rouverte;
  return obtenu.avaitResponsable
    ? MESSAGES_STATUT.rouverteNouvelle
    : MESSAGES_STATUT.rouverteSansResponsable;
}

const CLASSE_BOUTON_SECONDAIRE =
  "mt-3 h-11 w-full rounded-md bg-surface px-5 text-[15px] font-semibold text-foreground";

type PropsActionStatut = {
  demandeId: string;
  /** Place le focus sur la partie « Statut » (le bouton cliqué va disparaître). */
  focaliserStatut: () => void;
};

function BoutonChangerStatut({
  demandeId,
  vers,
  focaliserStatut,
}: PropsActionStatut & { vers: "en_cours" | "traitee" }) {
  const [envoi, demarrer] = useTransition();
  // Appel « en vol » : deux clics avant le nouveau rendu n'envoient qu'un appel.
  const enVol = useRef(false);
  const { afficher } = useToasts();

  function changer() {
    if (enVol.current) return;
    enVol.current = true;
    demarrer(async () => {
      try {
        const resultat = await changerStatut(demandeId, vers);
        if (resultat.ok) {
          afficher("succes", messageReussiteStatut(vers, resultat.donnees));
          focaliserStatut();
        } else {
          afficher("erreur", resultat.message);
          if (CODES_REFUS_ATTENDUS.includes(resultat.code)) focaliserStatut();
        }
      } catch {
        // Action injoignable (réseau coupé) : rien ne change à l'écran.
        afficher("erreur", messageErreur("ERREUR_INATTENDUE"));
      } finally {
        enVol.current = false;
      }
    });
  }

  if (vers === "traitee") {
    // Action principale d'une demande En cours (maquette key-detail-demande.html).
    return (
      <Bouton type="button" onClick={changer} disabled={envoi} className="mt-3 w-full">
        {envoi ? "Enregistrement…" : "Marquer comme traitée"}
      </Bouton>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      onClick={changer}
      disabled={envoi}
      className={CLASSE_BOUTON_SECONDAIRE}
    >
      {envoi ? "Réouverture…" : "Rouvrir"}
    </Button>
  );
}

/**
 * Fenêtre « Classer sans suite » (UX-DR6, UX-DR9, EXPERIENCE.md §4, §7) :
 * AlertDialog shadcn (focus gardé dans la fenêtre, Échap ferme, focus rendu
 * au bouton d'origine, « Annuler » sélectionné à l'ouverture).
 * - Raison vide ou trop longue (écran ou base) : message sous la zone,
 *   `aria-invalid`, fenêtre ouverte.
 * - Réussite : toast, fenêtre fermée, focus sur la partie « Statut ».
 * - Refus attendu (passage interdit, introuvable, droit) : l'action n'est
 *   plus possible ; fenêtre fermée, raison abandonnée, toast rouge, focus sur
 *   la partie « Statut » (le détail est rafraîchi par l'action).
 * - Erreur serveur ou réseau : toast rouge seulement, fenêtre ouverte,
 *   raison conservée.
 */
function FenetreClasserSansSuite({ demandeId, focaliserStatut }: PropsActionStatut) {
  const id = useId();
  const idZone = `${id}-raison`;
  const idCompteur = `${id}-compteur`;
  const idErreur = `${id}-erreur`;
  const zoneRef = useRef<HTMLTextAreaElement>(null);
  const [ouverte, setOuverte] = useState(false);
  const [raison, setRaison] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  // Appel « en vol » : deux clics avant le nouveau rendu n'envoient qu'un appel.
  const enVol = useRef(false);
  // Un envoi a eu lieu depuis l'ouverture : à la fermeture (ou au démontage
  // par le rafraîchissement), le focus va à la partie « Statut », le bouton
  // d'origine pouvant avoir disparu.
  const focusSurStatut = useRef(false);
  const { afficher } = useToasts();

  function changerOuverture(valeur: boolean) {
    // Pas de fermeture (Échap) pendant l'envoi.
    if (!valeur && enVol.current) return;
    setOuverte(valeur);
    if (valeur) focusSurStatut.current = false;
    else setErreur(null);
  }

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enVol.current) return;

    // Même schéma que l'action (AD-8) : raison vide refusée sans appel.
    const verification = verifierRaisonClassement(raison);
    if (!verification.ok) {
      setErreur(verification.message);
      zoneRef.current?.focus();
      return;
    }

    setErreur(null);
    enVol.current = true;
    focusSurStatut.current = true;
    demarrer(async () => {
      let resultat: ResultatChangementStatut;
      try {
        resultat = await classerSansSuite(demandeId, verification.texte);
      } catch {
        resultat = {
          ok: false,
          code: "ERREUR_INATTENDUE",
          message: messageErreur("ERREUR_INATTENDUE"),
        };
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        afficher("succes", MESSAGES_STATUT.classee);
        setRaison("");
        setOuverte(false);
      } else if (resultat.code === "DONNEES_INVALIDES") {
        // Raison refusée par la base : message sous la zone, pas de toast.
        focusSurStatut.current = false;
        setErreur(resultat.message);
        zoneRef.current?.focus();
      } else if (CODES_REFUS_ATTENDUS.includes(resultat.code)) {
        afficher("erreur", resultat.message);
        setRaison("");
        setOuverte(false);
      } else {
        // Erreur serveur ou réseau : la fenêtre reste ouverte, raison conservée.
        focusSurStatut.current = false;
        afficher("erreur", resultat.message);
      }
    });
  }

  // Compté comme le schéma : espaces de début et de fin retirés.
  const nombreCaracteres = longueur(raison.trim());
  const enTrop = nombreCaracteres > LONGUEUR_MAX_NOTE;
  const message = erreur ?? (enTrop ? MESSAGES_CLASSEMENT.long : null);

  return (
    <AlertDialog open={ouverte} onOpenChange={changerOuverture}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className={CLASSE_BOUTON_SECONDAIRE}>
          Classer sans suite
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(evenement) => {
          if (!focusSurStatut.current) return;
          focusSurStatut.current = false;
          evenement.preventDefault();
          focaliserStatut();
        }}
        className="rounded-lg bg-surface p-5 shadow-sm data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md"
      >
        <form noValidate onSubmit={soumettre} className="grid gap-4">
          <AlertDialogHeader className="place-items-start text-left">
            <AlertDialogTitle className="text-lg font-semibold leading-[1.4]">
              Classer sans suite
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm leading-[1.5] text-foreground">
              {TEXTE_FENETRE_CLASSEMENT}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={idZone} className="text-sm font-medium leading-[1.4]">
              {LIBELLE_RAISON_CLASSEMENT}
            </Label>
            <Textarea
              ref={zoneRef}
              id={idZone}
              name="raison"
              rows={3}
              value={raison}
              readOnly={envoi}
              onChange={(evenement) => {
                setRaison(evenement.target.value);
                if (erreur) setErreur(null);
              }}
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? `${idCompteur} ${idErreur}` : idCompteur}
              className="min-h-[96px] field-sizing-fixed rounded-md bg-surface px-3 py-2.5 text-[15px] md:text-[15px]"
            />
            <p
              id={idCompteur}
              data-testid="compteur-raison"
              className={`text-right text-[13px] ${
                enTrop ? "font-medium text-destructive" : "text-muted-foreground"
              }`}
            >
              {formaterNombre(nombreCaracteres)} / {formaterNombre(LONGUEUR_MAX_NOTE)}
            </p>
            <div id={idErreur} aria-live="polite">
              {message ? (
                <p data-testid="erreur-raison" className="text-[13px] leading-[1.4] text-destructive">
                  {message}
                </p>
              ) : null}
            </div>
          </div>
          {/* « Annuler » à gauche, bouton destructeur à droite (sur téléphone :
              destructeur au-dessus, Annuler dessous, ordre shadcn). */}
          <AlertDialogFooter className="-mx-5 -mb-5 bg-surface p-5 sm:justify-between">
            <AlertDialogCancel
              disabled={envoi}
              className="h-11 rounded-md bg-surface px-5 text-[15px] font-semibold text-foreground"
            >
              Annuler
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={envoi}
              className="h-11 rounded-md bg-destructive px-5 text-[15px] font-semibold text-white hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/40"
            >
              {envoi ? "Classement…" : "Classer sans suite"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Partie « Statut » : seul le passage permis pour le statut affiché (règle 1
 * du PRD), pour tout membre actif. Nouvelle → En cours passe par « Prendre en
 * charge » ; En cours → Nouvelle par « Libérer » (story 2.7).
 * Le conteneur reste en place quand le statut change : après une action, il
 * reçoit le focus (le bouton cliqué disparaît), et annonce le statut.
 */
export function ActionsStatut({ demandeId, statut }: { demandeId: string; statut: Statut }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const focaliserStatut = () => conteneur.current?.focus();
  const props = { demandeId, focaliserStatut };

  let action: ReactNode;
  switch (statut) {
    case "en_cours":
      action = <BoutonChangerStatut key="traitee" {...props} vers="traitee" />;
      break;
    case "traitee":
      action = <BoutonChangerStatut key="en_cours" {...props} vers="en_cours" />;
      break;
    case "nouvelle":
      action = <FenetreClasserSansSuite key="nouvelle" {...props} />;
      break;
    default: {
      // Un nouveau statut doit recevoir ses actions ici.
      const inconnu: never = statut;
      throw new Error(`Statut sans actions : ${String(inconnu)}`);
    }
  }

  return (
    <div
      ref={conteneur}
      tabIndex={-1}
      role="group"
      aria-label={`Statut : ${LIBELLES_STATUT[statut]}`}
      data-testid="actions-statut"
      className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {action}
    </div>
  );
}

// --- Priorité et catégorie (story 2.4) ----------------------------------------

/** Messages de réussite (EXPERIENCE.md §4) : « Priorité modifiée : Haute. ». */
export function messagePrioriteModifiee(priorite: Priorite): string {
  return `Priorité modifiée : ${LIBELLES_PRIORITE[priorite]}.`;
}

export function messageCategorieModifiee(nom: string): string {
  return `Catégorie modifiée : ${nom}.`;
}

/** Suffixe de la catégorie actuelle quand elle a été désactivée (règle 9). */
export const SUFFIXE_CATEGORIE_DESACTIVEE = " (désactivée)";

/** Catégorie proposée dans la liste (active, dans l'ordre des formulaires). */
export type CategorieProposee = { id: string; nom: string };

/** Catégorie actuelle de la demande, avec son état réel. */
export type CategorieActuelle = CategorieProposee & { actif: boolean };

const CLASSE_LISTE =
  "mt-3 w-full [&_select]:h-11 [&_select]:rounded-md [&_select]:bg-surface [&_select]:pl-3 [&_select]:text-[15px]";

type ResultatEnvoi =
  | { ok: true; donnees: { modifiee: boolean } }
  | { ok: false; code: CodeErreur; message: string };

/**
 * Liste qui enregistre aussitôt la valeur choisie, libellée par le `<dt>` du
 * panneau (`aria-labelledby`). Pendant l'envoi : la valeur choisie reste
 * affichée et la liste est désactivée (deux choix rapides n'envoient qu'un
 * appel). Réussite : toast (aucun si la valeur était déjà en place), la liste
 * suit la valeur rafraîchie par l'action serveur. Refus : toast rouge, valeur
 * précédente remise (le détail est rafraîchi par l'action). Erreur
 * inattendue ou réponse perdue (la base a pu enregistrer) : toast rouge et
 * rafraîchissement depuis le navigateur, pour montrer la vraie valeur. La
 * liste perd le focus en étant désactivée : il lui est rendu à la fin.
 */
function ListeEnregistree<T extends string>({
  idLibelle,
  valeur,
  options,
  envoyer,
  messageReussite,
  testId,
}: {
  idLibelle: string;
  valeur: T;
  options: { valeur: T; texte: string; disabled?: boolean }[];
  envoyer: (valeur: T) => Promise<ResultatEnvoi>;
  messageReussite: (valeur: T) => string;
  testId: string;
}) {
  const router = useRouter();
  const liste = useRef<HTMLSelectElement>(null);
  const [envoi, demarrer] = useTransition();
  // Appel « en vol » : deux choix avant le nouveau rendu n'envoient qu'un appel.
  const enVol = useRef(false);
  const rendreFocus = useRef(false);
  // Valeur choisie, affichée pendant l'envoi et tant que la valeur reçue n'a
  // pas changé (`depuis`) ; retirée à la fin de l'envoi.
  const [attente, setAttente] = useState<{ valeur: T; depuis: T } | null>(null);
  const { afficher } = useToasts();

  // Fin de l'envoi, liste réactivée : focus rendu, sauf si la personne l'a
  // déjà placé ailleurs (la liste désactivée l'a perdu au profit de <body>).
  useEffect(() => {
    if (envoi || !rendreFocus.current) return;
    const element = liste.current;
    if (!element || element.disabled) return;
    rendreFocus.current = false;
    const actif = document.activeElement;
    if (actif === null || actif === document.body || actif === element) element.focus();
  }, [envoi]);

  const affichee = attente !== null && attente.depuis === valeur ? attente.valeur : valeur;

  function choisir(evenement: ChangeEvent<HTMLSelectElement>) {
    const choisie = evenement.target.value as T;
    if (enVol.current || choisie === affichee) return;
    enVol.current = true;
    rendreFocus.current = true;
    setAttente({ valeur: choisie, depuis: valeur });
    demarrer(async () => {
      let resultat: ResultatEnvoi;
      try {
        resultat = await envoyer(choisie);
      } catch {
        // Action injoignable ou réponse perdue.
        resultat = {
          ok: false,
          code: "ERREUR_INATTENDUE",
          message: messageErreur("ERREUR_INATTENDUE"),
        };
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        if (resultat.donnees.modifiee) afficher("succes", messageReussite(choisie));
      } else {
        afficher("erreur", resultat.message);
        if (resultat.code === "ERREUR_INATTENDUE") router.refresh();
      }
      // Dans la transition : retirée en même temps que le nouveau rendu.
      startTransition(() => setAttente(null));
    });
  }

  return (
    <NativeSelect
      ref={liste}
      value={affichee}
      onChange={choisir}
      disabled={envoi}
      aria-labelledby={idLibelle}
      aria-busy={envoi || undefined}
      data-testid={testId}
      className={CLASSE_LISTE}
    >
      {options.map((option) => (
        <NativeSelectOption key={option.valeur} value={option.valeur} disabled={option.disabled}>
          {option.texte}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Liste « Priorité » (Basse, Normale, Haute), sous le badge actuel. */
export function ChoixPriorite({
  demandeId,
  priorite,
  idLibelle,
}: {
  demandeId: string;
  priorite: Priorite;
  /** Identifiant du `<dt>` « Priorité » du panneau. */
  idLibelle: string;
}) {
  return (
    <ListeEnregistree<Priorite>
      idLibelle={idLibelle}
      valeur={priorite}
      options={PRIORITES.map((p) => ({ valeur: p, texte: LIBELLES_PRIORITE[p] }))}
      envoyer={(valeur) => changerPriorite(demandeId, valeur)}
      messageReussite={messagePrioriteModifiee}
      testId="choix-priorite"
    />
  );
}

/**
 * Options de la liste « Catégorie » : les catégories actives, dans l'ordre
 * des formulaires. Si la catégorie actuelle est désactivée (état réel), elle
 * vient en tête, suivie de « (désactivée) », sans pouvoir être choisie à
 * nouveau.
 */
export function optionsCategorie(
  actuelle: CategorieActuelle,
  actives: CategorieProposee[],
): { valeur: string; texte: string; disabled?: boolean }[] {
  const options = actives.map((c) => ({ valeur: c.id, texte: c.nom }));
  if (actuelle.actif) return options;
  return [
    {
      valeur: actuelle.id,
      texte: `${actuelle.nom}${SUFFIXE_CATEGORIE_DESACTIVEE}`,
      disabled: true,
    },
    ...options,
  ];
}

/** Liste « Catégorie » : modifiable par l'équipe (EXPERIENCE.md §9.5). */
export function ChoixCategorie({
  demandeId,
  actuelle,
  actives,
  idLibelle,
}: {
  demandeId: string;
  /** Catégorie actuelle de la demande, nom actuel et état réel (règle 9). */
  actuelle: CategorieActuelle;
  actives: CategorieProposee[];
  /** Identifiant du `<dt>` « Catégorie » du panneau. */
  idLibelle: string;
}) {
  const nomDe = (id: string) => actives.find((c) => c.id === id)?.nom ?? actuelle.nom;
  return (
    <ListeEnregistree<string>
      idLibelle={idLibelle}
      valeur={actuelle.id}
      options={optionsCategorie(actuelle, actives)}
      envoyer={(valeur) => changerCategorie(demandeId, valeur)}
      messageReussite={(valeur) => messageCategorieModifiee(nomDe(valeur))}
      testId="choix-categorie"
    />
  );
}
