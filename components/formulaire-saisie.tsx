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
import { unstable_rethrow, useRouter } from "next/navigation";
import {
  CLASSE_CHAMP,
  CLASSE_LIBELLE,
  Facultatif,
  LONGUEUR_MAX_DESCRIPTION,
  MessageErreur,
} from "@/components/formulaire-depot";
import { Bouton } from "@/components/nova/bouton";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { useToasts } from "@/components/nova/toasts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saisir } from "@/lib/actions/demandes";
import { LIBELLES_CANAL } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { formaterNombre } from "@/lib/format";
import { longueur } from "@/lib/schemas/depot";
import {
  CANAUX_SAISIE,
  ETAT_SAISIE_INITIAL,
  RAPPEL_DONNEES,
  lireSaisie,
  messageSaisieEnregistree,
  premierChampSaisieEnErreur,
  verifierSaisie,
  type ChampSaisie,
  type ErreursSaisie,
  type EtatSaisie,
} from "@/lib/schemas/saisie";

// Saisie interne « Saisir une demande » (EXPERIENCE.md §9.6, story 2.6) :
// les champs du formulaire public, précédés du Canal (Téléphone ou Email,
// sans valeur par défaut), email facultatif, rappel sur l'usage des données
// à la place de la case de consentement, sans champ piège. Mêmes
// comportements que le formulaire public (UX-DR7) : erreurs sous les champs,
// focus sur le premier champ en erreur, saisie conservée. Réussite : toast
// « Demande NOVA-… enregistrée. » et ouverture du détail.

type Props = {
  categories: { id: string; nom: string }[];
  /** Clé anti-doublon créée à l'affichage de la page (AD-26). */
  cleEnvoi: string;
};

/**
 * Appel de l'action serveur. Une coupure réseau devient le bandeau « Le
 * serveur ne répond pas… », sans perdre la saisie.
 */
async function envoyerAuServeur(etat: EtatSaisie, donnees: FormData): Promise<EtatSaisie> {
  try {
    return (await saisir(etat, donnees)) ?? etat;
  } catch (erreur) {
    unstable_rethrow(erreur);
    return {
      erreurs: {},
      erreurGenerale: messageErreur("ERREUR_INATTENDUE"),
      tentative: etat.tentative + 1,
      reference: null,
    };
  }
}

