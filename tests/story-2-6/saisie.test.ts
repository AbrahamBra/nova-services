import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { phraseLigneHistorique } from "@/components/nova/historique";
import { appeler } from "@/lib/server/appeler";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { supprimerDemandesTest } from "@/tests/outils/demandes";
import { empreinteDeTest } from "@/tests/outils/ip-test";

// Story 2.6 — `saisir_demande` sur la vraie base (migration
// 20261103000020) : cas de la matrice (téléphone sans email, email
// renseigné, ni email ni téléphone, canal absent ou « formulaire », double
// envoi, 10 saisies de suite, champs trop longs, catégorie inactive),
// compteur de références partagé avec le dépôt public, historique, état de
// l'email, droits. Une seule connexion Supabase Auth (limite d'appels).
// Base partagée : données propres `TEST-2.6-…`, effacées à
// la fin ; la catégorie inactive est une catégorie `TEST-…` jetable.

const CODE = randomUUID().slice(0, 8);
const PREFIXE = `TEST-2.6-${CODE}`;
const PERMISSION_REFUSEE = "42501";

const comptes: CompteTest[] = [];
let nadia: CompteTest;
let desactive: CompteTest;
let invite: CompteTest;
let sessionNadia: SupabaseClient;
const sessions: SupabaseClient[] = [];

let base: Client;
let categorie: { id: string; nom: string };
let inactive: { id: string; nom: string };

