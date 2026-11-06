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
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Bouton } from "@/components/nova/bouton";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connexion } from "@/lib/actions/comptes";
import { messageErreur } from "@/lib/erreurs";
import {
  ETAT_CONNEXION_INITIAL,
  lireSaisieConnexion,
  premierChampConnexionEnErreur,
  verifierConnexion,
  type ChampConnexion,
  type ErreursConnexion,
  type EtatConnexion,
} from "@/lib/schemas/connexion";
import { PAGE_MOT_DE_PASSE_OUBLIE } from "@/lib/schemas/mot-de-passe";

// Formulaire « Connexion » (EXPERIENCE.md §9.12, §5) : email et mot de passe,
// vérifiés à l'écran avec le schéma Zod partagé puis par l'action serveur
// `connexion`. En cas d'échec, l'email est conservé et le mot de passe vidé.
// Story 4.3 : lien « Mot de passe oublié » sous le champ Mot de passe.

const CLASSE_CHAMP = "h-11 rounded-md bg-surface px-3 text-[15px] md:text-[15px]";
const CLASSE_LIBELLE = "text-sm font-medium leading-[1.4]";

async function envoyerAuServeur(etat: EtatConnexion, donnees: FormData): Promise<EtatConnexion> {
  try {
    return (await connexion(etat, donnees)) ?? etat;
  } catch (erreur) {
    // La redirection après connexion est laissée à Next.js.
    unstable_rethrow(erreur);
    return {
      erreurs: {},
      erreurGenerale: { type: "serveur", message: messageErreur("ERREUR_INATTENDUE") },
      tentative: etat.tentative + 1,
    };
  }
}

function MessageErreur({ id, message }: { id: string; message?: string }) {
  return (
    <div id={id} aria-live="polite">
      {message ? (
        <p className="mt-1.5 text-[13px] leading-[1.4] text-destructive">{message}</p>
      ) : null}
    </div>
  );
}

/** Texte du bandeau d'expiration (story 1.9, décision d'Abraham). */
export const MESSAGE_SESSION_EXPIREE = "Votre session a expiré. Reconnectez-vous.";

export function FormulaireConnexion({
  retour,
  sessionExpiree = false,
}: {
  retour: string;
  /** Session fermée par proxy.ts après 8 h : bandeau d'information. */
  sessionExpiree?: boolean;
}) {
  const id = useId();
  const formulaireRef = useRef<HTMLFormElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const motDePasseRef = useRef<HTMLInputElement>(null);

  const [etat, envoyer, enCours] = useActionState(envoyerAuServeur, ETAT_CONNEXION_INITIAL);

  const [erreurs, setErreurs] = useState<ErreursConnexion>({});
  const [erreurGenerale, setErreurGenerale] = useState<EtatConnexion["erreurGenerale"]>(null);
  const [tentativeVue, setTentativeVue] = useState(etat.tentative);
  if (etat.tentative !== tentativeVue) {
    setTentativeVue(etat.tentative);
    setErreurs(etat.erreurs);
    setErreurGenerale(etat.erreurGenerale);
  }

  const idChamp = (champ: ChampConnexion) => `${id}-${champ}`;
  const idErreur = (champ: ChampConnexion) => `${id}-${champ}-erreur`;

  // Après une réponse en erreur : focus sur le premier champ en erreur, sinon
  // sur le bandeau. Un refus vide le mot de passe (l'email reste).
  useEffect(() => {
    if (etat.tentative === 0) return;
    const champ = premierChampConnexionEnErreur(etat.erreurs);
    if (champ) {
      document.getElementById(`${id}-${champ}`)?.focus();
    } else if (etat.erreurGenerale) {
      if (etat.erreurGenerale.type === "refus" && motDePasseRef.current) {
        motDePasseRef.current.value = "";
      }
      bandeauRef.current?.focus();
    }
  }, [etat, id]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return;

    const donnees = new FormData(evenement.currentTarget);
    const verification = verifierConnexion(lireSaisieConnexion(donnees));
    if (!verification.ok) {
      setErreurs(verification.erreurs);
      setErreurGenerale(null);
      const champ = premierChampConnexionEnErreur(verification.erreurs);
      if (champ) document.getElementById(idChamp(champ))?.focus();
      return;
    }

    setErreurs({});
    setErreurGenerale(null);
    startTransition(() => envoyer(donnees));
  }

  function aria(champ: ChampConnexion) {
    const enErreur = Boolean(erreurs[champ]);
    return {
      "aria-invalid": enErreur || undefined,
      "aria-describedby": enErreur ? idErreur(champ) : undefined,
    };
  }

  return (
    <form
      ref={formulaireRef}
      noValidate
      className="mt-6 space-y-4"
      action={envoyer}
      onSubmit={soumettre}
      onChange={(evenement) => {
        const nom = (evenement.target as unknown as { name?: unknown }).name;
        if (typeof nom === "string" && nom in erreurs) {
          setErreurs((actuelles) => {
            const suivantes = { ...actuelles };
            delete suivantes[nom as ChampConnexion];
            return suivantes;
          });
        }
      }}
    >
      <input type="hidden" name="retour" value={retour} />

      {sessionExpiree && !erreurGenerale ? (
        <div
          role="status"
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
        >
          <p className="font-medium text-primary">{MESSAGE_SESSION_EXPIREE}</p>
        </div>
      ) : null}

      {erreurGenerale ? (
        <div
          ref={bandeauRef}
          role="alert"
          tabIndex={-1}
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{erreurGenerale.message}</p>
          {erreurGenerale.type === "serveur" ? (
            <BoutonReessayer onReessayer={() => formulaireRef.current?.requestSubmit()} />
          ) : null}
        </div>
      ) : null}

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
            autoComplete="username"
            required
            className={CLASSE_CHAMP}
            {...aria("email")}
          />
        </div>
        <MessageErreur id={idErreur("email")} message={erreurs.email} />
      </div>

      <div>
        <div className="space-y-1.5">
          <Label htmlFor={idChamp("mot_de_passe")} className={CLASSE_LIBELLE}>
            Mot de passe
          </Label>
          <Input
            ref={motDePasseRef}
            id={idChamp("mot_de_passe")}
            name="mot_de_passe"
            type="password"
            autoComplete="current-password"
            required
            className={CLASSE_CHAMP}
            {...aria("mot_de_passe")}
          />
        </div>
        <MessageErreur id={idErreur("mot_de_passe")} message={erreurs.mot_de_passe} />
        <p className="mt-2 text-sm">
          <Link
            href={PAGE_MOT_DE_PASSE_OUBLIE}
            className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Mot de passe oublié
          </Link>
        </p>
      </div>

      <Bouton type="submit" disabled={enCours} className="mt-2 w-full">
        {enCours ? "Connexion…" : "Se connecter"}
      </Bouton>
    </form>
  );
}
