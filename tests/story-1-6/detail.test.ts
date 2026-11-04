import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { texteLigneHistorique } from "@/components/nova/historique";
import { lireDetailAvec, lireLigneHistorique } from "@/lib/detail-demande";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 1.6 — lecture du détail d'une demande et de son historique
// (migration 20261103000008) : RLS et droits par colonne de `historique`,
// lecture avec la session, colonnes secrètes jamais lues, référence inconnue
// ou mal formée → introuvable. Base partagée : données propres `TEST-1.6-…`.

const PREFIXE = `TEST-1.6-${randomUUID().slice(0, 8)}`;
const PERMISSION_REFUSEE = "42501";

const comptes: CompteTest[] = [];
let collaborateur: CompteTest;
let desactive: CompteTest;
let invite: CompteTest;
let seconde: CompteTest; // ni responsable ni auteur : seulement citée par une valeur
let membre: SupabaseClient;

let base: Client;
let demande: DemandeTest;
let attribuee: DemandeTest; // attribution et changement de catégorie
let valeurIllisible: DemandeTest; // valeur « membre » qui n'est pas un uuid
let ancienneCategorie: { id: string; nom: string };

beforeAll(async () => {
  collaborateur = await creerCompteTest({ role: "collaborateur", etiquette: "1.6" });
  comptes.push(collaborateur);
  desactive = await creerCompteTest({ etat: "desactive", etiquette: "1.6" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", etiquette: "1.6" });
  comptes.push(invite);
  seconde = await creerCompteTest({ role: "collaborateur", prenom: "Nadia", etiquette: "1.6" });
  comptes.push(seconde);
  membre = await clientConnecte(collaborateur);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  demande = await creerDemandeTest(base, PREFIXE, {
    statut: "en_cours",
    priorite: "haute",
    responsableId: collaborateur.id,
  });
  await base.query(
    `update public.demandes
        set telephone = '06 12 34 56 78',
            description = E'Ligne 1\n<script>alert(1)</script>\nLigne 3',
            etat_email = 'non_envoye_demo'
      where id = $1`,
    [demande.id],
  );
  // Suite de l'historique, écrite par le membre (après la création).
  await base.query(
    `insert into public.historique
       (demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le)
     values
       ($1, 'membre', $2::uuid, 'prise_en_charge', 'nouvelle', 'en_cours', now() + interval '1 minute'),
       ($1, 'membre', $2::uuid, 'changement_priorite', 'normale', 'haute', now() + interval '2 minutes')`,
    [demande.id, collaborateur.id],
  );

  // Attribuée à un second membre, catégorie changée depuis une autre catégorie.
  attribuee = await creerDemandeTest(base, PREFIXE, { statut: "en_cours" });
  const { rows: categories } = await base.query<{ id: string; nom: string }>(
    `select c.id, c.nom from public.categories c
      where c.id <> (select categorie_id from public.demandes where id = $1)
      order by c.ordre limit 1`,
    [attribuee.id],
  );
  ancienneCategorie = categories[0];
  await base.query(
    `insert into public.historique
       (demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le)
     values
       ($1, 'membre', $2::uuid, 'attribution', null, $3::text, now() + interval '1 minute'),
       ($1, 'membre', $2::uuid, 'changement_categorie', $4::text,
        (select categorie_id::text from public.demandes where id = $1), now() + interval '2 minutes')`,
    [attribuee.id, collaborateur.id, seconde.id, ancienneCategorie.id],
  );

  // Valeur « membre » illisible (pas un uuid) : repli, jamais d'échec.
  valeurIllisible = await creerDemandeTest(base, PREFIXE);
  await base.query(
    `insert into public.historique
       (demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le)
     values ($1, 'membre', $2::uuid, 'attribution', null, 'pas-un-uuid', now() + interval '1 minute')`,
    [valeurIllisible.id, collaborateur.id],
  );
}, 60_000);

afterAll(async () => {
  // Demandes d'abord : l'historique (qui cite les comptes) part en cascade.
  // Si leur nettoyage échoue, les comptes sont gardés (clés étrangères de
  // l'historique) : rien n'est laissé à moitié supprimé.
  let demandesNettoyees = !base;
  try {
    if (base) {
      await supprimerDemandesTest(base, PREFIXE);
      demandesNettoyees = true;
    }
  } finally {
    await base?.end().catch(() => {});
    await membre?.auth.signOut({ scope: "local" }).catch(() => {});
    if (demandesNettoyees) {
      await supprimerComptesTest(comptes);
    } else {
      console.error(`Demandes ${PREFIXE} non nettoyées : comptes de test conservés.`);
    }
  }
}, 60_000);

describe("historique — membre actif", () => {
  it("lit toutes les colonnes de l'historique de la demande", async () => {
    const { data, error } = await membre
      .from("historique")
      .select("id, demande_id, auteur_type, auteur_id, type, ancienne_valeur, nouvelle_valeur, cree_le")
      .eq("demande_id", demande.id)
      .order("cree_le", { ascending: true })
      .order("id", { ascending: true });
    expect(error).toBeNull();
    expect(data!.map((l) => l.type)).toEqual([
      "creation",
      "prise_en_charge",
      "changement_priorite",
    ]);
    expect(data![0]).toMatchObject({ auteur_type: "demandeur", auteur_id: null, nouvelle_valeur: "formulaire" });
  });

  it("n'écrit rien dans l'historique", async () => {
    const { error } = await membre.from("historique").insert({
      demande_id: demande.id,
      auteur_type: "demandeur",
      type: "note_ajoutee",
    });
    expect(error?.code).toBe(PERMISSION_REFUSEE);
  });
});

describe("lireDetailAvec — membre actif", () => {
  it("lit la demande telle que saisie, son historique et les noms", async () => {
    const resultat = await lireDetailAvec(membre, demande.reference);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok || resultat.donnees === null) throw new Error("détail attendu");
    const d = resultat.donnees;
    expect(d).toMatchObject({
      reference: demande.reference,
      objet: demande.objet,
      nom: demande.nom,
      societe: "Atelier Garnier",
      email: "sophie.garnier@example.com",
      telephone: "06 12 34 56 78",
      description: "Ligne 1\n<script>alert(1)</script>\nLigne 3",
      canal: "formulaire",
      statut: "en_cours",
      priorite: "haute",
      etatEmail: "non_envoye_demo",
      responsableId: collaborateur.id,
    });
    expect(d.historique.map((l) => l.type)).toEqual([
      "creation",
      "prise_en_charge",
      "changement_priorite",
    ]);
    expect(d.nomsMembres[collaborateur.id]).toBe(collaborateur.nom);
    expect(typeof d.nomsCategories[d.categorieId]).toBe("string");
    // Jamais les colonnes secrètes.
    expect(d).not.toHaveProperty("jeton_confirmation");
    expect(d).not.toHaveProperty("cle_envoi");
    expect(JSON.stringify(d)).not.toMatch(/jeton|cle_envoi/);
  });

  it("attribution à un second membre et changement de catégorie : noms résolus", async () => {
    const resultat = await lireDetailAvec(membre, attribuee.reference);
    if (!resultat.ok || resultat.donnees === null) throw new Error("détail attendu");
    const d = resultat.donnees;
    expect(d.historique.map((l) => l.type)).toEqual(["creation", "attribution", "changement_categorie"]);
    expect(d.nomsMembres[seconde.id]).toBe(seconde.nom);
    expect(d.nomsCategories[ancienneCategorie.id]).toBe(ancienneCategorie.nom);
    expect(typeof d.nomsCategories[d.categorieId]).toBe("string");
    expect(d.categorieId).not.toBe(ancienneCategorie.id);
    expect(texteLigneHistorique(d.historique[1], d).action).toBe(`a attribué la demande à ${seconde.nom}`);
    expect(texteLigneHistorique(d.historique[2], d).action).toBe(
      `a changé la catégorie : ${ancienneCategorie.nom} → ${d.nomsCategories[d.categorieId]}`,
    );
  });

  it("valeur « membre » qui n'est pas un uuid : lecture réussie, repli « Membre de l'équipe »", async () => {
    const resultat = await lireDetailAvec(membre, valeurIllisible.reference);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok || resultat.donnees === null) throw new Error("détail attendu");
    const d = resultat.donnees;
    expect(d.lignesIllisibles).toBe(0);
    expect(texteLigneHistorique(d.historique[1], d).action).toBe(
      "a attribué la demande à Membre de l'équipe",
    );
  });

  it("référence inconnue ou mal formée : introuvable, sans erreur", async () => {
    for (const reference of ["NOVA-2026-999999", "abc", "NOVA-2026-12", "", "NOVA-2026-0001' or 1=1"]) {
      expect(await lireDetailAvec(membre, reference), reference).toEqual({ ok: true, donnees: null });
    }
  });

  it("les colonnes secrètes de demandes restent refusées", async () => {
    for (const colonne of ["jeton_confirmation", "cle_envoi"]) {
      const { error } = await membre.from("demandes").select(colonne).eq("id", demande.id);
      expect(error?.code, colonne).toBe(PERMISSION_REFUSEE);
    }
  });
});

