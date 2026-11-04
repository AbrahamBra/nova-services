import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client, type DatabaseError } from "pg";
import { empreinteDeTest } from "../outils/ip-test";
import { ETATS_EMAIL_RESULTAT, TYPES_JOURNAL } from "@/lib/domaine";

// Story 1.7 — `noter_resultat_email`, table `journal`, `prive.ecrire_journal`
// et réponse de `deposer_demande` / `lire_confirmation`, sur le projet de
// développement. Nécessite la migration 20261103000009.
//
// Tout tourne dans des transactions annulées : aucune demande ni ligne de
// journal ne reste en base (le journal est en ajout seulement).

/** Auteurs possibles d'une ligne du journal (CHECK en base). */
const AUTEURS_JOURNAL = ["membre", "systeme"];

const PREFIXE = `TEST-1.7-${crypto.randomUUID().slice(0, 8)}`;
const EMAIL_DEMANDEUR = "sophie.garnier.1-7@example.com";

function variable(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} manquant dans .env.local.`);
  return valeur;
}

let base: Client;
let categorieActive: string;

beforeAll(async () => {
  base = new Client({ connectionString: variable("SUPABASE_DB_URL") });
  await base.connect();
  const { rows } = await base.query<{ id: string }>(
    "select id from public.categories where actif order by ordre limit 1",
  );
  categorieActive = rows[0].id;
});

afterAll(async () => {
  if (base) {
    // Filet de sécurité : rien ne devrait rester (transactions annulées).
    await base.query("delete from public.demandes where nom like $1", [`${PREFIXE}%`]);
    await base.end();
  }
});

type ReponseDepot = {
  reference: string;
  jeton: string;
  id: string;
  objet: string;
  cree_le: string;
  nom_affiche: string;
  email_contact: string;
  nouvelle: boolean;
  etat_email: string;
};

async function deposer(cle = crypto.randomUUID()): Promise<ReponseDepot> {
  const { rows } = await base.query(
    `select public.deposer_demande($1, $2, $3, '06 12 34 56 78', 'Atelier Garnier', $4,
                                   'Impression impossible', 'Description secrète.', true,
                                   $5) as r`,
    [cle, `${PREFIXE} Sophie Garnier`, EMAIL_DEMANDEUR, categorieActive, empreinteDeTest()],
  );
  return rows[0].r;
}

async function noter(id: string, etat: string, code: string | null = null): Promise<void> {
  await base.query("select public.noter_resultat_email($1, $2, $3)", [id, etat, code]);
}

async function etatEmail(id: string): Promise<string> {
  const { rows } = await base.query("select etat_email from public.demandes where id = $1", [id]);
  return rows[0].etat_email;
}

async function lignesJournalDe(reference: string) {
  const { rows } = await base.query(
    `select type, details, auteur_type, auteur_id, details::text as brut
       from public.journal where details ->> 'reference' = $1`,
    [reference],
  );
  return rows;
}

/** Exécute `travail` dans une transaction toujours annulée. */
async function dansTransactionAnnulee<T>(travail: () => Promise<T>): Promise<T> {
  await base.query("begin");
  try {
    return await travail();
  } finally {
    await base.query("rollback").catch(() => {});
  }
}

async function erreurDe(promesse: Promise<unknown>): Promise<DatabaseError> {
  try {
    await promesse;
  } catch (erreur) {
    return erreur as DatabaseError;
  }
  throw new Error("Une erreur était attendue.");
}

/** Erreur dans un point de sauvegarde : la transaction reste utilisable. */
async function erreurIsolee(promesse: () => Promise<unknown>): Promise<DatabaseError> {
  await base.query("savepoint essai");
  const erreur = await erreurDe(promesse());
  await base.query("rollback to savepoint essai");
  return erreur;
}

describe("deposer_demande — données de l'email (AD-13)", () => {
  it("renvoie l'identifiant, l'objet, la date, le contact et nouvelle = vrai", async () => {
    await dansTransactionAnnulee(async () => {
      const r = await deposer();
      const { rows } = await base.query(
        "select id, objet, cree_le from public.demandes where reference = $1",
        [r.reference],
      );
      expect(r).toMatchObject({
        id: rows[0].id,
        objet: "Impression impossible",
        nom_affiche: "Nova Services",
        email_contact: "contact@nova-services.example",
        nouvelle: true,
        etat_email: "en_attente",
      });
      expect(new Date(r.cree_le).getTime()).toBe(rows[0].cree_le.getTime());
      // Jamais la description, le téléphone, la société, le nom ni l'email.
      const texte = JSON.stringify(r);
      for (const absent of ["Description secrète", "06 12", "Atelier", "Sophie", EMAIL_DEMANDEUR]) {
        expect(texte).not.toContain(absent);
      }
    });
  });
});

describe("deposer_demande — second envoi de la même clé (migration 0010)", () => {
  it("renvoie l'état actuel de l'email : en_attente puis, une fois noté, envoye", async () => {
    await dansTransactionAnnulee(async () => {
      const cle = crypto.randomUUID();
      const premier = await deposer(cle);
      const second = await deposer(cle);
      expect(second).toMatchObject({ id: premier.id, nouvelle: false, etat_email: "en_attente" });
      await noter(premier.id, "envoye");
      expect(await deposer(cle)).toMatchObject({ nouvelle: false, etat_email: "envoye" });
    });
  });
});

describe("noter_resultat_email — passages d'état", () => {
  for (const etat of ETATS_EMAIL_RESULTAT) {
    it(`en_attente → ${etat}`, async () => {
      await dansTransactionAnnulee(async () => {
        const { id } = await deposer();
        expect(await etatEmail(id)).toBe("en_attente");
        await noter(id, etat, etat === "echec" ? "delai_depasse" : null);
        expect(await etatEmail(id)).toBe(etat);
      });
    });
  }

  it("double notation → EMAIL_DEJA_NOTE, seul le premier passage compte", async () => {
    await dansTransactionAnnulee(async () => {
      const { id } = await deposer();
      await noter(id, "envoye");
      const erreur = await erreurIsolee(() => noter(id, "echec", "exception"));
      expect(erreur.code).toBe("P0001");
      expect(erreur.message).toBe("EMAIL_DEJA_NOTE");
      expect(await etatEmail(id)).toBe("envoye");
    });
  });

  it("état non permis → DONNEES_INVALIDES, état inchangé", async () => {
    await dansTransactionAnnulee(async () => {
      const { id } = await deposer();
      for (const etat of ["en_attente", "sans_email", "ENVOYE", "inconnu", null]) {
        const erreur = await erreurIsolee(() =>
          base.query("select public.noter_resultat_email($1, $2)", [id, etat]),
        );
        expect(erreur.message, String(etat)).toBe("DONNEES_INVALIDES");
      }
      expect(await etatEmail(id)).toBe("en_attente");
    });
  });

  it("demande inconnue → DEMANDE_INTROUVABLE", async () => {
    const erreur = await erreurDe(noter(crypto.randomUUID(), "envoye"));
    expect(erreur.code).toBe("P0001");
    expect(erreur.message).toBe("DEMANDE_INTROUVABLE");
  });
});

describe("journal — échec d'envoi (AD-14, AD-19)", () => {
  it("echec → une ligne « email », auteur système, référence et code, sans l'adresse", async () => {
    await dansTransactionAnnulee(async () => {
      const { id, reference } = await deposer();
      await noter(id, "echec", "invalid_api_key");
      const lignes = await lignesJournalDe(reference);
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toMatchObject({
        type: "email",
        auteur_type: "systeme",
        auteur_id: null,
        details: { evenement: "echec_confirmation", reference, code: "invalid_api_key" },
      });
      expect(TYPES_JOURNAL).toContain(lignes[0].type);
      expect(AUTEURS_JOURNAL).toContain(lignes[0].auteur_type);
      expect(lignes[0].brut).not.toContain(EMAIL_DEMANDEUR);
      expect(lignes[0].brut).not.toContain("Sophie");
    });
  });

  it("code d'erreur non conforme → remplacé par « inconnu » (jamais recopié)", async () => {
    await dansTransactionAnnulee(async () => {
      const { id, reference } = await deposer();
      await noter(id, "echec", `Refusé : ${EMAIL_DEMANDEUR}`);
      const lignes = await lignesJournalDe(reference);
      expect(lignes[0].details.code).toBe("inconnu");
      expect(lignes[0].brut).not.toContain(EMAIL_DEMANDEUR);
    });
  });

  it("echec sans code → noté « inconnu »", async () => {
    await dansTransactionAnnulee(async () => {
      const { id, reference } = await deposer();
      await noter(id, "echec", null);
      const lignes = await lignesJournalDe(reference);
      expect(lignes).toHaveLength(1);
      expect(lignes[0].details.code).toBe("inconnu");
    });
  });

  it("envoye et non_envoye_demo → aucune ligne de journal", async () => {
    await dansTransactionAnnulee(async () => {
      const a = await deposer();
      const b = await deposer();
      await noter(a.id, "envoye");
      await noter(b.id, "non_envoye_demo");
      expect(await lignesJournalDe(a.reference)).toEqual([]);
      expect(await lignesJournalDe(b.reference)).toEqual([]);
    });
  });

  it("le journal ne se modifie pas (ajout seulement)", async () => {
    await dansTransactionAnnulee(async () => {
      const { id, reference } = await deposer();
      await noter(id, "echec", "exception");
      const erreur = await erreurDe(
        base.query(
          "update public.journal set details = '{}'::jsonb where details ->> 'reference' = $1",
          [reference],
        ),
      );
      expect(erreur.message).toMatch(/journal ne se modifie pas/);
    });
  });

  it("DELETE et TRUNCATE refusés, sauf avec le drapeau de purge de la transaction", async () => {
    await dansTransactionAnnulee(async () => {
      const { id, reference } = await deposer();
      await noter(id, "echec", "exception");
      const effacement = await erreurIsolee(() =>
        base.query("delete from public.journal where details ->> 'reference' = $1", [reference]),
      );
      expect(effacement.message).toMatch(/journal ne s'efface pas/);
      const vidage = await erreurIsolee(() => base.query("truncate public.journal"));
      expect(vidage.message).toMatch(/journal ne s'efface pas/);
      expect(await lignesJournalDe(reference)).toHaveLength(1);

      // Purge (future purger_technique) : drapeau local à la transaction.
      await base.query("select set_config('nova.purge_journal', 'on', true)");
      const { rowCount } = await base.query(
        "delete from public.journal where details ->> 'reference' = $1",
        [reference],
      );
      expect(rowCount).toBe(1);
    });
  });

  it("type hors liste ou auteur incohérent → refusé par la table", async () => {
    await dansTransactionAnnulee(async () => {
      const type = await erreurIsolee(() =>
        base.query("insert into public.journal (type, auteur_type) values ('autre', 'systeme')"),
      );
      expect(type.code).toBe("23514");
      const auteur = await erreurIsolee(() =>
        base.query("insert into public.journal (type, auteur_type) values ('email', 'membre')"),
      );
      expect(auteur.code).toBe("23514");
    });
  });
});

describe("lire_confirmation — état de l'email", () => {
  it("renvoie l'état de l'email après la notation", async () => {
    await dansTransactionAnnulee(async () => {
      const { id, jeton, reference } = await deposer();
      await noter(id, "envoye");
      const { rows } = await base.query("select public.lire_confirmation($1) as c", [jeton]);
      expect(rows[0].c).toEqual({
        reference,
        nom_affiche: "Nova Services",
        email_contact: "contact@nova-services.example",
        etat_email: "envoye",
      });
    });
  });
});

describe("droits (AD-15)", () => {
  it("noter_resultat_email : service_role seulement", async () => {
    const { rows } = await base.query(
      `select r.role,
              has_function_privilege(r.role, 'public.noter_resultat_email(uuid, text, text)',
                                     'EXECUTE') as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
        order by r.role`,
    );
    expect(rows).toEqual([
      { role: "anon", peut: false },
      { role: "authenticated", peut: false },
      { role: "service_role", peut: true },
    ]);
  });

  it("prive.ecrire_journal : aucun rôle de l'API ne peut l'exécuter", async () => {
    const { rows } = await base.query(
      `select bool_or(has_function_privilege(r.role, 'prive.ecrire_journal(text, jsonb, uuid)',
                                             'EXECUTE')) as peut
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)`,
    );
    expect(rows[0].peut).toBe(false);
  });

  it("journal : aucun droit direct pour anon, authenticated ni service_role", async () => {
    const { rows } = await base.query(
      `select r.role || ':' || d.droit as droit
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
         cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as d(droit)
        where has_table_privilege(r.role, 'public.journal', d.droit)`,
    );
    expect(rows).toEqual([]);
  });

  it("RLS activée sur journal", async () => {
    const { rows } = await base.query(
      "select relrowsecurity from pg_class where oid = 'public.journal'::regclass",
    );
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it("clé publiable : noter_resultat_email et lecture du journal refusées", async () => {
    const visiteur = createClient(
      variable("NEXT_PUBLIC_SUPABASE_URL"),
      variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const notation = await visiteur.rpc("noter_resultat_email", {
      p_demande_id: crypto.randomUUID(),
      p_etat: "envoye",
      p_code_erreur: null,
    });
    expect(notation.data).toBeNull();
    expect(["42501", "PGRST202"]).toContain(notation.error?.code);

    const lecture = await visiteur.from("journal").select("*").limit(1);
    expect(lecture.data).toBeNull();
    expect(lecture.error?.code).toBe("42501");
  });

  it("clé secrète : lecture directe du journal refusée", async () => {
    const serveur = createClient(
      variable("NEXT_PUBLIC_SUPABASE_URL"),
      variable("SUPABASE_SECRET_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const lecture = await serveur.from("journal").select("*").limit(1);
    expect(lecture.data).toBeNull();
    expect(lecture.error?.code).toBe("42501");
  });
});
