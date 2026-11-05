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
import { Bouton } from "@/components/nova/bouton";
import { BoutonReessayer } from "@/components/nova/reessayer";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { unstable_rethrow, useRouter } from "next/navigation";
import { deposer } from "@/lib/actions/demandes";
import { messageErreur } from "@/lib/erreurs";
import { formaterNombre } from "@/lib/format";
import {
  CHAMP_PIEGE,
  ETAT_DEPOT_INITIAL,
  type EtatDepot,
  LONGUEURS_MAX,
  lireSaisieDepot,
  longueur,
  premierChampEnErreur,
  verifierDepot,
  type ChampDepot,
  type ErreursDepot,
} from "@/lib/schemas/depot";

// Formulaire public « Déposer une demande » (EXPERIENCE.md §9.1, §4, §5).
// La saisie est vérifiée à l'écran avec le schéma Zod partagé, puis envoyée
// à l'action serveur `deposer`, qui revérifie tout et ouvre la page de
// confirmation. Une erreur n'efface jamais la saisie.

export const LONGUEUR_MAX_DESCRIPTION = LONGUEURS_MAX.description;

type Props = {
  categories: { id: string; nom: string }[];
  emailContact: string;
  /** Durée déjà mise en forme : « 2 ans », « 18 mois ». */
  dureeConservation: string;
  /** Clé anti-doublon créée à l'affichage de la page (AD-26). */
  cleEnvoi: string;
};

// Apparence Nova des champs shadcn (enveloppés, jamais modifiés) :
// coins 6 px, fond blanc, 44 px de haut, texte 15 px.
export const CLASSE_CHAMP = "h-11 rounded-md bg-surface px-3 text-[15px] md:text-[15px]";
export const CLASSE_LIBELLE = "text-sm font-medium leading-[1.4]";

/**
 * Appel de l'action serveur. Une coupure réseau (requête qui n'aboutit pas)
 * devient le bandeau « Le serveur ne répond pas… », sans perdre la saisie ;
 * la redirection vers la confirmation est laissée à Next.js.
 */
async function envoyerAuServeur(etat: EtatDepot, donnees: FormData): Promise<EtatDepot> {
  try {
    return (await deposer(etat, donnees)) ?? etat;
  } catch (erreur) {
    unstable_rethrow(erreur);
    return {
      erreurs: {},
      erreurGenerale: messageErreur("ERREUR_INATTENDUE"),
      tentative: etat.tentative + 1,
    };
  }
}

export function Facultatif() {
  return <span className="font-normal text-muted-foreground">(facultatif)</span>;
}

