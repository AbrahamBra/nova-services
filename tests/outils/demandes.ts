import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Canal, Priorite, Statut } from "@/lib/domaine";
import { empreinteDeTest } from "./ip-test";

// Demandes jetables pour les tests de la liste (story 1.5). Créées par
// `deposer_demande` (vraie référence, compteur de l'année), puis ajustées
// directement en base : date de création, statut, priorité, responsable.
// Leur nom commence par un préfixe `TEST-…` propre à l'exécution, pour les
// retrouver et les effacer (historique en cascade).
// Utilisé par Vitest et par Playwright (hors Next.js).

export type DemandeTest = {
  id: string;
  reference: string;
  nom: string;
  objet: string;
  societe: string | null;
};

export type OptionsDemande = {
  objet?: string;
  /** Nom du demandeur, après le préfixe (story 2.5). Par défaut « Sophie Garnier ». */
  nomDemandeur?: string;
  /** Email du demandeur (story 2.5). */
  email?: string;
  /** Canal (story 2.5) ; « formulaire » par défaut. */
  canal?: Canal;
  /** Catégorie, même désactivée (story 2.5) ; la première catégorie active par défaut. */
  categorieId?: string;
  societe?: string | null;
  statut?: Statut;
  priorite?: Priorite;
  responsableId?: string | null;
  /** Décalage de la date de création par rapport à maintenant (SQL, ex. '1 day'). */
  decalage?: string;
};

export async function premiereCategorie(base: Client): Promise<{ id: string; nom: string }> {
  const { rows } = await base.query<{ id: string; nom: string }>(
    "select id, nom from public.categories where actif order by ordre limit 1",
  );
  if (rows.length === 0) {
    throw new Error("Aucune catégorie active en base : impossible de créer une demande de test.");
  }
  return rows[0];
}

/** Crée une demande `TEST-…` et l'ajuste ; renvoie sa référence. */
export async function creerDemandeTest(
  base: Client,
  prefixe: string,
  options: OptionsDemande = {},
): Promise<DemandeTest> {
  const categorie = await premiereCategorie(base);
  const nom = `${prefixe} ${options.nomDemandeur ?? "Sophie Garnier"}`;
  const objet = options.objet ?? `Demande de test ${randomUUID().slice(0, 6)}`;
  const societe = options.societe === undefined ? "Atelier Garnier" : options.societe;
  const { rows } = await base.query<{ r: { reference: string } }>(
    "select public.deposer_demande($1, $2, $3, null, $4, $5, $6, $7, true, $8) as r",
    [
      randomUUID(),
      nom,
      options.email ?? "sophie.garnier@example.com",
      societe,
      categorie.id,
      objet,
      "Description.",
      empreinteDeTest(),
    ],
  );
  const reference = rows[0].r.reference;
  const { rows: mises } = await base.query<{ id: string }>(
    `update public.demandes
        set cree_le = now() + $2::interval,
            statut = $3,
            priorite = $4,
            responsable_id = $5,
            canal = $6,
            categorie_id = $7
      where reference = $1
      returning id`,
    [
      reference,
      options.decalage ?? "0 seconds",
      options.statut ?? "nouvelle",
      options.priorite ?? "normale",
      options.responsableId ?? null,
      options.canal ?? "formulaire",
      options.categorieId ?? categorie.id,
    ],
  );
  // La ligne `creation` de l'historique suit la date de création décalée
  // (sinon l'historique commencerait avant la demande). L'historique refuse
  // toute modification : la ligne est remplacée (même contenu, autre date).
  if (options.decalage) {
    await base.query(
      `with ancienne as (
         delete from public.historique where demande_id = $1 and type = 'creation' returning *
       )
       insert into public.historique
         (demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le)
       select demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur,
              now() + $2::interval
         from ancienne`,
      [mises[0].id, options.decalage],
    );
  }
  return { id: mises[0].id, reference, nom, objet, societe };
}

/** Crée `nombre` demandes de remplissage (anciennes), en une requête. */
export async function creerDemandesRemplissage(
  base: Client,
  prefixe: string,
  nombre: number,
): Promise<void> {
  const categorie = await premiereCategorie(base);
  const { rows } = await base.query<{ reference: string }>(
    // Une empreinte d'IP aléatoire par demande : jamais la limite d'envois (story 1.8).
    `select public.deposer_demande(gen_random_uuid(), $1, 'remplissage@example.com', null,
                                   null, $2, 'Demande de remplissage', 'Description.', true,
                                   replace(gen_random_uuid()::text, '-', '')
                                     || replace(gen_random_uuid()::text, '-', ''))
            ->> 'reference' as reference
       from generate_series(1, $3::int)`,
    [`${prefixe} Remplissage`, categorie.id, nombre],
  );
  // Datées de loin dans le passé : en fin de liste, sans gêner les autres tests.
  await base.query(
    "update public.demandes set cree_le = now() - interval '30 years' where reference = any($1::text[])",
    [rows.map((r) => r.reference)],
  );
}

/** Préfixe complet d'une exécution, ex. `TEST-1.5-1a2b3c4d`. */
export const FORMAT_PREFIXE = /^TEST-[\w.]+-[0-9a-f]{8}$/;

export async function supprimerDemandesTest(base: Client, prefixe: string): Promise<void> {
  // Garde-fou : jamais un préfixe large (« TEST- ») qui toucherait d'autres données.
  if (!FORMAT_PREFIXE.test(prefixe)) {
    throw new Error(`Préfixe de demandes de test refusé : « ${prefixe} ».`);
  }
  await base.query("delete from public.demandes where nom like $1", [`${prefixe}%`]);
}