beforeAll(async () => {
  nadia = await creerCompteTest({ prenom: "Nadia", etiquette: "2.6" });
  comptes.push(nadia);
  desactive = await creerCompteTest({ etat: "desactive", prenom: "Leo", etiquette: "2.6" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", prenom: "Ines", etiquette: "2.6" });
  comptes.push(invite);

  sessionNadia = await clientConnecte(nadia);
  sessions.push(sessionNadia);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();

  const { rows } = await base.query<{ id: string; nom: string }>(
    "select id, nom from public.categories where actif order by ordre, nom limit 1",
  );
  if (rows.length === 0) throw new Error("Une catégorie active est nécessaire.");
  categorie = rows[0];
  const { rows: creee } = await base.query<{ id: string; nom: string }>(
    "insert into public.categories (nom, actif, ordre) values ($1, false, 999) returning id, nom",
    [`${PREFIXE} Ancienne`],
  );
  inactive = creee[0];
}, 60_000);

afterAll(async () => {
  // Demandes d'abord (historique en cascade, `saisie_par_id` vers les
  // comptes), puis la catégorie jetable, puis les comptes.
  let demandesNettoyees = !base;
  try {
    if (base) {
      await supprimerDemandesTest(base, PREFIXE);
      demandesNettoyees = true;
      await base.query("delete from public.categories where nom like $1", [`${PREFIXE}%`]);
    }
  } finally {
    await base?.end().catch(() => {});
    for (const session of sessions) await session.auth.signOut({ scope: "local" }).catch(() => {});
    if (demandesNettoyees) {
      await supprimerComptesTest(comptes);
    } else {
      console.error(`Demandes ${PREFIXE} non nettoyées : comptes de test conservés.`);
    }
  }
}, 60_000);

type Parametres = {
  p_cle_envoi: string | null;
  p_canal: string | null;
  p_nom: string | null;
  p_email: string | null;
  p_telephone: string | null;
  p_societe: string | null;
  p_categorie_id: string | null;
  p_objet: string | null;
  p_description: string | null;
};

function parametres(modifs: Partial<Parametres> = {}): Parametres {
  return {
    p_cle_envoi: randomUUID(),
    p_canal: "telephone",
    p_nom: `${PREFIXE} M. Lambert`,
    p_email: null,
    p_telephone: "06 12 34 56 78",
    p_societe: null,
    p_categorie_id: categorie.id,
    p_objet: "Demande de rendez-vous",
    p_description: "Souhaite un rendez-vous la semaine prochaine.",
    ...modifs,
  };
}

function saisir(client: SupabaseClient, p: Parametres) {
  return client.rpc("saisir_demande", p);
}

type Ligne = {
  id: string;
  reference: string;
  canal: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  societe: string | null;
  saisie_par_id: string | null;
  consentement_le: Date | null;
  etat_email: string;
  statut: string;
  priorite: string;
  responsable_id: string | null;
};

async function demandeParCle(cle: string): Promise<Ligne[]> {
  const { rows } = await base.query<Ligne>(
    `select id, reference, canal, nom, email, telephone, societe, saisie_par_id,
            consentement_le, etat_email, statut, priorite, responsable_id
       from public.demandes where cle_envoi = $1`,
    [cle],
  );
  return rows;
}

type LigneHistorique = {
  id: string;
  type: string;
  auteur_type: string;
  auteur_id: string | null;
  ancienne_valeur: string | null;
  nouvelle_valeur: string | null;
  cree_le: Date;
};

async function historique(demandeId: string): Promise<LigneHistorique[]> {
  const { rows } = await base.query<LigneHistorique>(
    `select id::text, type, auteur_type, auteur_id, ancienne_valeur, nouvelle_valeur, cree_le
       from public.historique where demande_id = $1 order by id`,
    [demandeId],
  );
  return rows;
}

function numero(reference: string): number {
  return Number(reference.split("-")[2]);
}

describe("saisir_demande — cas de la matrice", () => {
  it("téléphone sans email : référence, canal Téléphone, saisie_par_id, sans_email, historique", async () => {
    const p = parametres({ p_nom: `  ${PREFIXE} M. Lambert  `, p_societe: "  " });
    const { data, error } = await saisir(sessionNadia, p);
    expect(error).toBeNull();
    expect(data).toMatchObject({ nouvelle: true, etat_email: "sans_email", objet: p.p_objet });
    expect(data.reference).toMatch(/^NOVA-\d{4}-\d{4,}$/);
    expect(data).not.toHaveProperty("jeton");

    const [ligne] = await demandeParCle(p.p_cle_envoi!);
    expect(ligne).toMatchObject({
      id: data.id,
      reference: data.reference,
      canal: "telephone",
      nom: `${PREFIXE} M. Lambert`,
      email: null,
      telephone: "06 12 34 56 78",
      societe: null,
      saisie_par_id: nadia.id,
      consentement_le: null,
      etat_email: "sans_email",
      statut: "nouvelle",
      priorite: "normale",
      responsable_id: null,
    });

    const lignes = await historique(ligne.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      type: "creation",
      auteur_type: "membre",
      auteur_id: nadia.id,
      ancienne_valeur: null,
      nouvelle_valeur: "telephone",
    });
    // Phrase affichée : « Saisie par [nom] (téléphone) ».
    const phrase = phraseLigneHistorique(
      {
        id: lignes[0].id,
        creeLe: lignes[0].cree_le.toISOString(),
        auteurType: "membre",
        auteurId: nadia.id,
        type: "creation",
        ancienneValeur: null,
        nouvelleValeur: "telephone",
      },
      { nomsMembres: { [nadia.id]: nadia.nom }, nomsCategories: {} },
    );
    expect(phrase).toBe(`Saisie par ${nadia.nom} (téléphone)`);
  });

  it("email renseigné : email en minuscules, état en_attente, historique (email)", async () => {
    const p = parametres({ p_canal: "email", p_email: "  M.Lambert@Example.COM ", p_telephone: null });
    const { data, error } = await saisir(sessionNadia, p);
    expect(error).toBeNull();
    expect(data).toMatchObject({ nouvelle: true, etat_email: "en_attente" });
    for (const cle of ["id", "objet", "cree_le", "nom_affiche", "email_contact"]) {
      expect(data, cle).toHaveProperty(cle);
    }

    const [ligne] = await demandeParCle(p.p_cle_envoi!);
    expect(ligne).toMatchObject({
      canal: "email",
      email: "m.lambert@example.com",
      telephone: null,
      etat_email: "en_attente",
    });
    expect((await historique(ligne.id))[0].nouvelle_valeur).toBe("email");
  });

  it("ni email ni téléphone : COORDONNEES_REQUISES, rien n'est créé", async () => {
    const p = parametres({ p_email: "  ", p_telephone: " " });
    const { error } = await saisir(sessionNadia, p);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("COORDONNEES_REQUISES");
    expect(await demandeParCle(p.p_cle_envoi!)).toEqual([]);
  });

  it("par appeler() : COORDONNEES_REQUISES traduit avec son message", async () => {
    expect(
      await appeler(sessionNadia, "saisir_demande", parametres({ p_telephone: null })),
    ).toEqual({
      ok: false,
      code: "COORDONNEES_REQUISES",
      message: "Indiquez au moins un email ou un téléphone.",
    });
  });

  it.each([null, "", "formulaire", "fax", "Telephone"])(
    "canal %j : DONNEES_INVALIDES, rien n'est créé",
    async (canal) => {
      const p = parametres({ p_canal: canal });
      const { error } = await saisir(sessionNadia, p);
      expect(error?.message).toBe("DONNEES_INVALIDES");
      expect(await demandeParCle(p.p_cle_envoi!)).toEqual([]);
    },
  );

  it.each<[string, Partial<Parametres>]>([
    ["nom vide", { p_nom: "   " }],
    ["nom trop long", { p_nom: `${PREFIXE} ${"a".repeat(150)}` }],
    ["email mal formé", { p_email: "lambert@exemple" }],
    ["email trop long", { p_email: `${"a".repeat(250)}@example.com` }],
    ["téléphone trop long", { p_telephone: "0".repeat(31) }],
    ["société trop longue", { p_societe: "s".repeat(151) }],
    ["objet vide", { p_objet: "" }],
    ["objet trop long", { p_objet: "o".repeat(151) }],
    ["description vide", { p_description: " \n " }],
    ["description trop longue", { p_description: "d".repeat(5001) }],
    ["clé absente", { p_cle_envoi: null }],
  ])("%s : DONNEES_INVALIDES", async (_cas, modifs) => {
    const { error } = await saisir(sessionNadia, parametres(modifs));
    expect(error?.message).toBe("DONNEES_INVALIDES");
  });

  it.each<[string, () => string | null]>([
    ["inactive", () => inactive.id],
    ["inconnue", () => randomUUID()],
    ["absente", () => null],
  ])("catégorie %s : CATEGORIE_INVALIDE", async (_cas, id) => {
    const p = parametres({ p_categorie_id: id() });
    const { error } = await saisir(sessionNadia, p);
    expect(error?.message).toBe("CATEGORIE_INVALIDE");
    expect(await demandeParCle(p.p_cle_envoi!)).toEqual([]);
  });

  it("second envoi : la réponse contient l'adresse email enregistrée", async () => {
    const p = parametres({ p_canal: "email", p_email: "Lambert@Example.com", p_telephone: null });
    const premier = await saisir(sessionNadia, p);
    expect(premier.error).toBeNull();
    expect(premier.data.email).toBe("lambert@example.com");
    // Formulaire rejoué avec une autre adresse : la réponse garde celle enregistrée.
    const second = await saisir(sessionNadia, { ...p, p_email: "autre@example.com" });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({
      nouvelle: false,
      id: premier.data.id,
      email: "lambert@example.com",
      etat_email: "en_attente",
    });
  });

  it("clé d'un dépôt public : jamais renvoyée au membre (erreur), dépôt inchangé", async () => {
    const cle = randomUUID();
    const { rows } = await base.query<{ r: { reference: string } }>(
      "select public.deposer_demande($1, $2, 'sophie@example.com', null, null, $3, 'Dépôt', 'Description.', true, $4) as r",
      [cle, `${PREFIXE} Sophie Garnier`, categorie.id, empreinteDeTest()],
    );
    const { data, error } = await saisir(sessionNadia, parametres({ p_cle_envoi: cle }));
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    const lignes = await demandeParCle(cle);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      reference: rows[0].r.reference,
      canal: "formulaire",
      saisie_par_id: null,
    });
  });

  it("double envoi (même cle_envoi) : une seule demande, même référence", async () => {
    const p = parametres();
    const premier = await saisir(sessionNadia, p);
    const second = await saisir(sessionNadia, p);
    expect(premier.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data.reference).toBe(premier.data.reference);
    expect(second.data).toMatchObject({ nouvelle: false, id: premier.data.id });
    expect(await demandeParCle(p.p_cle_envoi!)).toHaveLength(1);
    expect(await historique(premier.data.id)).toHaveLength(1);
  });

  it("double envoi simultané : une seule demande", async () => {
    const p = parametres();
    const resultats = await Promise.all([saisir(sessionNadia, p), saisir(sessionNadia, p)]);
    expect(resultats.map((r) => r.error)).toEqual([null, null]);
    expect(resultats[0].data.reference).toBe(resultats[1].data.reference);
    expect(await demandeParCle(p.p_cle_envoi!)).toHaveLength(1);
  });

  it("10 saisies de suite : toutes acceptées (pas d'anti-spam), références distinctes", async () => {
    const references: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { data, error } = await saisir(sessionNadia, parametres({ p_objet: `Appel ${i}` }));
      expect(error).toBeNull();
      references.push(data.reference);
    }
    expect(new Set(references).size).toBe(10);
    // Dix appels réseau à la suite : plus que les 5 s par défaut en CI.
  }, 20_000);
});

