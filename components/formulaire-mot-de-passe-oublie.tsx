"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { unstable_rethrow } from "next/navigation";
import { CLASSE_CHAMP, CLASSE_LIBELLE, MessageErreur } from "@/components/formulaire-depot";
import { Bouton } from "@/components/nova/bouton";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { demanderLienMotDePasse } from "@/lib/actions/comptes";
import { messageErreur } from "@/lib/erreurs";
import {
  ETAT_DEMANDE_LIEN_INITIAL,
  MESSAGE_DEMANDE_LIEN,
  lireSaisieDemandeLien,
  verifierDemandeLien,
  type ErreursDemandeLien,
  type EtatDemandeLien,
} from "@/lib/schemas/mot-de-passe";

// Formulaire « Mot de passe oublié » (story 4.3) : un champ Email et
// « Recevoir un lien ». Quel que soit l'email (inconnu, invité, désactivé,
// actif, limite atteinte, envoi impossible), le même message s'affiche : il
// ne dit jamais si un compte existe. Seule une demande qui n'a pas atteint
// le serveur (réseau) donne l'erreur générique, avec « Réessayer ».

async function envoyerAuServeur(etat: EtatDemandeLien, donnees: FormData): Promise<EtatDemandeLien> {
  try {
    return (await demanderLienMotDePasse(etat, donnees)) ?? etat;
  } catch (erreur) {
    unstable_rethrow(erreur);
    return { erreurs: {}, envoyee: false, echecEnvoi: true, tentative: etat.tentative + 1 };
  }
}

export function FormulaireMotDePasseOublie() {
  const id = useId();
  const formulaireRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [etat, envoyer, enCours] = useActionState(envoyerAuServeur, ETAT_DEMANDE_LIEN_INITIAL);

  const [erreurs, setErreurs] = useState<ErreursDemandeLien>({});
  const [envoyee, setEnvoyee] = useState(false);
  const [echecEnvoi, setEchecEnvoi] = useState(false);
  const [tentativeVue, setTentativeVue] = useState(etat.tentative);
  if (etat.tentative !== tentativeVue) {
    setTentativeVue(etat.tentative);
    setErreurs(etat.erreurs);
    setEnvoyee(etat.envoyee);
    setEchecEnvoi(etat.echecEnvoi === true);
  }

  const idEmail = `${id}-email`;
  const idErreur = `${id}-email-erreur`;

  useEffect(() => {
    if (etat.tentative === 0) return;
    if (etat.erreurs.email) document.getElementById(idEmail)?.focus();
    else if (etat.echecEnvoi) bandeauRef.current?.focus();
    else if (etat.envoyee) messageRef.current?.focus();
  }, [etat, idEmail]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return;

    const donnees = new FormData(evenement.currentTarget);
    const verification = verifierDemandeLien(lireSaisieDemandeLien(donnees));
    if (!verification.ok) {
      setErreurs(verification.erreurs);
      setEnvoyee(false);
      setEchecEnvoi(false);
      document.getElementById(idEmail)?.focus();
      return;
    }

    setErreurs({});
    setEnvoyee(false);
    setEchecEnvoi(false);
    startTransition(() => envoyer(donnees));
  }

  const enErreur = Boolean(erreurs.email);

  return (
    <form
      ref={formulaireRef}
      noValidate
      className="mt-6 space-y-4"
      onSubmit={soumettre}
      onChange={() => {
        if (erreurs.email) setErreurs({});
      }}
    >
      {echecEnvoi ? (
        <div
          ref={bandeauRef}
          role="alert"
          tabIndex={-1}
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{messageErreur("ERREUR_INATTENDUE")}</p>
          <BoutonReessayer onReessayer={() => formulaireRef.current?.requestSubmit()} />
        </div>
      ) : null}

      {envoyee ? (
        <div
          ref={messageRef}
          role="status"
          tabIndex={-1}
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p className="font-medium text-primary">{MESSAGE_DEMANDE_LIEN}</p>
        </div>
      ) : null}

      <div>
        <div className="space-y-1.5">
          <Label htmlFor={idEmail} className={CLASSE_LIBELLE}>
            Email
          </Label>
          <Input
            id={idEmail}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            className={CLASSE_CHAMP}
            aria-invalid={enErreur || undefined}
            aria-describedby={enErreur ? idErreur : undefined}
          />
        </div>
        <MessageErreur id={idErreur} message={erreurs.email} />
      </div>

      <Bouton type="submit" disabled={enCours} className="mt-2 w-full">
        {enCours ? "Envoi en cours…" : "Recevoir un lien"}
      </Bouton>
    </form>
  );
}
