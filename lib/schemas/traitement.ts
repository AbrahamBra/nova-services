import { z } from "zod";

// Saisies des actions de traitement des demandes (epic 2). Story 2.1 :
// identifiant de la demande à prendre en charge. La base revérifie tout.

/** Identifiant d'une demande (uuid). */
export const schemaIdentifiantDemande = z.guid();
