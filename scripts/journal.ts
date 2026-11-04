// Affiche les 20 dernières lignes du journal de la base de développement
// (story 1.9) : date à l'heure de Paris, type, auteur (« Système » ou nom du
// membre), détails.
//   npm run journal
// Refusé hors du projet de développement (SUPABASE_ENVIRONNEMENT).
// Lecture seule, par connexion directe à la base (SUPABASE_DB_URL) : le
// journal n'a aucun droit direct, même pour la clé secrète (migration 0009).

import pg from "pg";
import { formaterDate, formaterHeure } from "../lib/format.ts";
import { preparerEnvironnement } from "./commun.ts";

const NOMBRE = 20;

preparerEnvironnement("journal");

type Ligne = {
  cree_le: Date;
  type: string;
  auteur_type: string;
  auteur_nom: string | null;
  details: unknown;
};

async function principal() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL manquant dans .env.local.");

  const base = new pg.Client({ connectionString: url });
  await base.connect();
  try {
    await base.query("begin read only");
    const { rows } = await base.query<Ligne>(
      `select j.cree_le, j.type, j.auteur_type, m.nom as auteur_nom, j.details
         from public.journal j
         left join public.membres m on m.id = j.auteur_id
        order by j.cree_le desc, j.id desc
        limit $1`,
      [NOMBRE],
    );
    await base.query("commit");

    if (rows.length === 0) {
      console.log("Journal vide.");
      return;
    }
    console.log(`Journal — ${rows.length} dernière(s) ligne(s), de la plus récente à la plus ancienne :`);
    for (const ligne of rows) {
      const date = `${formaterDate(ligne.cree_le)} à ${formaterHeure(ligne.cree_le)}`;
      const auteur =
        ligne.auteur_type === "systeme" ? "Système" : (ligne.auteur_nom ?? "Membre inconnu");
      console.log(`${date}  ${ligne.type.padEnd(10)}  ${auteur}  ${JSON.stringify(ligne.details)}`);
    }
  } finally {
    await base.end();
  }
}

principal().catch((erreur) => {
  console.error(`journal : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  process.exit(1);
});
