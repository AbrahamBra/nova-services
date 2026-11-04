import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client, type DatabaseError } from "pg";
import { empreinteDeTest } from "../outils/ip-test";
import { CANAUX, ETATS_EMAIL, PRIORITES, STATUTS, TYPES_HISTORIQUE } from "@/lib/domaine";

// Story 1.3 — `deposer_demande` et `lire_confirmation` sur le projet de
// développement (nova-dev). Nécessite la migration 20261103000003.
//
// Les demandes qui doivent être validées (idempotence, envois simultanés,
// appel par l'API) portent un nom préfixé `TEST-` propre à cette exécution
// et sont effacées à la fin (historique effacé en cascade). Les autres cas
// tournent dans une transaction annulée.

const PREFIXE = `TEST-1.3-${crypto.randomUUID().slice(0, 8)}`;
const SIGNATURE =
  "public.deposer_demande(uuid, text, text, text, text, uuid, text, text, boolean, text)";

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
    await base.query("delete from public.demandes where nom like $1", [`${PREFIXE}%`]);
    await base.end();
  }
});

type Depot = {
  cle_envoi: string;
  nom: string;
  email: string;
  telephone: string | null;
  societe: string | null;
  categorie_id: string;
  objet: string;
  description: string;
  consentement: boolean;
};

function depot(modifs: Partial<Depot> = {}): Depot {
  return {
    cle_envoi: crypto.randomUUID(),
    nom: `${PREFIXE} Sophie Garnier`,
    email: "sophie.garnier@example.com",
    telephone: null,
    societe: null,
    categorie_id: categorieActive,
    objet: "Impression impossible",
    description: "Depuis lundi, plus rien ne sort.",
    consentement: true,
    ...modifs,
  };
}