describe("saisir_demande — compteur partagé avec le dépôt public (AD-6)", () => {
  it("dépôt, saisie, dépôt dans une transaction : trois numéros consécutifs", async () => {
    // La ligne de l'année reste verrouillée jusqu'à la fin de la transaction :
    // aucun autre dépôt ne peut s'intercaler, les numéros se suivent.
    const deposer = () =>
      base.query<{ r: { reference: string } }>(
        "select public.deposer_demande($1, $2, 'sophie@example.com', null, null, $3, 'Dépôt', 'Description.', true, $4) as r",
        [randomUUID(), `${PREFIXE} Sophie Garnier`, categorie.id, empreinteDeTest()],
      );
    await base.query("begin");
    try {
      const avant = (await deposer()).rows[0].r.reference;
      await base.query("set local role authenticated");
      await base.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: nadia.id, role: "authenticated" }),
      ]);
      const p = parametres();
      const { rows } = await base.query<{ r: { reference: string } }>(
        `select public.saisir_demande($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`,
        [
          p.p_cle_envoi, p.p_canal, p.p_nom, p.p_email, p.p_telephone, p.p_societe,
          p.p_categorie_id, p.p_objet, p.p_description,
        ],
      );
      const saisie = rows[0].r.reference;
      await base.query("reset role");
      const apres = (await deposer()).rows[0].r.reference;
      await base.query("commit");

      expect(numero(saisie)).toBe(numero(avant) + 1);
      expect(numero(apres)).toBe(numero(saisie) + 1);
      expect(saisie.slice(0, 10)).toBe(avant.slice(0, 10));
    } catch (erreur) {
      await base.query("rollback").catch(() => {});
      throw erreur;
    }
  });
});

