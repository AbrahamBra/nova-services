import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { lireDemandesAvec, lireLigne } from "@/lib/demandes";
import { nombreDePages, TAILLE_PAGE } from "@/lib/filtres";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import { creerDemandeTest, supprimerDemandesTest, type DemandeTest } from "@/tests/outils/demandes";

// Story 1.5 — lecture des demandes par l'équipe (migration 20261103000007) :
// RLS de lecture, droits par colonne et vue `demandes_liste`
// (security_invoker). La base de développement est partagée : ces tests ne
// dépendent pas du nombre de demandes, ils créent les leurs (`TEST-1.5-…`).

const PREFIXE = `TEST-1.5-${randomUUID().slice(0, 8)}`;
const PERMISSION_REFUSEE = "42501";

const comptes: CompteTest[] = [];
let collaborateur: CompteTest;
let desactive: CompteTest;
let invite: CompteTest;
let membre: SupabaseClient;

let base: Client;
let ancienne: DemandeTest;
let recente: DemandeTest;

beforeAll(async () => {
  collaborateur = await creerCompteTest({ role: "collaborateur", etiquette: "1.5" });
  comptes.push(collaborateur);
  desactive = await creerCompteTest({ etat: "desactive", etiquette: "1.5" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", etiquette: "1.5" });
  comptes.push(invite);
  membre = await clientConnecte(collaborateur);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  // Datées dans le futur : toujours en tête de liste, quel que soit le contenu de la base.
  ancienne = await creerDemandeTest(base, PREFIXE, {
    decalage: "1 day",
    statut: "en_cours",
    priorite: "haute",
    responsableId: collaborateur.id,
  });
  recente = await creerDemandeTest(base, PREFIXE, { decalage: "1 day 1 minute", societe: null });
}, 60_000);

afterAll(async () => {
  if (base) {
    await supprimerDemandesTest(base, PREFIXE);
    await base.end().catch(() => {});
  }
  await membre?.auth.signOut({ scope: "local" }).catch(() => {});
  await supprimerComptesTest(comptes);
}, 60_000);

describe("vue demandes_liste — membre actif", () => {
  it("lit ses colonnes, avec le nom de la catégorie et du responsable", async () => {
    const { data, error } = await membre
      .from("demandes_liste")
      .select("reference, nom, societe, objet, categorie_nom, canal, statut, priorite, responsable_nom")
      .in("reference", [ancienne.reference, recente.reference])
      .order("cree_le", { ascending: false });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    const [premiere, seconde] = data!;
    expect(premiere.reference).toBe(recente.reference);
    expect(premiere.responsable_nom).toBeNull();
    expect(premiere.societe).toBeNull();
    expect(seconde).toMatchObject({
      reference: ancienne.reference,
      statut: "en_cours",
      priorite: "haute",
      canal: "formulaire",
      responsable_nom: collaborateur.nom,
    });
    expect(typeof seconde.categorie_nom).toBe("string");
  });

  it("lireDemandesAvec : plus récentes d'abord, 25 par page, total cohérent", async () => {
    // Base partagée : d'autres processus peuvent ajouter des demandes en tête
    // de liste. On ne vérifie donc ici que la forme de la page et l'ordre ;
    // les demandes de cette exécution sont vérifiées par leur référence.
    const resultat = await lireDemandesAvec(membre, 1);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const { lignes, total, page, taillePage } = resultat.donnees;
    expect(page).toBe(1);
    expect(taillePage).toBe(TAILLE_PAGE);
    expect(lignes.length).toBe(Math.min(total, TAILLE_PAGE));
    expect(total).toBeGreaterThanOrEqual(2);

    // Dates décroissantes sur toute la page.
    const dates = lignes.map((l) => Date.parse(l.creeLe));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("lireDemandesAvec : une page au-delà de la fin donne la dernière page", async () => {
    const resultat = await lireDemandesAvec(membre, 1_000_000);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const { page, total, lignes } = resultat.donnees;
    expect(page).toBe(nombreDePages(total));
    expect(lignes.length).toBeGreaterThan(0);
  });

  it("lit seulement id, nom et etat dans membres", async () => {
    const { data, error } = await membre
      .from("membres")
      .select("id, nom, etat")
      .eq("id", collaborateur.id);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: collaborateur.id, nom: collaborateur.nom, etat: "actif" }]);

    for (const colonne of ["email", "role", "cree_le", "*"]) {
      const { error: refus } = await membre.from("membres").select(colonne).limit(1);
      expect(refus?.code, `membres.${colonne}`).toBe(PERMISSION_REFUSEE);
    }
  });

  it("lit id, nom et actif dans categories, rien d'autre", async () => {
    const { data, error } = await membre.from("categories").select("id, nom, actif");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const { error: refus } = await membre.from("categories").select("ordre").limit(1);
    expect(refus?.code).toBe(PERMISSION_REFUSEE);
  });

  it("ne lit jamais jeton_confirmation ni cle_envoi", async () => {
    for (const colonne of ["jeton_confirmation", "cle_envoi", "*"]) {
      const { error } = await membre.from("demandes").select(colonne).limit(1);
      expect(error?.code, `demandes.${colonne}`).toBe(PERMISSION_REFUSEE);
    }
    const { data, error } = await membre
      .from("demandes")
      .select("id, reference, email, description")
      .eq("reference", ancienne.reference);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("n'écrit rien (aucun droit d'écriture)", async () => {
    const { error } = await membre
      .from("demandes")
      .update({ statut: "traitee" })
      .eq("reference", ancienne.reference);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
  });
});

describe("lireLigne — ligne mal formée", () => {
  const valide = {
    id: "id-1",
    reference: "NOVA-2026-0001",
    cree_le: "2026-11-03T08:12:00Z",
    nom: "Sophie Garnier",
    societe: null,
    objet: "Objet",
    categorie_nom: "Autre",
    canal: "formulaire",
    statut: "nouvelle",
    priorite: "normale",
    responsable_nom: null,
  };

  it("garde une ligne valide", () => {
    expect(lireLigne(valide)).toMatchObject({ reference: "NOVA-2026-0001", creeLe: valide.cree_le });
  });

  it("écarte un code inconnu ou une date illisible, sans journaliser de donnée personnelle", () => {
    const journal: string[] = [];
    const origine = console.error;
    console.error = (message: unknown) => journal.push(String(message));
    try {
      expect(lireLigne({ ...valide, statut: "archivee" })).toBeNull();
      expect(lireLigne({ ...valide, cree_le: "pas une date" })).toBeNull();
      expect(lireLigne(null)).toBeNull();
    } finally {
      console.error = origine;
    }
    expect(journal).toEqual([
      "[demandes] ligne écartée : reference=NOVA-2026-0001 champ=statut",
      "[demandes] ligne écartée : reference=NOVA-2026-0001 champ=cree_le",
      "[demandes] ligne écartée : forme inattendue",
    ]);
    expect(journal.join(" ")).not.toContain("Sophie");
  });
});

describe("vue demandes_liste — sans membre actif", () => {
  it("un compte désactivé ou invité ne lit aucune ligne", async () => {
    for (const compte of [desactive, invite]) {
      const client = await clientConnecte(compte);
      try {
        for (const [table, colonnes] of [
          ["demandes_liste", "reference"],
          ["demandes", "reference"],
          ["membres", "id, nom, etat"],
          ["categories", "id, nom, actif"],
        ] as const) {
          const { data, error } = await client.from(table).select(colonnes).limit(5);
          expect(error, `${compte.etat} ${table}`).toBeNull();
          expect(data, `${compte.etat} ${table}`).toEqual([]);
        }
        const resultat = await lireDemandesAvec(client, 1);
        expect(resultat).toEqual({
          ok: true,
          donnees: { lignes: [], total: 0, page: 1, taillePage: TAILLE_PAGE },
        });
      } finally {
        await client.auth.signOut({ scope: "local" });
      }
    }
  });

  it("le visiteur (clé publiable sans session) est refusé partout", async () => {
    const visiteur = clientPubliableTest();
    for (const table of ["demandes_liste", "demandes", "membres", "categories"]) {
      const { error } = await visiteur.from(table).select("id").limit(1);
      expect(error?.code, table).toBe(PERMISSION_REFUSEE);
    }
  });

  it("la clé secrète n'a aucun droit sur la vue", async () => {
    const { error } = await clientServiceTest().from("demandes_liste").select("id").limit(1);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
  });

  it("la vue applique RLS (security_invoker), sans vue matérialisée", async () => {
    const { rows } = await base.query<{ options: string[] | null; relkind: string }>(
      "select c.reloptions as options, c.relkind from pg_class c where c.oid = 'public.demandes_liste'::regclass",
    );
    expect(rows[0].relkind).toBe("v");
    expect(rows[0].options).toContain("security_invoker=true");
  });
});
