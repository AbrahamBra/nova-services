// Phrase de conservation vue par les demandeurs (story 1.2), partagée par le
// formulaire public (components/formulaire-depot.tsx) et l'aperçu de la page
// Paramètres (story 5.3, components/nova/parametres/) : un seul texte, jamais
// dupliqué. Sans état : utilisable côté serveur comme côté navigateur.

export const CLASSE_MENTION =
  "rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] leading-[1.45] text-muted-foreground";

type Props = {
  /** Durée déjà mise en forme : « 2 ans », « 18 mois » (formaterDuree). */
  dureeConservation: string;
  emailContact: string;
  /**
   * Email en lien `mailto:` (formulaire public). Faux dans l'aperçu : l'email
   * en cours de saisie n'est pas forcément valide.
   */
  avecLien?: boolean;
};

/** Contenu de la phrase (sans le paragraphe qui l'entoure). */
export function MentionConservation({ dureeConservation, emailContact, avecLien = true }: Props) {
  return (
    <>
      Vos informations servent uniquement à traiter votre demande. Elles sont conservées{" "}
      {dureeConservation} après son traitement, puis supprimées. Pour les faire effacer, écrivez à{" "}
      {avecLien ? (
        <a href={`mailto:${emailContact}`} className="break-all text-primary underline underline-offset-2">
          {emailContact}
        </a>
      ) : (
        <span className="break-all font-medium text-foreground">{emailContact}</span>
      )}
      .
    </>
  );
}