/** Message sous le champ, annoncé par les lecteurs d'écran (zone toujours présente). */
export function MessageErreur({ id, message, decale = false }: { id: string; message?: string; decale?: boolean }) {
  return (
    <div id={id} aria-live="polite">
      {message ? (
        <p className={`mt-1.5 text-[13px] leading-[1.4] text-destructive ${decale ? "pl-8" : ""}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function FormulaireDepot({ categories, emailContact, dureeConservation, cleEnvoi }: Props) {
  const id = useId();
  const formulaireRef = useRef<HTMLFormElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [description, setDescription] = useState("");
  const router = useRouter();
  // Catégorie refusée par le serveur (désactivée entre-temps), en attente du
  // rechargement de la liste.
  const categorieRefusee = useRef<string | null>(null);

  const [etat, envoyer, enCours] = useActionState(envoyerAuServeur, ETAT_DEPOT_INITIAL);

  // Erreurs affichées : celles de l'écran, ou celles renvoyées par le serveur.
  const [erreurs, setErreurs] = useState<ErreursDepot>({});
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  const [tentativeVue, setTentativeVue] = useState(etat.tentative);
  if (etat.tentative !== tentativeVue) {
    // Nouvelle réponse du serveur : on l'affiche.
    setTentativeVue(etat.tentative);
    setErreurs(etat.erreurs);
    setErreurGenerale(etat.erreurGenerale);
  }

  const idChamp = (champ: ChampDepot | "compteur" | "mention") => `${id}-${champ}`;
  const idErreur = (champ: ChampDepot) => `${id}-${champ}-erreur`;

  // Après une réponse en erreur du serveur : focus sur le premier champ en
  // erreur, sinon sur le bandeau.
  useEffect(() => {
    if (etat.tentative === 0) return;
    const champ = premierChampEnErreur(etat.erreurs);
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
  }, [etat, id, router]);

  // Liste rechargée : si la catégorie refusée a disparu, le navigateur
  // choisirait la première autre catégorie ; on revient à « Choisissez… ».
  useEffect(() => {
    const refusee = categorieRefusee.current;
    if (!refusee || categories.some((categorie) => categorie.id === refusee)) return;
    categorieRefusee.current = null;
    const liste = document.getElementById(`${id}-categorie_id`) as HTMLSelectElement | null;
    if (liste) liste.value = "";
  }, [categories, id]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return; // un second clic est sans effet

    const donnees = new FormData(evenement.currentTarget);
    const verification = verifierDepot(lireSaisieDepot(donnees));
    if (!verification.ok && Object.keys(verification.erreurs).length > 0) {
      setErreurs(verification.erreurs);
      setErreurGenerale(null);
      const champ = premierChampEnErreur(verification.erreurs);
      if (champ) document.getElementById(idChamp(champ))?.focus();
      return;
    }

    setErreurs({});
    setErreurGenerale(null);
    startTransition(() => envoyer(donnees));
  }

  // Une erreur disparaît dès que l'on modifie le champ concerné.
  function effacerErreur(champ: string) {
    if (champ in erreurs) {
      setErreurs((actuelles) => {
        const suivantes = { ...actuelles };
        delete suivantes[champ as ChampDepot];
        return suivantes;
      });
    }
  }

  // Attributs d'accessibilité d'un champ, selon qu'il est en erreur.
  function aria(champ: ChampDepot, autres: string[] = []) {
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
      <input type="hidden" name="cle_envoi" value={cleEnvoi} />

      {/* Champ piège (story 1.8) : hors de l'écran (pas display:none, que
          certains robots savent éviter), ignoré par les lecteurs d'écran,
          hors du parcours clavier, sans saisie automatique. Un humain le
          laisse vide ; s'il est rempli, l'action n'enregistre rien. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
        <label htmlFor={`${id}-${CHAMP_PIEGE}`}>Site web</label>
        <input
          id={`${id}-${CHAMP_PIEGE}`}
          type="text"
          name={CHAMP_PIEGE}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

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

      <fieldset className="mb-6 space-y-4">
        <legend className="mb-3 text-lg font-semibold leading-[1.4]">Vos coordonnées</legend>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("nom")} className={CLASSE_LIBELLE}>
              Nom et prénom
            </Label>
            <Input
              id={idChamp("nom")}
              name="nom"
              autoComplete="name"
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
              autoComplete="email"
              required
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
              autoComplete="tel"
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
              autoComplete="organization"
              className={CLASSE_CHAMP}
              {...aria("societe")}
            />
          </div>
          <MessageErreur id={idErreur("societe")} message={erreurs.societe} />
        </div>
      </fieldset>

      <fieldset className="mb-6 space-y-4">
        <legend className="mb-3 text-lg font-semibold leading-[1.4]">Votre demande</legend>

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
            {/* Annonce unique au passage de la limite (pas à chaque frappe). */}
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
        id={idChamp("mention")}
        className="mb-4 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] leading-[1.45] text-muted-foreground"
      >
        Vos informations servent uniquement à traiter votre demande. Elles sont conservées{" "}
        {dureeConservation} après son traitement, puis supprimées. Pour les faire effacer, écrivez à{" "}
        <a
          href={`mailto:${emailContact}`}
          className="break-all text-primary underline underline-offset-2"
        >
          {emailContact}
        </a>
        .
      </p>

      <div>
        <div className="flex items-start gap-3">
          <Checkbox
            id={idChamp("consentement")}
            name="consentement"
            value="oui"
            required
            onCheckedChange={() => effacerErreur("consentement")}
            className="mt-0.5 size-5 rounded-sm border-muted-foreground bg-surface"
            {...aria("consentement", [idChamp("mention")])}
          />
          <Label htmlFor={idChamp("consentement")} className="text-sm font-normal leading-[1.4]">
            J&apos;accepte que mes données soient utilisées pour traiter ma demande.
          </Label>
        </div>
        <MessageErreur id={idErreur("consentement")} message={erreurs.consentement} decale />
      </div>

      <Bouton type="submit" disabled={enCours} pleineLargeurTelephone className="mt-6">
        {enCours ? "Envoi en cours…" : "Envoyer ma demande"}
      </Bouton>
    </form>
  );
}
