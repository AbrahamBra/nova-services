"use client";

import {
  startTransition,
  useActionState,
  useTransition,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { unstable_rethrow } from "next/navigation";
import { CLASSE_CHAMP, CLASSE_LIBELLE, MessageErreur } from "@/components/formulaire-depot";
import { CopierReference } from "@/components/copier-reference";
import { Bouton } from "@/components/nova/bouton";
import { reactiverDepuisEcran } from "@/components/nova/comptes/actions-compte";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inviter } from "@/lib/actions/admin";
import { messageErreur } from "@/lib/erreurs";
import { MESSAGES_COMPTE } from "@/lib/schemas/compte";
import {
  ETAT_INVITATION_INITIAL,
  OPTIONS_ROLE,
  RAPPEL_VALIDITE_LIEN,
  ROLE_PAR_DEFAUT,
  lireSaisieInvitation,
  premierChampInvitationEnErreur,
  verifierInvitation,
  type ChampInvitation,
  type ErreursInvitation,
  type EtatInvitation,
  type InvitationCreee,
} from "@/lib/schemas/invitation";

// Bouton « Inviter un membre » et ses deux fenêtres (EXPERIENCE.md §9.7,
// story 4.1) :
//   - « Inviter un membre » : Nom, Email, Rôle (Collaborateur par défaut) ;
//     erreurs sous le champ, focus sur le premier en erreur, saisie
//     conservée, « Envoi en cours… » ;
//   - après l'invitation, la fenêtre du lien (mode démonstration : aucun
//     email n'est envoyé) : le lien en lecture seule, « Copier » et
//     « Ce lien est valable 24 h. ».
// La liste des comptes est rafraîchie par l'action (revalidatePath).
// Story 4.2 : adresse d'un compte désactivé, « Cette adresse appartient à un
// compte désactivé. » sous Email et un bouton « Réactiver ce compte » qui
// réactive ce membre, ferme la fenêtre et affiche le toast.

async function envoyerAuServeur(etat: EtatInvitation, donnees: FormData): Promise<EtatInvitation> {
  try {
    return (await inviter(etat, donnees)) ?? etat;
  } catch (erreur) {
    unstable_rethrow(erreur);
    return {
      erreurs: {},
      erreurGenerale: messageErreur("ERREUR_INATTENDUE"),
      tentative: etat.tentative + 1,
      invitation: null,
    };
  }
}