describe("historique — sans membre actif", () => {
  it.each([
    ["désactivé", () => desactive],
    ["invité", () => invite],
  ] as const)("un compte %s ne lit ni la demande ni son historique", async (_etat, compte) => {
    const client = await clientConnecte(compte());
    try {
      const { data, error } = await client
        .from("historique")
        .select("id")
        .eq("demande_id", demande.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await lireDetailAvec(client, demande.reference)).toEqual({ ok: true, donnees: null });
    } finally {
      await client.auth.signOut({ scope: "local" });
    }
  });

  it("le visiteur et la clé secrète sont refusés", async () => {
    for (const client of [clientPubliableTest(), clientServiceTest()]) {
      const { error } = await client.from("historique").select("id").limit(1);
      expect(error?.code).toBe(PERMISSION_REFUSEE);
    }
  });
});

describe("lireLigneHistorique — ligne mal formée", () => {
  const valide = {
    id: 12,
    auteur_type: "demandeur",
    auteur_id: null,
    type: "creation",
    ancienne_valeur: null,
    nouvelle_valeur: "formulaire",
    cree_le: "2026-11-03T07:47:00Z",
  };

  it("garde une ligne valide (identifiant numérique converti en texte)", () => {
    expect(lireLigneHistorique(valide)).toMatchObject({ id: "12", type: "creation" });
  });

  it("écarte un type inconnu ou une date illisible", () => {
    const journal: string[] = [];
    const origine = console.error;
    console.error = (message: unknown) => journal.push(String(message));
    try {
      expect(lireLigneHistorique({ ...valide, type: "suppression" })).toBeNull();
      expect(lireLigneHistorique({ ...valide, cree_le: "hier" })).toBeNull();
    } finally {
      console.error = origine;
    }
    expect(journal).toEqual([
      "[detail] ligne d'historique écartée : id=12 champ=type",
      "[detail] ligne d'historique écartée : id=12 champ=cree_le",
    ]);
  });
});
