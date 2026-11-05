"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useToasts } from "@/components/nova/toasts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ajouterNote } from "@/lib/actions/demandes";
import type { NoteInterne } from "@/lib/detail-demande";
import { AUTEUR_INCONNU } from "@/lib/domaine";
import { messageErreur } from "@/lib/erreurs";
import { formaterDateHeure, formaterNombre } from "@/lib/format";
import { longueur } from "@/lib/schemas/depot";
import { LONGUEUR_MAX_NOTE, MESSAGES_NOTE, verifierTexteNote } from "@/lib/schemas/traitement";

// Bloc « Notes internes » du détail d'une demande (story 2.2, EXPERIENCE.md
// §9.5, maquette key-detail-demande.html) : les notes de la plus ancienne à
// la plus récente (auteur, date et heure de Paris, texte tel que saisi), puis
// la zone d'ajout. Une note ne se modifie ni ne se supprime : aucun bouton
// pour cela. Le texte est rendu comme du texte (React échappe tout HTML),
// retours à la ligne conservés.
// Texte vide : message sous la zone, sans appel au serveur. Plus de 2 000
// caractères : message sous la zone dès le dépassement. Pendant l'envoi : zone
// en lecture seule (rien de tapé n'est perdu). Réussite : toast, zone vidée ;
// l'action rafraîchit le détail (note et ligne d'historique visibles sans
// recharger la page). Texte refusé par la base : message sous la zone. Autre
// erreur : toast rouge, texte conservé.

/** Message de réussite de l'ajout d'une note (EXPERIENCE.md §10). */
export const MESSAGE_NOTE_AJOUTEE = "Note ajoutée.";

/** Libellé de la zone de saisie. */
export const LIBELLE_ZONE_NOTE = "Ajouter une note (visible uniquement par l'équipe)";

function auteurNote(note: NoteInterne, nomsMembres: Record<string, string>): string {
  return nomsMembres[note.auteurId] || AUTEUR_INCONNU;
}

/** Auteur et date d'une note : « Karim Benali · 03/11/2026 à 09:16 ». */
export function enteteNote(note: NoteInterne, nomsMembres: Record<string, string>): string {
  return `${auteurNote(note, nomsMembres)} · ${formaterDateHeure(note.creeLe)}`;
}

type PropsListe = {
  notes: NoteInterne[];
  notesIllisibles?: number;
  nomsMembres: Record<string, string>;
};

export function ListeNotes({ notes, notesIllisibles = 0, nomsMembres }: PropsListe) {
  const illisibles =
    notesIllisibles > 0 ? (
      <p data-testid="notes-illisibles" className="mt-2 text-[13px] text-muted-foreground">
        {notesIllisibles} {notesIllisibles > 1 ? "notes illisibles" : "note illisible"}
      </p>
    ) : null;

  if (notes.length === 0) {
    return (
      <>
        {notesIllisibles > 0 ? null : (
          <p data-testid="notes-vide" className="text-sm text-muted-foreground">
            Aucune note interne.
          </p>
        )}
        {illisibles}
      </>
    );
  }

  return (
    <>
      <ol data-testid="notes" className="flex flex-col gap-3">
        {notes.map((note) => (
          <li
            key={note.id}
            data-testid="note"
            className="border-l-[3px] border-border py-1 pl-3 text-sm"
          >
            <p className="mb-1 text-[13px] text-muted-foreground">
              {auteurNote(note, nomsMembres)} ·{" "}
              <time dateTime={note.creeLe}>{formaterDateHeure(note.creeLe)}</time>
            </p>
            <p data-testid="texte-note" className="leading-[1.5] whitespace-pre-wrap break-words">
              {note.texte}
            </p>
          </li>
        ))}
      </ol>
      {illisibles}
    </>
  );
}

export function FormulaireNote({ demandeId }: { demandeId: string }) {
  const id = useId();
  const idZone = `${id}-texte`;
  const idCompteur = `${id}-compteur`;
  const idErreur = `${id}-erreur`;
  const zoneRef = useRef<HTMLTextAreaElement>(null);
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  // Appel « en vol » : deux clics avant le nouveau rendu n'envoient qu'un appel.
  const enVol = useRef(false);
  const { afficher } = useToasts();

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enVol.current) return;

    // Même schéma que l'action (AD-8) : texte vide refusé sans appel.
    const verification = verifierTexteNote(texte);
    if (!verification.ok) {
      setErreur(verification.message);
      zoneRef.current?.focus();
      return;
    }

    setErreur(null);
    enVol.current = true;
    demarrer(async () => {
      try {
        const resultat = await ajouterNote(demandeId, verification.texte);
        if (resultat.ok) {
          afficher("succes", MESSAGE_NOTE_AJOUTEE);
          setTexte("");
        } else if (resultat.code === "DONNEES_INVALIDES") {
          // Texte refusé par la base : message sous la zone, pas de toast.
          setErreur(resultat.message);
          zoneRef.current?.focus();
        } else {
          afficher("erreur", resultat.message);
        }
      } catch {
        // Action injoignable (réseau coupé) : le texte reste dans la zone.
        afficher("erreur", messageErreur("ERREUR_INATTENDUE"));
      } finally {
        enVol.current = false;
      }
    });
  }

  // Compté comme le schéma : espaces de début et de fin retirés.
  const nombreCaracteres = longueur(texte.trim());
  const enTrop = nombreCaracteres > LONGUEUR_MAX_NOTE;
  // Message sous la zone : erreur de l'envoi, sinon dépassement en cours de frappe.
  const message = erreur ?? (enTrop ? MESSAGES_NOTE.long : null);

  return (
    <form noValidate onSubmit={soumettre} className="mt-4" aria-label="Ajouter une note interne">
      <div className="space-y-1.5">
        <Label htmlFor={idZone} className="text-sm font-medium leading-[1.4]">
          {LIBELLE_ZONE_NOTE}
        </Label>
        <Textarea
          ref={zoneRef}
          id={idZone}
          name="texte"
          rows={3}
          value={texte}
          readOnly={envoi}
          onChange={(evenement) => {
            setTexte(evenement.target.value);
            if (erreur) setErreur(null);
          }}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${idCompteur} ${idErreur}` : idCompteur}
          className="min-h-[72px] rounded-md bg-surface px-3 py-2.5 text-[15px] md:text-[15px]"
        />
        <p
          id={idCompteur}
          data-testid="compteur-note"
          className={`text-right text-[13px] ${
            enTrop ? "font-medium text-destructive" : "text-muted-foreground"
          }`}
        >
          {formaterNombre(nombreCaracteres)} / {formaterNombre(LONGUEUR_MAX_NOTE)}
        </p>
      </div>
      <div id={idErreur} aria-live="polite">
        {message ? (
          <p data-testid="erreur-note" className="mt-1.5 text-[13px] leading-[1.4] text-destructive">
            {message}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={envoi}
        className="mt-3 h-11 w-full rounded-md bg-surface px-5 text-[15px] font-semibold text-foreground sm:w-auto"
      >
        {envoi ? "Ajout…" : "Ajouter la note"}
      </Button>
    </form>
  );
}