export function FormulaireSaisie({ categories, cleEnvoi }: Props) {
  const id = useId();
  // Clé fixée au premier affichage : un `router.refresh()` (page dynamique,
  // nouvelle clé à chaque rendu serveur) ne doit jamais la remplacer (AD-26).
  const [cle] = useState(cleEnvoi);
  const formulaireRef = useRef<HTMLFormElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [description, setDescription] = useState("");
  const router = useRouter();
  const { afficher } = useToasts();
  // Catégorie refusée par le serveur (désactivée entre-temps), en attente du
  // rechargement de la liste.
  const categorieRefusee = useRef<string | null>(null);

  const [etat, envoyer, enCours] = useActionState(envoyerAuServeur, ETAT_SAISIE_INITIAL);

  // Erreurs affichées : celles de l'écran, ou celles renvoyées par le serveur.
  const [erreurs, setErreurs] = useState<ErreursSaisie>({});
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  const [tentativeVue, setTentativeVue] = useState(etat.tentative);
  if (etat.tentative !== tentativeVue) {
    setTentativeVue(etat.tentative);
    setErreurs(etat.erreurs);
    setErreurGenerale(etat.erreurGenerale);
  }

  // Demande enregistrée : le bouton reste « Enregistrement… » jusqu'à
  // l'ouverture du détail.
  const enregistree = etat.reference !== null;

  const idChamp = (champ: ChampSaisie | "compteur" | "rappel") => `${id}-${champ}`;
  const idErreur = (champ: ChampSaisie) => `${id}-${champ}-erreur`;

  useEffect(() => {
    if (etat.tentative === 0) return;
    if (etat.reference) {
      // Réussite : toast, puis le détail remplace le formulaire dans
      // l'historique du navigateur (un retour arrière ne réaffiche pas le
      // formulaire rempli avec la même clé).
      afficher("succes", messageSaisieEnregistree(etat.reference));
      router.replace(`/equipe/demandes/${encodeURIComponent(etat.reference)}`);
      return;
    }
    const champ = premierChampSaisieEnErreur(etat.erreurs);
    if (etat.erreurs.categorie_id) {
      // Catégorie désactivée depuis l'affichage : on recharge la liste, la
      // saisie reste dans le formulaire.
      const liste = document.getElementById(`${id}-categorie_id`) as HTMLSelectElement | null;
      categorieRefusee.current = liste?.value ?? null;
      router.refresh();
    }
    if (champ) {
      document.getElementById(`${id}-${champ}`)?.focus();
    } else if (etat.erreurGenerale) {
      bandeauRef.current?.focus();
    }
  }, [etat, id, router, afficher]);

  // Liste rechargée : si la catégorie refusée a disparu, on revient à
  // « Choisissez… ». Dans tous les cas, la catégorie refusée est oubliée.
  useEffect(() => {
    const refusee = categorieRefusee.current;
    if (!refusee) return;
    categorieRefusee.current = null;
    if (categories.some((categorie) => categorie.id === refusee)) return;
    const liste = document.getElementById(`${id}-categorie_id`) as HTMLSelectElement | null;
    if (liste) liste.value = "";
  }, [categories, id]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours || enregistree) return; // un second clic est sans effet

    const donnees = new FormData(evenement.currentTarget);
    const verification = verifierSaisie(lireSaisie(donnees));
    if (!verification.ok && Object.keys(verification.erreurs).length > 0) {
      setErreurs(verification.erreurs);
      setErreurGenerale(null);
      const champ = premierChampSaisieEnErreur(verification.erreurs);
      if (champ) document.getElementById(idChamp(champ))?.focus();
      return;
    }

    setErreurs({});
    setErreurGenerale(null);
    startTransition(() => envoyer(donnees));
  }

  // Une erreur disparaît dès que l'on modifie le champ concerné. Le message
  // « au moins un email ou un téléphone » (sous Email) disparaît aussi
  // quand on remplit le téléphone.
  function effacerErreur(champ: string) {
    const champs = champ === "telephone" ? ["telephone", "email"] : [champ];
    if (champs.some((c) => c in erreurs)) {
      setErreurs((actuelles) => {
        const suivantes = { ...actuelles };
        for (const c of champs) {
          if (c === "email" && champ === "telephone" && !estMessageCoordonnees(suivantes.email)) {
            continue;
          }
          delete suivantes[c as ChampSaisie];
        }
        return suivantes;
      });
    }
  }

  function aria(champ: ChampSaisie, autres: string[] = []) {
    const enErreur = Boolean(erreurs[champ]);
    const decrit = [...autres, ...(enErreur ? [idErreur(champ)] : [])].join(" ");
    return {
      "aria-invalid": enErreur || undefined,
      "aria-describedby": decrit || undefined,
    };
  }

  // Compté comme Zod : espaces de début et de fin retirés.
  const nombreCaracteres = longueur(description.trim());
  const enTrop = nombreCaracteres - LONGUEUR_MAX_DESCRIPTION;
  const occupe = enCours || enregistree;

  return (
    <form
      ref={formulaireRef}
      noValidate
      className="mt-6"
      action={envoyer}
      onSubmit={soumettre}
      onChange={(evenement) => {
        const cible = evenement.target as unknown as { name?: unknown };
        if (typeof cible.name === "string") effacerErreur(cible.name);
      }}
    >
      <input type="hidden" name="cle_envoi" value={cle} />

      {erreurGenerale ? (
        <div
          ref={bandeauRef}
          role="alert"
          tabIndex={-1}
          className="mb-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="font-medium text-destructive">{erreurGenerale}</p>
          <BoutonReessayer onReessayer={() => formulaireRef.current?.requestSubmit()} />
        </div>
      ) : null}

      {/* Canal en premier, obligatoire, sans valeur par défaut. */}
      <fieldset
        role="radiogroup"
        className="mb-6"
        aria-required="true"
        aria-invalid={erreurs.canal ? true : undefined}
        aria-describedby={erreurs.canal ? idErreur("canal") : undefined}
      >
        <legend className="mb-3 text-lg font-semibold leading-[1.4]">Canal</legend>
        <div className="flex flex-wrap gap-3">
          {CANAUX_SAISIE.map((canal, index) => (
            <label
              key={canal}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-surface px-4 text-[15px] has-checked:border-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                // Le premier bouton reçoit le focus en cas d'erreur.
                id={index === 0 ? idChamp("canal") : undefined}
                type="radio"
                name="canal"
                value={canal}
                required
                className="size-4 accent-primary outline-none"
              />
              {LIBELLES_CANAL[canal]}
            </label>
          ))}
        </div>
        <MessageErreur id={idErreur("canal")} message={erreurs.canal} />
      </fieldset>

      <fieldset className="mb-6 space-y-4">
        <legend className="mb-3 text-lg font-semibold leading-[1.4]">Demandeur</legend>

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
              Email <Facultatif />
            </Label>
            <Input
              id={idChamp("email")}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              className={CLASSE_CHAMP}
              {...aria("email")}
            />
          </div>
          <MessageErreur id={idErreur("email")} message={erreurs.email} />
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("telephone")} className={CLASSE_LIBELLE}>
              Téléphone <Facultatif />
            </Label>
            <Input
              id={idChamp("telephone")}
              name="telephone"
              type="tel"
              autoComplete="off"
              className={CLASSE_CHAMP}
              {...aria("telephone")}
            />
          </div>
          <MessageErreur id={idErreur("telephone")} message={erreurs.telephone} />
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("societe")} className={CLASSE_LIBELLE}>
              Société <Facultatif />
            </Label>
            <Input
              id={idChamp("societe")}
              name="societe"
              autoComplete="off"
              className={CLASSE_CHAMP}
              {...aria("societe")}
            />
          </div>
          <MessageErreur id={idErreur("societe")} message={erreurs.societe} />
        </div>
      </fieldset>

      <fieldset className="mb-6 space-y-4">
        <legend className="mb-3 text-lg font-semibold leading-[1.4]">Demande</legend>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("categorie_id")} className={CLASSE_LIBELLE}>
              Catégorie
            </Label>
            <NativeSelect
              id={idChamp("categorie_id")}
              name="categorie_id"
              required
              defaultValue=""
              className="w-full [&_select]:h-11 [&_select]:rounded-md [&_select]:bg-surface [&_select]:pl-3 [&_select]:text-[15px]"
              {...aria("categorie_id")}
            >
              <NativeSelectOption value="" disabled>
                Choisissez une catégorie
              </NativeSelectOption>
              {categories.map((categorie) => (
                <NativeSelectOption key={categorie.id} value={categorie.id}>
                  {categorie.nom}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <MessageErreur id={idErreur("categorie_id")} message={erreurs.categorie_id} />
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("objet")} className={CLASSE_LIBELLE}>
              Objet
            </Label>
            <Input
              id={idChamp("objet")}
              name="objet"
              required
              autoComplete="off"
              className={CLASSE_CHAMP}
              {...aria("objet")}
            />
          </div>
          <MessageErreur id={idErreur("objet")} message={erreurs.objet} />
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("description")} className={CLASSE_LIBELLE}>
              Description
            </Label>
            <Textarea
              id={idChamp("description")}
              name="description"
              required
              rows={5}
              value={description}
              onChange={(evenement) => setDescription(evenement.target.value)}
              className="min-h-32 rounded-md bg-surface px-3 py-2.5 text-[15px] md:text-[15px]"
              {...aria("description", [idChamp("compteur")])}
            />
            <p
              id={idChamp("compteur")}
              className={`text-right text-[13px] ${
                enTrop > 0 ? "font-medium text-destructive" : "text-muted-foreground"
              }`}
            >
              {formaterNombre(nombreCaracteres)} / {formaterNombre(LONGUEUR_MAX_DESCRIPTION)}
              {enTrop > 0
                ? ` · ${formaterNombre(enTrop)} caractère${enTrop > 1 ? "s" : ""} en trop`
                : null}
            </p>
            <p aria-live="polite" className="sr-only">
              {enTrop > 0
                ? `La description dépasse ${formaterNombre(LONGUEUR_MAX_DESCRIPTION)} caractères.`
                : ""}
            </p>
          </div>
          <MessageErreur id={idErreur("description")} message={erreurs.description} />
        </div>
      </fieldset>

      <p
        id={idChamp("rappel")}
        className="mb-4 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] leading-[1.45] text-muted-foreground"
      >
        {RAPPEL_DONNEES}
      </p>

      <Bouton
        type="submit"
        disabled={occupe}
        pleineLargeurTelephone
        className="mt-2"
        aria-describedby={idChamp("rappel")}
      >
        {occupe ? "Enregistrement…" : "Enregistrer la demande"}
      </Bouton>
    </form>
  );
}

function estMessageCoordonnees(message: string | undefined): boolean {
  return message === messageErreur("COORDONNEES_REQUISES");
}
