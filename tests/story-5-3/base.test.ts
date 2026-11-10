import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { TYPE_EVENEMENT_JOURNAL, clesJournalValides, descriptionJournal } from "@/lib/journal";
import {
  clientPubliableTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { empreinteDeTest } from "@/tests/outils/ip-test";

// Story 5.3 — fonctions SQL des paramètres sur le projet de développement
// (migration 20261103000032) : droits (authenticated seulement, SECURITY
// DEFINER, search_path vide), administrateur actif seulement, bornes,
// normalisation, `mis_a_jour_le`, `{modifie: false}` sans journal, journal
// avec seulement les champs changés.
// Base partagée : la ligne `parametres` est lue par le formulaire public et
// par d'autres tests. Chaque modification a lieu dans une transaction
// ANNULÉE (rollback) : les valeurs de départ ne changent jamais pour les
// autres, et les lignes de journal écrites disparaissent avec elle.

const comptes: CompteTest[] = [];
let admin: CompteTest;
let collaborateur: CompteTest;
let base: Client;

async function compte(options: Parameters<typeof creerCompteTest>[0]): Promise<CompteTest> {
  const c = await creerCompteTest({ etiquette: "5.3", ...options });
  comptes.push(c);
  return c;
}

beforeAll(async () => {
  admin = await compte({ role: "administrateur", prenom: "Claire" });
  collaborateur = await compte({ role: "collaborateur", prenom: "Karim" });
  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
}, 60_000);

afterAll(async () => {
  await base?.end().catch(() => {});
  // Aucune ligne de journal à effacer : toutes les modifications sont annulées.
  await supprimerComptesTest(comptes);
}, 60_000);

// Jamais de transaction laissée ouverte (ni de verrou sur la ligne
// `parametres`) après un échec.
afterEach(async () => {
  await base?.query("rollback").catch(() => {});
});

type Parametres = {
  nom_affiche: string;
  email_contact: string;
  duree_conservation_mois: number;
  mis_a_jour_le: string;
};

type Reponse = {
  nom_affiche: string;
  email_contact: string;
  duree_conservation_mois: number;
  modifie: boolean;
};

/** Valeurs actuelles, lues directement (propriétaire de la base). */
async function lire(): Promise<Parametres> {
  const { rows } = await base.query<Parametres>(
    "select nom_affiche, email_contact, duree_conservation_mois, mis_a_jour_le::text from public.parametres",
  );
  return rows[0];
}

/**
 * Exécute `travail` dans une transaction toujours ANNULÉE. `appeler` passe
 * sous la session simulée de `c` le temps d'un appel, puis revient au
 * propriétaire (lecture de la table et du journal).
 */
async function dansTransactionAnnulee<T>(
  travail: (appeler: <R>(c: CompteTest, sql: string, parametres?: unknown[]) => Promise<R>) => Promise<T>,
): Promise<T> {
  await base.query("begin");
  try {
    return await travail(async <R,>(c: CompteTest, sql: string, parametres: unknown[] = []) => {
      await base.query("savepoint appel");
      try {
        await base.query("set local role authenticated");
        await base.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: c.id, role: "authenticated" }),
        ]);
        const { rows } = await base.query<{ r: R }>(`select ${sql} as r`, parametres);
        await base.query("reset role");
        await base.query("release savepoint appel");
        return rows[0].r;
      } catch (erreur) {
        await base.query("rollback to savepoint appel");
        await base.query("reset role");
        throw erreur;
      }
    });
  } finally {
    await base.query("rollback");
  }
}

async function codeDe(promesse: Promise<unknown>): Promise<string | null> {
  try {
    await promesse;
    return null;
  } catch (erreur) {
    return (erreur as { message?: string }).message ?? String(erreur);
  }
}

/** Lignes `parametres_modifies` écrites par `c` (dans la transaction en cours). */
async function journalDe(c: CompteTest) {
  const { rows } = await base.query<{ type: string; auteur_id: string; details: Record<string, unknown> }>(
    `select type, auteur_id, details from public.journal
      where auteur_id = $1 and details ->> 'evenement' = 'parametres_modifies'
      order by id`,
    [c.id],
  );
  return rows;
}

const MODIFIER = "public.modifier_parametres($1, $2, $3)";

