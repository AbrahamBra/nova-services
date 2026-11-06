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
import { choisirMotDePasse } from "@/lib/actions/comptes";
import { messageErreur } from "@/lib/erreurs";
import {
  ETAT_MOT_DE_PASSE_INITIAL,
  REGLE_MOT_DE_PASSE,
  lireSaisieMotDePasse,
  premierChampMotDePasseEnErreur,
  verifierMotDePasse,
  type ChampMotDePasse,
  type ErreursMotDePasse,
  type EtatMotDePasse,
} from "@/lib/schemas/mot-de-passe";

// Formulaire « Choisir un mot de passe » (EXPERIENCE.md §9.12, story 4.1) :
// deux champs (mot de passe, confirmation) et la règle « 8 caractères
// minimum » affichée. Vérifié à l'écran avec le schéma Zod partagé, puis par
// l'action `choisirMotDePasse` et par Supabase. Réussite : l'espace équipe.

async function envoyerAuServeur(etat: EtatMotDePasse, donnees: FormData): Promise<EtatMotDePasse> {
  try {
    return (await choisirMotDePasse(etat, donnees)) ?? etat;
  } catch (erreur) {
    // La redirection vers /equipe est laissée à Next.js.
    unstable_rethrow(erreur);
    return {
      erreurs: {},
      erreurGenerale: { type: "serveur", message: messageErreur("ERREUR_INATTENDUE") },
      tentative: etat.tentative + 1,
    };
  }
}

export function FormulaireMotDePasse() {
  const id = useId();
  const formulaireRef = useRef<HTMLFormElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [etat, envoyer, enCours] = useActionState(envoyerAuServeur, ETAT_MOT_DE_PASSE_INITIAL);

  const [erreurs, setErreurs] = useState<ErreursMotDePasse>({});
  const [erreurGenerale, setErreurGenerale] = useState<EtatMotDePasse["erreurGenerale"]>(null);
  const [tentativeVue, setTentativeVue] = useState(etat.tentative);
  if (etat.tentative !== tentativeVue) {
    setTentativeVue(etat.tentative);
    setErreurs(etat.erreurs);
    setErreurGenerale(etat.erreurGenerale);
  }

  const idChamp = (champ: ChampMotDePasse | "regle") => `${id}-${champ}`;
  const idErreur = (champ: ChampMotDePasse) => `${id}-${champ}-erreur`;

  useEffect(() => {
    if (etat.tentative === 0) return;
    const champ = premierChampMotDePasseEnErreur(etat.erreurs);
    if (champ) {
      document.getElementById(`${id}-${champ}`)?.focus();
    } else if (etat.erreurGenerale) {
      bandeauRef.current?.focus();
    }
  }, [etat, id]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return;

    const donnees = new FormData(evenement.currentTarget);
    const verification = verifierMotDePasse(lireSaisieMotDePasse(donnees));
    if (!verification.ok) {
      setErreurs(verification.erreurs);
      setErreurGenerale(null);
      const champ = premierChampMotDePasseEnErreur(verification.erreurs);
      if (champ) document.getElementById(idChamp(champ))?.focus();
      return;
    }

    setErreurs({});
    setErreurGenerale(null);
    startTransition(() => envoyer(donnees));
  }

  function aria(champ: ChampMotDePasse, autres: string[] = []) {
    const enErreur = Boolean(erreurs[champ]);
    const decrit = [...autres, ...(enErreur ? [idErreur(champ)] : [])].join(" ");
    return {
      "aria-invalid": enErreur || undefined,
      "aria-describedby": decrit || undefined,
    };
  }

  const lienPlusValable = erreurGenerale?.type === "lien";

  return (
    <form
      ref={formulaireRef}
      noValidate
      className="mt-6 space-y-4"
      onSubmit={soumettre}
      onChange={(evenement) => {
        const nom = (evenement.target as unknown as { name?: unknown }).name;
        if (typeof nom === "string" && nom in erreurs) {
          setErreurs((actuelles) => {
            const suivantes = { ...actuelles };
            delete suivantes[nom as ChampMotDePasse];
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
          <Label htmlFor={idChamp("mot_de_passe")} className={CLASSE_LIBELLE}>
            Mot de passe
          </Label>
          <Input
            id={idChamp("mot_de_passe")}
            name="mot_de_passe"
            type="password"
            autoComplete="new-password"
            required
            className={CLASSE_CHAMP}
            {...aria("mot_de_passe", [idChamp("regle")])}
          />
          <p id={idChamp("regle")} className="text-[13px] text-muted-foreground">
            {REGLE_MOT_DE_PASSE}
          </p>
        </div>
        <MessageErreur id={idErreur("mot_de_passe")} message={erreurs.mot_de_passe} />
      </div>

      <div>
        <div className="space-y-1.5">
          <Label htmlFor={idChamp("confirmation")} className={CLASSE_LIBELLE}>
            Confirmation du mot de passe
          </Label>
          <Input
            id={idChamp("confirmation")}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            className={CLASSE_CHAMP}
            {...aria("confirmation")}
          />
        </div>
        <MessageErreur id={idErreur("confirmation")} message={erreurs.confirmation} />
      </div>

      <Bouton type="submit" disabled={enCours || lienPlusValable} className="mt-2 w-full">
        {enCours ? "Envoi en cours…" : "Enregistrer mon mot de passe"}
      </Bouton>
    </form>
  );
}