async function deposer(
  client: Client,
  d: Depot,
): Promise<{ reference: string; jeton: string }> {
  const { rows } = await client.query(
    `select public.deposer_demande($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r`,
    [
      d.cle_envoi,
      d.nom,
      d.email,
      d.telephone,
      d.societe,
      d.categorie_id,
      d.objet,
      d.description,
      d.consentement,
      // Empreinte d'IP propre à chaque appel (story 1.8) : jamais la limite.
      empreinteDeTest(),
    ],
  );
  return rows[0].r;
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

const FORMAT_REFERENCE = /^NOVA-\d{4}-\d{4,}$/;
const ANNEE_PARIS = Number(
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(
    new Date(),
  ),
);

describe("deposer_demande — enregistrement", () => {
  it("enregistre la demande avec les valeurs par défaut et l'historique « creation »", async () => {
    await dansTransactionAnnulee(async () => {
      const d = depot({ telephone: "06 12 34 56 78", societe: "Atelier Garnier" });
      const { reference, jeton } = await deposer(base, d);

      expect(reference).toMatch(FORMAT_REFERENCE);
      expect(reference.startsWith(`NOVA-${ANNEE_PARIS}-`)).toBe(true);
      expect(jeton).toMatch(/^[0-9a-f]{64}$/);

      const { rows } = await base.query("select * from public.demandes where reference = $1", [
        reference,
      ]);
      expect(rows).toHaveLength(1);
      const demande = rows[0];
      expect(demande).toMatchObject({
        canal: "formulaire",
        statut: "nouvelle",
        priorite: "normale",
        etat_email: "en_attente",
        responsable_id: null,
        saisie_par_id: null,
        traitee_le: null,
        nom: d.nom,
        email: d.email,
        telephone: "06 12 34 56 78",
        societe: "Atelier Garnier",
        categorie_id: categorieActive,
        cle_envoi: d.cle_envoi,
        jeton_confirmation: jeton,
      });
      expect(demande.consentement_le).toBeInstanceOf(Date);
      expect(demande.cree_le).toBeInstanceOf(Date);
      expect(demande.mis_a_jour_le).toBeInstanceOf(Date);

      // Les valeurs par défaut sont bien des codes de lib/domaine.ts.
      expect(CANAUX).toContain(demande.canal);
      expect(STATUTS).toContain(demande.statut);
      expect(PRIORITES).toContain(demande.priorite);
      expect(ETATS_EMAIL).toContain(demande.etat_email);

      const historique = await base.query(
        "select auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur from public.historique where demande_id = $1",
        [demande.id],
      );
      expect(historique.rows).toEqual([
        {
          auteur_type: "demandeur",
          auteur_id: null,
          type: "creation",
          ancienne_valeur: null,
          nouvelle_valeur: "formulaire",
        },
      ]);
      expect(TYPES_HISTORIQUE).toContain(historique.rows[0].type);
    });
  });

  it("enregistre l'email en minuscules, sans espaces (AD-31)", async () => {
    await dansTransactionAnnulee(async () => {
      const { reference } = await deposer(base, depot({ email: "  Jean.Dupont@Example.COM " }));
      const { rows } = await base.query("select email from public.demandes where reference = $1", [
        reference,
      ]);
      expect(rows[0].email).toBe("jean.dupont@example.com");
    });
  });

  it("enregistre un texte contenant <script> tel quel", async () => {
    await dansTransactionAnnulee(async () => {
      const texte = "<script>alert('x')</script>\nBonjour";
      const { reference } = await deposer(base, depot({ description: texte }));
      const { rows } = await base.query(
        "select description from public.demandes where reference = $1",
        [reference],
      );
      expect(rows[0].description).toBe(texte);
    });
  });

  it("le numéro s'allonge au-delà de 9 999", async () => {
    await dansTransactionAnnulee(async () => {
      await base.query(
        `insert into public.compteurs_reference (annee, dernier_numero) values ($1, 9999)
         on conflict (annee) do update set dernier_numero = 9999`,
        [ANNEE_PARIS],
      );
      const { reference } = await deposer(base, depot());
      expect(reference).toBe(`NOVA-${ANNEE_PARIS}-10000`);
    });
  });

  it("refuse toute modification de l'historique (ajout seulement)", async () => {
    await dansTransactionAnnulee(async () => {
      const { reference } = await deposer(base, depot());
      const erreur = await erreurDe(
        base.query(
          `update public.historique set type = 'note_ajoutee'
           where demande_id = (select id from public.demandes where reference = $1)`,
          [reference],
        ),
      );
      expect(erreur.message).toMatch(/historique ne se modifie pas/);
    });
  });
});

describe("deposer_demande — refus (P0001)", () => {
  async function refus(d: Depot): Promise<DatabaseError> {
    return dansTransactionAnnulee(() => erreurDe(deposer(base, d)));
  }

  it("objet de 151 caractères → DONNEES_INVALIDES", async () => {
    const erreur = await refus(depot({ objet: "o".repeat(151) }));
    expect(erreur.code).toBe("P0001");
    expect(erreur.message).toBe("DONNEES_INVALIDES");
  });

  it("autres longueurs, champs vides et email mal écrit → DONNEES_INVALIDES", async () => {
    for (const modifs of [
      { nom: "n".repeat(151) },
      { societe: "s".repeat(151) },
      { telephone: "0".repeat(31) },
      { description: "d".repeat(5001) },
      { description: "   " },
      { nom: "" },
      { email: "abc" },
    ] satisfies Partial<Depot>[]) {
      const erreur = await refus(depot(modifs));
      expect(erreur.message, JSON.stringify(Object.keys(modifs))).toBe("DONNEES_INVALIDES");
    }
  });

  it("compte les caractères comme Zod : 150 emojis acceptés", async () => {
    await dansTransactionAnnulee(async () => {
      const { reference } = await deposer(base, depot({ objet: "😀".repeat(150) }));
      expect(reference).toMatch(FORMAT_REFERENCE);
    });
  });

  it("case non cochée → CONSENTEMENT_REQUIS", async () => {
    const erreur = await refus(depot({ consentement: false }));
    expect(erreur.code).toBe("P0001");
    expect(erreur.message).toBe("CONSENTEMENT_REQUIS");
  });

  it("catégorie inconnue → CATEGORIE_INVALIDE", async () => {
    const erreur = await refus(depot({ categorie_id: crypto.randomUUID() }));
    expect(erreur.code).toBe("P0001");
    expect(erreur.message).toBe("CATEGORIE_INVALIDE");
  });

  it("catégorie désactivée → CATEGORIE_INVALIDE", async () => {
    const erreur = await dansTransactionAnnulee(async () => {
      const { rows } = await base.query<{ id: string }>(
        "insert into public.categories (nom, actif, ordre) values ($1, false, 99) returning id",
        [`${PREFIXE} inactive`],
      );
      return erreurDe(deposer(base, depot({ categorie_id: rows[0].id })));
    });
    expect(erreur.message).toBe("CATEGORIE_INVALIDE");
  });

  it("les contraintes de la table refusent un texte trop long (insertion directe)", async () => {
    const erreur = await dansTransactionAnnulee(() =>
      erreurDe(
        base.query(
          `insert into public.demandes (reference, jeton_confirmation, cle_envoi, canal, nom, email,
             objet, description, categorie_id, consentement_le)
           values ('NOVA-1999-0001', repeat('a', 64), gen_random_uuid(), 'formulaire', $1,
             'jean@example.com', repeat('o', 151), 'Texte', $2, now())`,
          [`${PREFIXE} direct`, categorieActive],
        ),
      ),
    );
    expect(erreur.code).toBe("23514"); // violation de CHECK (objet de 151 caractères)
    expect(erreur.message).toMatch(/demandes_objet_check/);
  });
});

describe("deposer_demande — anti-doublon et envois simultanés", () => {
  it("même cle_envoi deux fois → une seule demande, même référence et même jeton", async () => {
    const d = depot();
    const premier = await deposer(base, d);
    const second = await deposer(base, { ...d, objet: "Objet modifié" });
    // Même demande ; seul le premier appel l'a créée (et envoie l'email, story 1.7).
    expect(second).toEqual({ ...premier, nouvelle: false });
    expect(premier).toMatchObject({ nouvelle: true, objet: d.objet });

    const { rows } = await base.query(
      "select count(*)::int as n, min(objet) as objet from public.demandes where cle_envoi = $1",
      [d.cle_envoi],
    );
    expect(rows[0]).toEqual({ n: 1, objet: d.objet });
  });

  it("même cle_envoi envoyée en même temps → une seule demande", async () => {
    const autre = new Client({ connectionString: variable("SUPABASE_DB_URL") });
    await autre.connect();
    try {
      const d = depot();
      const [a, b] = await Promise.all([deposer(base, d), deposer(autre, d)]);
      expect({ ...a, nouvelle: null }).toEqual({ ...b, nouvelle: null });
      // Un seul des deux appels a créé la demande (un seul email, story 1.7).
      expect([a, b].filter((r) => (r as { nouvelle?: boolean }).nouvelle === true)).toHaveLength(1);
      const { rows } = await base.query(
        "select count(*)::int as n from public.demandes where cle_envoi = $1",
        [d.cle_envoi],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await autre.end();
    }
  });

  it("2 envois simultanés, clés différentes → 2 références différentes", async () => {
    const autre = new Client({ connectionString: variable("SUPABASE_DB_URL") });
    await autre.connect();
    try {
      // Base de développement partagée : d'autres dépôts peuvent s'intercaler,
      // on ne vérifie donc pas que les numéros se suivent.
      const [a, b] = await Promise.all([deposer(base, depot()), deposer(autre, depot())]);
      expect(a.reference).not.toBe(b.reference);
      expect(a.jeton).not.toBe(b.jeton);
    } finally {
      await autre.end();
    }
  });
});

describe("lire_confirmation", () => {
  it("jeton valide → référence et contact, sans aucune donnée du demandeur", async () => {
    await dansTransactionAnnulee(async () => {
      const { reference, jeton } = await deposer(base, depot());
      const { rows } = await base.query("select public.lire_confirmation($1) as c", [jeton]);
      expect(rows[0].c).toEqual({
        reference,
        nom_affiche: "Nova Services",
        email_contact: "contact@nova-services.example",
        // Story 1.7 : état de l'email, jamais une donnée du demandeur.
        etat_email: "en_attente",
      });
    });
  });

  it("jeton inconnu ou mal formé → null", async () => {
    for (const jeton of ["0".repeat(64), "abc", "", "' or 1=1 --"]) {
      const { rows } = await base.query("select public.lire_confirmation($1) as c", [jeton]);
      expect(rows[0].c).toBeNull();
    }
  });

  it("demande de plus de 24 h → null", async () => {
    await dansTransactionAnnulee(async () => {
      const { jeton } = await deposer(base, depot());
      await base.query(
        "update public.demandes set cree_le = now() - interval '24 hours 1 minute' where jeton_confirmation = $1",
        [jeton],
      );
      const { rows } = await base.query("select public.lire_confirmation($1) as c", [jeton]);
      expect(rows[0].c).toBeNull();
    });
  });
});

describe("droits EXECUTE (AD-15, AD-16)", () => {
  it("deposer_demande et lire_confirmation : service_role seulement", async () => {
    const { rows } = await base.query<{ role: string; deposer: boolean; lire: boolean }>(
      `select r.role,
              has_function_privilege(r.role, $1, 'EXECUTE') as deposer,
              has_function_privilege(r.role, 'public.lire_confirmation(text)', 'EXECUTE') as lire
       from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
       order by r.role`,
      [SIGNATURE],
    );
    expect(rows).toEqual([
      { role: "anon", deposer: false, lire: false },
      { role: "authenticated", deposer: false, lire: false },
      { role: "service_role", deposer: true, lire: true },
    ]);
  });

  it("prive.ecrire_historique : aucun rôle de l'API ne peut l'exécuter", async () => {
    const { rows } = await base.query<{ role: string; peut: boolean }>(
      `select r.role,
              has_function_privilege(r.role,
                'prive.ecrire_historique(uuid, text, uuid, text, text)', 'EXECUTE') as peut
       from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
       order by r.role`,
    );
    expect(rows.every((ligne) => !ligne.peut)).toBe(true);
  });

  it("fonctions de public exécutables par service_role : la liste attendue", async () => {
    const { rows } = await base.query<{ fonction: string }>(
      `select f.proname as fonction
       from pg_proc f join pg_namespace n on n.oid = f.pronamespace
       where n.nspname = 'public' and has_function_privilege('service_role', f.oid, 'EXECUTE')
       order by 1`,
    );
    expect(rows.map((ligne) => ligne.fonction)).toEqual([
      // Story 1.9 : blocage de la connexion (action `connexion`).
      "commencer_connexion",
      // Story 1.4 : création des membres (scripts, puis invitations).
      "creer_membre",
      "deposer_demande",
      "infos_publiques",
      "lire_confirmation",
      // Story 1.4 : garde-fou du script premier-admin.
      "nombre_administrateurs_actifs",
      // Story 1.7 : résultat de l'email de confirmation.
      "noter_resultat_email",
      // Story 1.9 : résultat d'une tentative de connexion.
      "terminer_connexion",
    ]);
  });

  it("clé publiable (visiteur) : deposer_demande et lire_confirmation refusées", async () => {
    const visiteur = createClient(
      variable("NEXT_PUBLIC_SUPABASE_URL"),
      variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const d = depot();
    const depotVisiteur = await visiteur.rpc("deposer_demande", {
      p_cle_envoi: d.cle_envoi,
      p_nom: d.nom,
      p_email: d.email,
      p_telephone: null,
      p_societe: null,
      p_categorie_id: d.categorie_id,
      p_objet: d.objet,
      p_description: d.description,
      p_consentement: true,
      p_empreinte_ip: empreinteDeTest(),
    });
    expect(depotVisiteur.data).toBeNull();
    expect(["42501", "PGRST202"]).toContain(depotVisiteur.error?.code);

    const lecture = await visiteur.rpc("lire_confirmation", { p_jeton: "0".repeat(64) });
    expect(lecture.data).toBeNull();
    expect(["42501", "PGRST202"]).toContain(lecture.error?.code);

    const { rows } = await base.query(
      "select count(*)::int as n from public.demandes where cle_envoi = $1",
      [d.cle_envoi],
    );
    expect(rows[0].n).toBe(0);
  });

  it("clé secrète (serveur) : dépôt et confirmation via l'API", async () => {
    const serveur = createClient(
      variable("NEXT_PUBLIC_SUPABASE_URL"),
      variable("SUPABASE_SECRET_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const d = depot();
    const { data, error } = await serveur.rpc("deposer_demande", {
      p_cle_envoi: d.cle_envoi,
      p_nom: d.nom,
      p_email: d.email,
      p_telephone: null,
      p_societe: null,
      p_categorie_id: d.categorie_id,
      p_objet: d.objet,
      p_description: d.description,
      p_consentement: true,
      p_empreinte_ip: empreinteDeTest(),
    });
    expect(error).toBeNull();
    expect(data.reference).toMatch(FORMAT_REFERENCE);

    const lecture = await serveur.rpc("lire_confirmation", { p_jeton: data.jeton });
    expect(lecture.error).toBeNull();
    expect(lecture.data.reference).toBe(data.reference);
  });

  it("anon et authenticated ne lisent aucune des nouvelles tables", async () => {
    const { rows } = await base.query<{ table: string; role: string; peut: boolean }>(
      `select t.nom as table, r.role, has_table_privilege(r.role, 'public.' || t.nom, 'SELECT') as peut
       from unnest(array['demandes', 'historique', 'compteurs_reference']) as t(nom)
       cross join unnest(array['anon', 'authenticated']) as r(role)`,
    );
    expect(rows.filter((ligne) => ligne.peut)).toEqual([]);
  });
});
