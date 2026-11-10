"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { CLASSE_CHAMP, CLASSE_LIBELLE, MessageErreur } from "@/components/formulaire-depot";
import { CLASSE_MENTION, MentionConservation } from "@/components/mention-conservation";
import { Bouton } from "@/components/nova/bouton";
import { useToasts } from "@/components/nova/toasts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { modifierParametres, type ResultatParametres } from "@/lib/actions/parametres";
import { messageErreur } from "@/lib/erreurs";
import { formaterDuree } from "@/lib/format";
import type { ParametresAdmin } from "@/lib/parametres-admin";
import {
  MESSAGES_PARAMETRES,
  optionsDuree,
  premierChampParametresEnErreur,
  verifierParametres,
  type ChampParametres,
  type ErreursParametres,
  type SaisieParametres,
} from "@/lib/schemas/parametres";

// Formulaire de la page « Paramètres » (story 5.3) : nom affiché, email de
// contact, durée de conservation (liste de 6 mois à 5 ans), puis l'aperçu de
// la phrase vue par les demandeurs, mis à jour pendant la saisie. Erreurs
// sous le champ, focus sur le premier champ en erreur, saisie conservée,
// toast « Paramètres enregistrés. ». Le formulaire public est rafraîchi par
// l'action (revalidatePath).

function echecInattendu(): ResultatParametres {
  return { ok: false, code: "ERREUR_INATTENDUE", message: messageErreur("ERREUR_INATTENDUE") };
}

function versSaisie(p: ParametresAdmin): SaisieParametres {
  return {
    nom_affiche: p.nomAffiche,
    email_contact: p.emailContact,
    duree_conservation_mois: String(p.dureeConservationMois),
  };
}

/** Durée affichée dans l'aperçu ; celle de départ si la valeur n'est pas lisible. */
function dureeApercu(saisie: string, repli: number): string {
  const mois = Number(saisie);
  return formaterDuree(Number.isInteger(mois) && mois > 0 ? mois : repli);
}