describe("saisir_demande — droits", () => {
  // Comptes désactivé et invité : session simulée dans une transaction
  // (rôle `authenticated` et `sub` du compte), comme PostgREST le fait,
  // sans connexion à Supabase Auth (limite d'appels, story 1.9).
  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ])("compte %s : DROIT_INSUFFISANT, rien n'est créé", async (_nom, compte) => {
    const p = parametres();
    await base.query("begin");
    let message: string | undefined;
    try {
      await base.query("set local role authenticated");
      await base.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: compte().id, role: "authenticated" }),
      ]);
      await base.query(
        "select public.saisir_demande($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [
          p.p_cle_envoi, p.p_canal, p.p_nom, p.p_email, p.p_telephone, p.p_societe,
          p.p_categorie_id, p.p_objet, p.p_description,
        ],
      );
    } catch (erreur) {
      message = (erreur as { message?: string }).message;
    } finally {
      await base.query("rollback");
    }
    expect(message).toBe("DROIT_INSUFFISANT");
    expect(await demandeParCle(p.p_cle_envoi!)).toEqual([]);
  });

  it.each([
    ["visiteur (anon)", () => clientPubliableTest()],
    ["clé secrète (service_role)", () => clientServiceTest()],
  ])("%s : droit refusé", async (_nom, client) => {
    const p = parametres();
    const { error } = await saisir(client(), p);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
    expect(await demandeParCle(p.p_cle_envoi!)).toEqual([]);
  });
});