export function InviterMembre() {
  const [ouverte, setOuverte] = useState(false);
  // Clé du formulaire : une nouvelle ouverture repart d'une fenêtre vierge.
  const [cle, setCle] = useState(0);
  const [invitation, setInvitation] = useState<InvitationCreee | null>(null);
  // Invitation en cours d'envoi : la fenêtre ne se ferme pas (sinon le
  // membre serait créé sans que son lien soit jamais affiché).
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const boutonRef = useRef<HTMLButtonElement>(null);
  const invitationRef = useRef<InvitationCreee | null>(null);
  const { afficher } = useToasts();
  useEffect(() => {
    invitationRef.current = invitation;
  }, [invitation]);

  return (
    <>
      <Bouton
        ref={boutonRef}
        type="button"
        pleineLargeurTelephone
        onClick={() => {
          setCle((c) => c + 1);
          setOuverte(true);
        }}
      >
        Inviter un membre
      </Bouton>

      <Dialog
        open={ouverte}
        onOpenChange={(ouvert) => {
          if (!ouvert && envoiEnCours) return;
          setOuverte(ouvert);
        }}
      >
        <DialogContent
          fermetureDesactivee={envoiEnCours}
          onEscapeKeyDown={(evenement) => {
            if (envoiEnCours) evenement.preventDefault();
          }}
          onPointerDownOutside={(evenement) => {
            if (envoiEnCours) evenement.preventDefault();
          }}
          onCloseAutoFocus={(evenement) => {
            // Fermée sans invitation : le focus revient au bouton. Après une
            // invitation, la fenêtre du lien garde le focus.
            evenement.preventDefault();
            if (!invitationRef.current) boutonRef.current?.focus();
          }}
        >
          <FormulaireInvitation
            key={cle}
            onInvite={(creee) => {
              invitationRef.current = creee;
              setEnvoiEnCours(false);
              setOuverte(false);
              setInvitation(creee);
            }}
            onAnnuler={() => setOuverte(false)}
            onOccupe={setEnvoiEnCours}
            onReactive={() => {
              setEnvoiEnCours(false);
              setOuverte(false);
              afficher("succes", MESSAGES_COMPTE.reactive);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={invitation !== null}
        onOpenChange={(ouvert) => {
          if (!ouvert) setInvitation(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(evenement) => {
            // Le focus revient au bouton « Inviter un membre ».
            evenement.preventDefault();
            boutonRef.current?.focus();
          }}
        >
          {invitation ? <ContenuLien invitation={invitation} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FormulaireInvitation({
  onInvite,
  onAnnuler,
  onOccupe,
  onReactive,
}: {
  onInvite: (invitation: InvitationCreee) => void;
  onAnnuler: () => void;
  /** Signale au parent l'envoi en cours (fermeture bloquée). */
  onOccupe: (occupe: boolean) => void;
  /** Story 4.2 : compte désactivé réactivé depuis la fenêtre. */
  onReactive: () => void;
}) {
  const id = useId();
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [etat, envoyer, enCours] = useActionState(envoyerAuServeur, ETAT_INVITATION_INITIAL);

  const [erreurs, setErreurs] = useState<ErreursInvitation>({});
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  // Story 4.2 : compte désactivé proposé à la réactivation (adresse saisie).
  const [compteDesactive, setCompteDesactive] = useState<string | null>(null);
  const [reactivation, demarrerReactivation] = useTransition();
  const [tentativeVue, setTentativeVue] = useState(etat.tentative);
  if (etat.tentative !== tentativeVue) {
    setTentativeVue(etat.tentative);
    setErreurs(etat.erreurs);
    setErreurGenerale(etat.erreurGenerale);
    setCompteDesactive(etat.compteDesactive?.id ?? null);
  }

  function reactiver() {
    if (!compteDesactive || reactivation) return;
    const id = compteDesactive;
    demarrerReactivation(async () => {
      const resultat = await reactiverDepuisEcran(id);
      if (resultat.ok) {
        onReactive();
      } else {
        setErreurGenerale(resultat.message);
        requestAnimationFrame(() => bandeauRef.current?.focus());
      }
    });
  }

  const idChamp = (champ: ChampInvitation) => `${id}-${champ}`;
  const idErreur = (champ: ChampInvitation) => `${id}-${champ}-erreur`;

  useEffect(() => {
    if (etat.tentative === 0) return;
    if (etat.invitation) {
      onInvite(etat.invitation);
      return;
    }
    const champ = premierChampInvitationEnErreur(etat.erreurs);
    if (champ) {
      document.getElementById(`${id}-${champ}`)?.focus();
    } else if (etat.erreurGenerale) {
      bandeauRef.current?.focus();
    }
    // `onInvite` change à chaque rendu du parent : seule la réponse compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat, id]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return; // un second clic est sans effet

    const donnees = new FormData(evenement.currentTarget);
    const verification = verifierInvitation(lireSaisieInvitation(donnees));
    if (!verification.ok) {
      setErreurs(verification.erreurs);
      setErreurGenerale(null);
      const champ = premierChampInvitationEnErreur(verification.erreurs);
      if (champ) document.getElementById(idChamp(champ))?.focus();
      return;
    }

    setErreurs({});
    setErreurGenerale(null);
    setCompteDesactive(null);
    startTransition(() => envoyer(donnees));
  }

  function aria(champ: ChampInvitation) {
    const enErreur = Boolean(erreurs[champ]);
    return {
      "aria-invalid": enErreur || undefined,
      "aria-describedby": enErreur ? idErreur(champ) : undefined,
    };
  }

  const occupe = enCours || reactivation || etat.invitation !== null;

  // Invitation ou « Réactiver ce compte » en cours : fermeture bloquée.
  useEffect(() => {
    onOccupe(enCours || reactivation);
  }, [enCours, reactivation, onOccupe]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Inviter un membre</DialogTitle>
        <DialogDescription>
          Le membre choisira lui-même son mot de passe grâce au lien d&apos;invitation.
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        className="space-y-4"
        onSubmit={soumettre}
        onChange={(evenement) => {
          const nom = (evenement.target as unknown as { name?: unknown }).name;
          if (nom === "email") setCompteDesactive(null);
          if (typeof nom === "string" && nom in erreurs) {
            setErreurs((actuelles) => {
              const suivantes = { ...actuelles };
              delete suivantes[nom as ChampInvitation];
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
              className={CLASSE_CHAMP}
              {...aria("nom")}
            />
          </div>
          <MessageErreur id={idErreur("nom")} message={erreurs.nom} />
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("email")} className={CLASSE_LIBELLE}>
              Email
            </Label>
            <Input
              id={idChamp("email")}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              required
              className={CLASSE_CHAMP}
              {...aria("email")}
            />
          </div>
          <MessageErreur id={idErreur("email")} message={erreurs.email} />
          {compteDesactive && erreurs.email ? (
            <Button
              type="button"
              variant="outline"
              onClick={reactiver}
              disabled={occupe}
              className="mt-2 h-9 rounded-md bg-surface px-3 text-[13px] font-semibold text-foreground"
            >
              {reactivation ? "Réactivation…" : "Réactiver ce compte"}
            </Button>
          ) : null}
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("role")} className={CLASSE_LIBELLE}>
              Rôle
            </Label>
            <NativeSelect
              id={idChamp("role")}
              name="role"
              required
              defaultValue={ROLE_PAR_DEFAUT}
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

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onAnnuler}
            disabled={occupe}
            className="h-11 rounded-md bg-surface px-5 text-[15px] font-semibold"
          >
            Annuler
          </Button>
          <Bouton type="submit" disabled={occupe}>
            {occupe ? "Envoi en cours…" : "Inviter"}
          </Bouton>
        </DialogFooter>
      </form>
    </>
  );
}

function ContenuLien({ invitation }: { invitation: InvitationCreee }) {
  const id = useId();
  return (
    <>
      <DialogHeader>
        <DialogTitle>Lien d&apos;invitation</DialogTitle>
        <DialogDescription>
          {`${invitation.nom} a été invité. Aucun email n'est envoyé : copiez ce lien et transmettez-le-lui.`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-lien`} className={CLASSE_LIBELLE}>
          Lien d&apos;invitation
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${id}-lien`}
            readOnly
            value={invitation.lien}
            onFocus={(evenement) => evenement.currentTarget.select()}
            aria-describedby={`${id}-rappel`}
            className={`${CLASSE_CHAMP} min-w-0 flex-1 font-mono text-[13px] md:text-[13px]`}
          />
          <CopierReference reference={invitation.lien} />
        </div>
        <p id={`${id}-rappel`} className="text-[13px] text-muted-foreground">
          {RAPPEL_VALIDITE_LIEN}
        </p>
      </div>
    </>
  );
}