export function FormulaireParametres({ parametres }: { parametres: ParametresAdmin }) {
  const id = useId();
  const idChamp = (champ: ChampParametres) => `${id}-${champ}`;
  const idErreur = (champ: ChampParametres) => `${id}-${champ}-erreur`;
  const bandeauRef = useRef<HTMLDivElement>(null);
  const [saisie, setSaisie] = useState<SaisieParametres>(() => versSaisie(parametres));
  const [enregistres, setEnregistres] = useState<ParametresAdmin>(parametres);
  const [erreurs, setErreurs] = useState<ErreursParametres>({});
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  const enVol = useRef(false);
  const { afficher } = useToasts();
  // Champ à focaliser une fois la requête terminée (la liste est désactivée
  // pendant l'envoi : un focus immédiat serait ignoré).
  const champAFocaliser = useRef<ChampParametres | null>(null);

  useEffect(() => {
    const champ = champAFocaliser.current;
    if (envoi || champ === null) return;
    champAFocaliser.current = null;
    document.getElementById(`${id}-${champ}`)?.focus();
  }, [envoi, erreurs, id]);

  // Toujours la durée enregistrée (même hors liste) et celle choisie.
  const options = optionsDuree(enregistres.dureeConservationMois, Number(saisie.duree_conservation_mois));
  const emailApercu = saisie.email_contact.trim().toLowerCase() || enregistres.emailContact;

  function changer(champ: ChampParametres, valeur: string) {
    setSaisie((s) => ({ ...s, [champ]: valeur }));
    if (erreurs[champ]) setErreurs((e) => ({ ...e, [champ]: undefined }));
    if (erreurGenerale) setErreurGenerale(null);
  }

  function montrerErreurs(nouvelles: ErreursParametres) {
    setErreurs(nouvelles);
    setErreurGenerale(null);
    champAFocaliser.current = premierChampParametresEnErreur(nouvelles);
  }

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enVol.current) return;

    const verification = verifierParametres(saisie);
    if (!verification.ok) {
      montrerErreurs(verification.erreurs);
      return;
    }

    setErreurs({});
    setErreurGenerale(null);
    enVol.current = true;
    demarrer(async () => {
      let resultat: ResultatParametres;
      try {
        resultat = await modifierParametres(saisie);
      } catch {
        resultat = echecInattendu();
      } finally {
        enVol.current = false;
      }
      if (resultat.ok) {
        // Valeurs telles qu'enregistrées (espaces retirés, email en minuscules).
        const valeurs: ParametresAdmin = {
          nomAffiche: resultat.donnees.nomAffiche,
          emailContact: resultat.donnees.emailContact,
          dureeConservationMois: resultat.donnees.dureeConservationMois,
        };
        setEnregistres(valeurs);
        setSaisie(versSaisie(valeurs));
        afficher("succes", MESSAGES_PARAMETRES.enregistres);
        return;
      }
      if (resultat.erreurs && premierChampParametresEnErreur(resultat.erreurs)) {
        montrerErreurs(resultat.erreurs);
        return;
      }
      setErreurGenerale(resultat.message);
      requestAnimationFrame(() => bandeauRef.current?.focus());
    });
  }

  const aria = (champ: ChampParametres) => ({
    "aria-invalid": erreurs[champ] ? true : undefined,
    "aria-describedby": erreurs[champ] ? idErreur(champ) : undefined,
  });

  return (
    <div className="max-w-[560px]">
      <form noValidate className="space-y-4" onSubmit={soumettre}>
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
            <Label htmlFor={idChamp("nom_affiche")} className={CLASSE_LIBELLE}>
              Nom affiché
            </Label>
            <Input
              id={idChamp("nom_affiche")}
              name="nom_affiche"
              autoComplete="organization"
              required
              value={saisie.nom_affiche}
              onChange={(e) => changer("nom_affiche", e.target.value)}
              readOnly={envoi}
              className={CLASSE_CHAMP}
              {...aria("nom_affiche")}
            />
          </div>
          <MessageErreur id={idErreur("nom_affiche")} message={erreurs.nom_affiche} />
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("email_contact")} className={CLASSE_LIBELLE}>
              Email de contact
            </Label>
            <Input
              id={idChamp("email_contact")}
              name="email_contact"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={saisie.email_contact}
              onChange={(e) => changer("email_contact", e.target.value)}
              readOnly={envoi}
              className={CLASSE_CHAMP}
              {...aria("email_contact")}
            />
          </div>
          <MessageErreur id={idErreur("email_contact")} message={erreurs.email_contact} />
        </div>

        <div>
          <div className="space-y-1.5">
            <Label htmlFor={idChamp("duree_conservation_mois")} className={CLASSE_LIBELLE}>
              Durée de conservation
            </Label>
            <NativeSelect
              id={idChamp("duree_conservation_mois")}
              name="duree_conservation_mois"
              required
              value={saisie.duree_conservation_mois}
              onChange={(e) => changer("duree_conservation_mois", e.target.value)}
              disabled={envoi}
              className="w-full [&_select]:h-11 [&_select]:rounded-md [&_select]:bg-surface [&_select]:pl-3 [&_select]:text-[15px]"
              {...aria("duree_conservation_mois")}
            >
              {options.map((option) => (
                <NativeSelectOption key={option.valeur} value={String(option.valeur)}>
                  {option.libelle}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <MessageErreur
            id={idErreur("duree_conservation_mois")}
            message={erreurs.duree_conservation_mois}
          />
        </div>

        <section aria-labelledby={`${id}-apercu`} className="pt-2">
          <h2 id={`${id}-apercu`} className="mb-1 text-base font-semibold leading-[1.4]">
            Aperçu
          </h2>
          <p className="mb-2 text-[13px] text-muted-foreground">
            Phrase affichée aux demandeurs sous le formulaire public.
          </p>
          <p className={CLASSE_MENTION} data-testid="apercu-mention">
            <MentionConservation
              dureeConservation={dureeApercu(saisie.duree_conservation_mois, enregistres.dureeConservationMois)}
              emailContact={emailApercu}
              avecLien={false}
            />
          </p>
        </section>

        <div className="pt-2">
          <Bouton type="submit" disabled={envoi} pleineLargeurTelephone>
            {envoi ? "Envoi en cours…" : "Enregistrer les paramètres"}
          </Bouton>
        </div>
      </form>
    </div>
  );
}
