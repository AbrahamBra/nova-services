"use client";

import { useId, useState } from "react";
import { Bouton } from "@/components/nova/bouton";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formaterNombre } from "@/lib/format";

// Formulaire public « Déposer une demande » (EXPERIENCE.md §9.1).
// Story 1.2 : affichage seulement. L'envoi (action serveur, validation Zod,
// messages d'erreur) arrive à la story 1.3 : le bouton est pour l'instant
// sans effet.

export const LONGUEUR_MAX_DESCRIPTION = 5000;

type Props = {
  categories: { id: string; nom: string }[];
  emailContact: string;
  /** Durée déjà mise en forme : « 2 ans », « 18 mois ». */
  dureeConservation: string;
};

// Apparence Nova des champs shadcn (enveloppés, jamais modifiés) :
// coins 6 px, fond blanc, 44 px de haut, texte 15 px.
const CLASSE_CHAMP = "h-11 rounded-md bg-surface px-3 text-[15px] md:text-[15px]";
const CLASSE_LIBELLE = "text-sm font-medium leading-[1.4]";

function Facultatif() {
  return <span className="font-normal text-muted-foreground">(facultatif)</span>;
}

export function FormulaireDepot({ categories, emailContact, dureeConservation }: Props) {
  const id = useId();
  const [description, setDescription] = useState("");

  const ids = {
    nom: `${id}-nom`,
    email: `${id}-email`,
    telephone: `${id}-telephone`,
    societe: `${id}-societe`,
    categorie: `${id}-categorie`,
    objet: `${id}-objet`,
    description: `${id}-description`,
    compteur: `${id}-compteur`,
    mention: `${id}-mention`,
    consentement: `${id}-consentement`,
  };

  return (
    <form
      noValidate
      className="mt-6"
      // Envoi réel à la story 1.3 : ni envoi ni rechargement d'ici là.
      onSubmit={(evenement) => evenement.preventDefault()}
    >
      <fieldset className="mb-6 space-y-4">
        <legend className="mb-3 text-lg font-semibold leading-[1.4]">Vos coordonnées</legend>

        <div className="space-y-1.5">
          <Label htmlFor={ids.nom} className={CLASSE_LIBELLE}>
            Nom et prénom
          </Label>
          <Input id={ids.nom} name="nom" autoComplete="name" required className={CLASSE_CHAMP} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.email} className={CLASSE_LIBELLE}>
            Email
          </Label>
          <Input
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            className={CLASSE_CHAMP}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.telephone} className={CLASSE_LIBELLE}>
            Téléphone <Facultatif />
          </Label>
          <Input
            id={ids.telephone}
            name="telephone"
            type="tel"
            autoComplete="tel"
            className={CLASSE_CHAMP}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.societe} className={CLASSE_LIBELLE}>
            Société <Facultatif />
          </Label>
          <Input
            id={ids.societe}
            name="societe"
            autoComplete="organization"
            className={CLASSE_CHAMP}
          />
        </div>
      </fieldset>

      <fieldset className="mb-6 space-y-4">
        <legend className="mb-3 text-lg font-semibold leading-[1.4]">Votre demande</legend>

        <div className="space-y-1.5">
          <Label htmlFor={ids.categorie} className={CLASSE_LIBELLE}>
            Catégorie
          </Label>
          <NativeSelect
            id={ids.categorie}
            name="categorie_id"
            required
            defaultValue=""
            className="w-full [&_select]:h-11 [&_select]:rounded-md [&_select]:bg-surface [&_select]:pl-3 [&_select]:text-[15px]"
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

        <div className="space-y-1.5">
          <Label htmlFor={ids.objet} className={CLASSE_LIBELLE}>
            Objet
          </Label>
          <Input id={ids.objet} name="objet" required className={CLASSE_CHAMP} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.description} className={CLASSE_LIBELLE}>
            Description
          </Label>
          <Textarea
            id={ids.description}
            name="description"
            required
            rows={5}
            value={description}
            onChange={(evenement) => setDescription(evenement.target.value)}
            aria-describedby={ids.compteur}
            className="min-h-32 rounded-md bg-surface px-3 py-2.5 text-[15px] md:text-[15px]"
          />
          <p id={ids.compteur} className="text-right text-[13px] text-muted-foreground">
            {formaterNombre(description.length)} / {formaterNombre(LONGUEUR_MAX_DESCRIPTION)}
          </p>
        </div>
      </fieldset>

      <p
        id={ids.mention}
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

      <div className="flex items-start gap-3">
        <Checkbox
          id={ids.consentement}
          name="consentement"
          value="oui"
          required
          aria-describedby={ids.mention}
          className="mt-0.5 size-5 rounded-sm border-muted-foreground bg-surface"
        />
        <Label htmlFor={ids.consentement} className="text-sm font-normal leading-[1.4]">
          J&apos;accepte que mes données soient utilisées pour traiter ma demande.
        </Label>
      </div>

      <Bouton type="submit" pleineLargeurTelephone className="mt-6">
        Envoyer ma demande
      </Bouton>
    </form>
  );
}