describe("droits", () => {
  const FONCTIONS = [
    "public.lire_parametres_admin()",
    "public.modifier_parametres(text, text, integer)",
  ];

  it("EXECUTE à authenticated seulement ; SECURITY DEFINER, search_path vide", async () => {
    const { rows } = await base.query<{ f: string; r: string; peut: boolean }>(
      `select f, r, has_function_privilege(r, f, 'EXECUTE') as peut
         from unnest($1::text[]) as f, unnest(array['anon', 'authenticated', 'service_role']) as r`,
      [FONCTIONS],
    );
    expect(rows).toHaveLength(FONCTIONS.length * 3);
    for (const l of rows) expect(l.peut, `${l.f} ${l.r}`).toBe(l.r === "authenticated");

    const { rows: definitions } = await base.query<{ nom: string; definer: boolean; config: string[] | null }>(
      `select p.proname as nom, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('lire_parametres_admin', 'modifier_parametres')`,
    );
    expect(definitions).toHaveLength(FONCTIONS.length);
    for (const d of definitions) {
      expect(d.definer, d.nom).toBe(true);
      expect(d.config, d.nom).toContain('search_path=""');
    }
  });

  it("visiteur (clé publiable) : refusé", async () => {
    const { data, error } = await clientPubliableTest().rpc("modifier_parametres", {
      p_nom_affiche: "Visiteur",
      p_email_contact: "visiteur@example.com",
      p_duree_mois: 12,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("collaborateur : DROIT_INSUFFISANT pour lire et modifier, rien ne change", async () => {
    const avant = await lire();
    await dansTransactionAnnulee(async (appeler) => {
      expect(await codeDe(appeler(collaborateur, "public.lire_parametres_admin()"))).toBe(
        "DROIT_INSUFFISANT",
      );
      expect(
        await codeDe(appeler(collaborateur, MODIFIER, ["Collaborateur", "collab@example.com", 12])),
      ).toBe("DROIT_INSUFFISANT");
      expect(await lire()).toEqual(avant);
      expect(await journalDe(collaborateur)).toEqual([]);
    });
  });
});

describe("lire_parametres_admin", () => {
  it("valeurs actuelles pour l'administrateur", async () => {
    const actuels = await lire();
    const lus = await dansTransactionAnnulee((appeler) =>
      appeler<Record<string, unknown>>(admin, "public.lire_parametres_admin()"),
    );
    expect(Object.keys(lus).sort()).toEqual(
      ["duree_conservation_mois", "email_contact", "mis_a_jour_le", "nom_affiche"].sort(),
    );
    expect(lus).toMatchObject({
      nom_affiche: actuels.nom_affiche,
      email_contact: actuels.email_contact,
      duree_conservation_mois: actuels.duree_conservation_mois,
    });
  });
});

describe("modifier_parametres (transactions annulées)", () => {
  it("email et durée changés : enregistrés, normalisés, mis_a_jour_le, journal des seuls champs changés", async () => {
    const avant = await lire();
    const nouvelleDuree = avant.duree_conservation_mois === 36 ? 48 : 36;
    // Valeur de test toujours différente de la valeur de départ.
    const email = avant.email_contact === "accueil@nova.example" ? "accueil2@nova.example" : "accueil@nova.example";
    await dansTransactionAnnulee(async (appeler) => {
      const r = await appeler<Reponse>(admin, MODIFIER, [
        avant.nom_affiche,
        `  ${email.replace("accueil", "Accueil")} `,
        nouvelleDuree,
      ]);
      expect(r).toEqual({
        nom_affiche: avant.nom_affiche,
        email_contact: email,
        duree_conservation_mois: nouvelleDuree,
        modifie: true,
      });
      const apres = await lire();
      expect(apres).toMatchObject({
        nom_affiche: avant.nom_affiche,
        email_contact: email,
        duree_conservation_mois: nouvelleDuree,
      });
      expect(new Date(apres.mis_a_jour_le).getTime()).toBeGreaterThan(
        new Date(avant.mis_a_jour_le).getTime(),
      );

      // Formulaire public : les nouvelles valeurs, lues en direct.
      const { rows } = await base.query<{ r: Record<string, unknown> }>(
        "select public.infos_publiques() as r",
      );
      expect(rows[0].r).toMatchObject({
        email_contact: email,
        duree_conservation_mois: nouvelleDuree,
      });

      const lignes = await journalDe(admin);
      expect(lignes).toHaveLength(1);
      expect(lignes[0].type).toBe("parametre");
      expect(lignes[0].auteur_id).toBe(admin.id);
      expect(lignes[0].details).toEqual({
        evenement: "parametres_modifies",
        email_contact: email,
        ancien_email_contact: avant.email_contact,
        duree_conservation_mois: nouvelleDuree,
        ancienne_duree_conservation_mois: avant.duree_conservation_mois,
      });
      expect(TYPE_EVENEMENT_JOURNAL.parametres_modifies).toBe("parametre");
      expect(clesJournalValides("parametres_modifies", Object.keys(lignes[0].details))).toBe(true);
      expect(descriptionJournal(lignes[0].details)).toContain(
        `email de contact « ${avant.email_contact} » → « ${email} »`,
      );
    });
    // Annulé : rien n'a changé pour les autres.
    expect(await lire()).toEqual(avant);
  });

  it("nom affiché seul changé (espaces retirés) : journal avec nom_affiche et ancien_nom_affiche", async () => {
    const avant = await lire();
    const nom = avant.nom_affiche === "TEST-5.3 Nova Accueil" ? "TEST-5.3 Nova Contact" : "TEST-5.3 Nova Accueil";
    await dansTransactionAnnulee(async (appeler) => {
      const r = await appeler<Reponse>(admin, MODIFIER, [
        `   ${nom}  `,
        avant.email_contact,
        avant.duree_conservation_mois,
      ]);
      expect(r.nom_affiche).toBe(nom);
      expect(r.modifie).toBe(true);
      expect((await journalDe(admin)).map((l) => l.details)).toEqual([
        {
          evenement: "parametres_modifies",
          nom_affiche: nom,
          ancien_nom_affiche: avant.nom_affiche,
        },
      ]);
    });
    expect(await lire()).toEqual(avant);
  });

  it("email de confirmation et page de confirmation : les nouvelles valeurs, dans la même transaction", async () => {
    const avant = await lire();
    const nom = avant.nom_affiche === "TEST-5.3 Nova Accueil" ? "TEST-5.3 Nova Contact" : "TEST-5.3 Nova Accueil";
    const email = avant.email_contact === "accueil@nova.example" ? "accueil2@nova.example" : "accueil@nova.example";
    await dansTransactionAnnulee(async (appeler) => {
      await appeler<Reponse>(admin, MODIFIER, [nom, email, avant.duree_conservation_mois]);
      // `deposer_demande` renvoie les données de l'email de confirmation
      // (lib/actions/demandes.ts → contenuConfirmation) : nom et contact lus en direct.
      const { rows: categories } = await base.query<{ id: string }>(
        "select id from public.categories where actif order by ordre limit 1",
      );
      const { rows } = await base.query<{ r: Record<string, unknown> }>(
        "select public.deposer_demande($1, $2, $3, null, null, $4, $5, $6, true, $7) as r",
        [
          randomUUID(),
          "TEST-5.3 Sophie Garnier",
          "sophie.garnier@example.com",
          categories[0].id,
          "Demande de test 5.3",
          "Description.",
          empreinteDeTest(),
        ],
      );
      expect(rows[0].r).toMatchObject({ nom_affiche: nom, email_contact: email, nouvelle: true });
      // Page de confirmation (lire_confirmation) : mêmes valeurs.
      const { rows: confirmation } = await base.query<{ r: Record<string, unknown> }>(
        "select public.lire_confirmation($1) as r",
        [rows[0].r.jeton],
      );
      expect(confirmation[0].r).toMatchObject({ nom_affiche: nom, email_contact: email });
    });
    // Annulé : ni paramètres changés ni demande créée.
    expect(await lire()).toEqual(avant);
  });

  it("rien de changé (mêmes valeurs, majuscules et espaces compris) : modifie false, aucune écriture", async () => {
    const avant = await lire();
    await dansTransactionAnnulee(async (appeler) => {
      const r = await appeler<Reponse>(admin, MODIFIER, [
        ` ${avant.nom_affiche} `,
        ` ${avant.email_contact.toUpperCase()} `,
        avant.duree_conservation_mois,
      ]);
      expect(r).toEqual({
        nom_affiche: avant.nom_affiche,
        email_contact: avant.email_contact,
        duree_conservation_mois: avant.duree_conservation_mois,
        modifie: false,
      });
      // Ni journal, ni date de mise à jour.
      expect(await journalDe(admin)).toEqual([]);
      expect(await lire()).toEqual(avant);
    });
  });

  it.each([
    ["durée 5 mois", ["Nova", "accueil@nova.example", 5]],
    ["durée 61 mois", ["Nova", "accueil@nova.example", 61]],
    ["durée absente", ["Nova", "accueil@nova.example", null]],
    ["email sans domaine complet", ["Nova", "accueil@nova", 24]],
    ["email sans @", ["Nova", "accueil.nova.example", 24]],
    ["email vide", ["Nova", "   ", 24]],
    ["nom vide", ["   ", "accueil@nova.example", 24]],
    ["nom de 151 caractères", ["x".repeat(151), "accueil@nova.example", 24]],
    ["nom absent", [null, "accueil@nova.example", 24]],
  ])("%s : DONNEES_INVALIDES, rien ne change", async (_cas, parametres) => {
    const avant = await lire();
    await dansTransactionAnnulee(async (appeler) => {
      expect(await codeDe(appeler(admin, MODIFIER, parametres))).toBe("DONNEES_INVALIDES");
      expect(await journalDe(admin)).toEqual([]);
    });
    expect(await lire()).toEqual(avant);
  });

  it("bornes acceptées : 6 et 60 mois, nom de 150 caractères", async () => {
    const avant = await lire();
    await dansTransactionAnnulee(async (appeler) => {
      for (const duree of [6, 60]) {
        const r = await appeler<Reponse>(admin, MODIFIER, ["x".repeat(150), avant.email_contact, duree]);
        expect(r.duree_conservation_mois).toBe(duree);
        expect([...r.nom_affiche]).toHaveLength(150);
      }
    });
    expect(await lire()).toEqual(avant);
  });
});
