import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { compterDemandesAvec, lireDemandesAvec } from "@/lib/demandes";
import type { Filtres } from "@/lib/filtres";
import {
  CARTES,
  FILTRES_A_PRENDRE_EN_CHARGE,
  FILTRES_MES_DEMANDES_EN_COURS,
  adresseCarte,
  lireCompteurMenuAvec,
  lireTableauDeBordAvec,
} from "@/lib/tableau-de-bord";
import {
  clientConnecte,
  clientPubliableTest,
  creerCompteTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";
import {
  creerDemandeTest,
  supprimerDemandesTest,
  type DemandeTest,
  type OptionsDemande,
} from "@/tests/outils/demandes";

// Story 2.8 — tableau de bord et compteur du menu, contre la base de
// développement : chaque chiffre est le comptage de la vue `demandes_liste`
// à travers lib/filtres.ts, donc exactement le total de la liste ouverte par
// la carte ; adresses des cartes ; « Mes demandes en cours » (5 dernières,
// à mon nom) ; mêmes chiffres pour un collaborateur et un administrateur ;
// échec de lecture.
// Base partagée : jamais de nombre exact absolu. Les nombres exacts portent
// sur nos demandes, isolées par la recherche du préfixe `TEST-2.8-xxxxxxxx`
// (même chemin que la liste) ; sans recherche, comptage et total de la liste
// sont lus ensemble et comparés (relus si une autre exécution a modifié la
// base entre-temps).

const PREFIXE = `TEST-2.8-${randomUUID().slice(0, 8)}`;

const comptes: CompteTest[] = [];
let karim: CompteTest; // collaborateur
let claire: CompteTest; // administratrice
let nadia: CompteTest; // collaboratrice, responsable d'une demande (jamais connectée)
let membre: SupabaseClient;
let admin: SupabaseClient;
let base: Client;

const mesEnCours: DemandeTest[] = []; // 6 demandes En cours de Karim, de la plus récente à la plus ancienne

function creer(options: OptionsDemande): Promise<DemandeTest> {
  return creerDemandeTest(base, PREFIXE, { decalage: "-12 years", ...options });
}

beforeAll(async () => {
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.8" });
  comptes.push(karim);
  claire = await creerCompteTest({ role: "administrateur", prenom: "Claire", etiquette: "2.8" });
  comptes.push(claire);
  nadia = await creerCompteTest({ role: "collaborateur", prenom: "Nadia", etiquette: "2.8" });
  comptes.push(nadia);
  membre = await clientConnecte(karim);
  admin = await clientConnecte(claire);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();

  // À prendre en charge : 2 (dont 1 Haute) ; Nouvelle : 3 (une attribuée
  // directement en base à Claire, cas impossible par l'application mais qui
  // distingue « Nouvelle » d'« À prendre en charge »).
  await creer({ statut: "nouvelle", priorite: "haute" });
  await creer({ statut: "nouvelle", priorite: "normale" });
  await creer({ statut: "nouvelle", priorite: "basse", responsableId: claire.id });
  // En cours : 6 de Karim (dont 1 Haute), 1 de Nadia (Haute). Claire n'a
  // aucune demande En cours à son nom.
  for (let i = 0; i < 6; i++) {
    mesEnCours.push(
      await creer({
        statut: "en_cours",
        priorite: i === 0 ? "haute" : "normale",
        responsableId: karim.id,
        objet: `En cours ${i}`,
        decalage: `-${10 + i} days`,
      }),
    );
  }
  await creer({ statut: "en_cours", priorite: "haute", responsableId: nadia.id });
  // Traitée : 2 (dont 1 Haute, jamais comptée dans « non traitées »).
  await creer({ statut: "traitee", priorite: "haute", responsableId: karim.id });
  await creer({ statut: "traitee", priorite: "normale", responsableId: claire.id });
}, 120_000);

afterAll(async () => {
  if (base) {
    await supprimerDemandesTest(base, PREFIXE);
    await base.end().catch(() => {});
  }
  await membre?.auth.signOut({ scope: "local" }).catch(() => {});
  await admin?.auth.signOut({ scope: "local" }).catch(() => {});
  await supprimerComptesTest(comptes);
}, 60_000);

/** Chiffres attendus sur nos demandes, carte par carte. */
const ATTENDUS: Record<(typeof CARTES)[number]["cle"], number> = {
  a_prendre: 2,
  haute_non_traitees: 3,
  nouvelle: 3,
  en_cours: 7,
  traitee: 2,
};

async function compter(client: SupabaseClient, filtres: Filtres): Promise<number> {
  const resultat = await compterDemandesAvec(client, filtres);
  expect(resultat.ok, JSON.stringify(filtres)).toBe(true);
  return resultat.ok ? resultat.donnees : -1;
}

async function totalListe(client: SupabaseClient, filtres: Filtres): Promise<number> {
  const resultat = await lireDemandesAvec(client, 1, filtres);
  expect(resultat.ok, JSON.stringify(filtres)).toBe(true);
  return resultat.ok ? resultat.donnees.total : -1;
}

describe("définition des cartes", () => {
  it("5 cartes, dans l'ordre, avec les filtres de la liste", () => {
    expect(CARTES.map((c) => [c.libelle, c.filtres, c.miseEnAvant])).toEqual([
      ["À prendre en charge", { statut: "nouvelle", responsable: "aucun" }, true],
      ["Priorité Haute non traitées", { statut: "non_traitees", priorite: "haute" }, false],
      ["Nouvelle", { statut: "nouvelle" }, false],
      ["En cours", { statut: "en_cours" }, false],
      ["Traitée", { statut: "traitee" }, false],
    ]);
    expect(FILTRES_A_PRENDRE_EN_CHARGE).toBe(CARTES[0].filtres);
  });

  it("adresses des cartes : la liste filtrée, page 1", () => {
    expect(CARTES.map((c) => adresseCarte(c.filtres))).toEqual([
      "/equipe/demandes?statut=nouvelle&responsable=aucun",
      "/equipe/demandes?statut=non_traitees&priorite=haute",
      "/equipe/demandes?statut=nouvelle",
      "/equipe/demandes?statut=en_cours",
      "/equipe/demandes?statut=traitee",
    ]);
    expect(adresseCarte(FILTRES_MES_DEMANDES_EN_COURS)).toBe(
      "/equipe/demandes?statut=en_cours&responsable=moi",
    );
  });

  it("aucune condition écrite à la main : le comptage passe par conditionsDesFiltres", () => {
    const source = readFileSync("lib/tableau-de-bord.ts", "utf8");
    // Aucune requête ni condition ici : seulement compterDemandesAvec et lireDemandesAvec.
    expect(source).not.toMatch(/\.(from|rpc|eq|in|is|filter|match|or)\(/);
  });
});

describe("chiffres = total de la liste filtrée", () => {
  it.each(CARTES.map((c) => [c.libelle, c] as const))(
    "%s : nombre exact sur nos demandes, égal au total de la liste",
    async (_libelle, carte) => {
      const filtres = { q: PREFIXE, ...carte.filtres };
      const [nombre, total] = await Promise.all([
        compter(membre, filtres),
        totalListe(membre, filtres),
      ]);
      expect(nombre).toBe(ATTENDUS[carte.cle]);
      expect(total).toBe(nombre);
    },
  );

  it.each(CARTES.map((c) => [c.libelle, c] as const))(
    "%s : sur toute la base, comptage = total de la liste",
    async (_libelle, carte) => {
      // Autres exécutions en parallèle : relu tant que les deux lectures
      // simultanées diffèrent (5 essais au plus).
      let ecart = "";
      for (let essai = 0; essai < 5; essai++) {
        const [nombre, total] = await Promise.all([
          compter(membre, carte.filtres),
          totalListe(membre, carte.filtres),
        ]);
        if (nombre === total) return;
        ecart = `${nombre} ≠ ${total}`;
      }
      expect.fail(`comptage et liste diffèrent : ${ecart}`);
    },
  );

  it("collaborateur et administrateur lisent les mêmes chiffres (tout le monde voit tout)", async () => {
    const lire = (client: SupabaseClient) =>
      Promise.all(CARTES.map((c) => compter(client, { q: PREFIXE, ...c.filtres })));
    const [collaborateur, administrateur] = await Promise.all([lire(membre), lire(admin)]);
    expect(collaborateur).toEqual(CARTES.map((c) => ATTENDUS[c.cle]));
    expect(administrateur).toEqual(collaborateur);
  });

  it("le compteur du menu = la carte « À prendre en charge »", async () => {
    for (let essai = 0; essai < 5; essai++) {
      const [compteur, carte] = await Promise.all([
        lireCompteurMenuAvec(membre),
        compter(membre, CARTES[0].filtres),
      ]);
      expect(compteur).not.toBeNull();
      if (compteur === carte) return;
    }
    expect.fail("compteur du menu et carte diffèrent");
  });

  it("prise en charge : la carte « À prendre en charge » perd exactement 1", async () => {
    const demande = await creer({ statut: "nouvelle", priorite: "normale" });
    const filtres = { q: PREFIXE, ...FILTRES_A_PRENDRE_EN_CHARGE };
    const avant = await compter(membre, filtres);
    const { error } = await membre.rpc("prendre_en_charge", { p_demande_id: demande.id });
    expect(error).toBeNull();
    expect(await compter(membre, filtres)).toBe(avant - 1);
    // Remise en état pour les autres tests de ce fichier.
    await base.query("delete from public.demandes where id = $1", [demande.id]);
  });

  it("sans session (rôle anon) : aucun chiffre lisible, 0", async () => {
    const anonyme = clientPubliableTest();
    const resultat = await compterDemandesAvec(anonyme, { statut: "nouvelle" });
    // RLS : la vue ne renvoie aucune ligne (une lecture refusée compte aussi pour 0 affiché).
    expect(resultat.ok ? resultat.donnees : 0).toBe(0);
  });
});

describe("Mes demandes en cours", () => {
  it("les 5 dernières En cours à mon nom, des plus récentes aux plus anciennes", async () => {
    const resultat = await lireTableauDeBordAvec(membre);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const { cartes, mesDemandes, adresseMesDemandes, vide } = resultat.donnees;
    expect(mesDemandes.map((l) => l.reference)).toEqual(
      mesEnCours.slice(0, 5).map((d) => d.reference),
    );
    expect(mesDemandes.every((l) => l.statut === "en_cours")).toBe(true);
    expect(adresseMesDemandes).toBe("/equipe/demandes?statut=en_cours&responsable=moi");
    expect(cartes.map((c) => c.libelle)).toEqual(CARTES.map((c) => c.libelle));
    expect(cartes.map((c) => c.adresse)).toEqual(CARTES.map((c) => adresseCarte(c.filtres)));
    // Nos demandes existent : jamais l'état vide.
    expect(vide).toBe(false);
  });

  it("aucune demande à mon nom : liste vide, cartes présentes", async () => {
    // Claire n'a aucune demande En cours (une Nouvelle et une Traitée à son nom).
    const resultat = await lireTableauDeBordAvec(admin);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.mesDemandes).toEqual([]);
    expect(resultat.donnees.cartes).toHaveLength(5);
    expect(resultat.donnees.vide).toBe(false);
  });
});

describe("état vide, calculé à partir des comptages", () => {
  /** Client simulé : chaque comptage renvoie le nombre de son statut, aucune ligne. */
  function clientAvecComptes(parStatut: Record<string, number>): SupabaseClient {
    function requete() {
      let statut: string | null = null;
      const r = {
        select: () => r,
        eq: (colonne: string, valeur: string) => {
          if (colonne === "statut") statut = valeur;
          return r;
        },
        in: () => r,
        is: () => r,
        order: () => r,
        range: () => r,
        then: (resoudre: (v: unknown) => unknown, rejeter: (e: unknown) => unknown) =>
          Promise.resolve({
            data: [],
            count: statut ? (parStatut[statut] ?? 0) : 0,
            error: null,
          }).then(resoudre, rejeter),
      };
      return r;
    }
    return {
      from: () => requete(),
      rpc: () => requete(),
      auth: {
        getClaims: async () => ({ data: { claims: { sub: karim.id } }, error: null }),
      },
    } as unknown as SupabaseClient;
  }

  it("tous les comptages à 0 : vide", async () => {
    const resultat = await lireTableauDeBordAvec(clientAvecComptes({}));
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.vide).toBe(true);
    expect(resultat.donnees.cartes.map((c) => c.nombre)).toEqual([0, 0, 0, 0, 0]);
  });

  it("seulement des demandes Traitées : pas vide", async () => {
    const resultat = await lireTableauDeBordAvec(clientAvecComptes({ traitee: 4 }));
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.vide).toBe(false);
    expect(resultat.donnees.cartes.find((c) => c.cle === "traitee")?.nombre).toBe(4);
  });
});

describe("échec de lecture", () => {
  /** Client dont toute lecture échoue (réseau ou base). */
  function clientEnEchec(mode: "exception" | "erreur"): SupabaseClient {
    const requete = {
      select: () => requete,
      eq: () => requete,
      in: () => requete,
      is: () => requete,
      order: () => requete,
      range: () => requete,
      then: (resoudre: (v: unknown) => unknown, rejeter: (e: unknown) => unknown) =>
        mode === "exception"
          ? Promise.reject(new Error("réseau")).then(resoudre, rejeter)
          : Promise.resolve({ data: null, count: null, error: { code: "57014" } }).then(
              resoudre,
              rejeter,
            ),
    };
    return {
      from: () => requete,
      rpc: () => requete,
      auth: {
        getClaims: async () => ({ data: { claims: { sub: karim.id } }, error: null }),
      },
    } as unknown as SupabaseClient;
  }

  it.each(["exception", "erreur"] as const)(
    "%s : tableau de bord en échec, compteur du menu masqué (null)",
    async (mode) => {
      const client = clientEnEchec(mode);
      const tableau = await lireTableauDeBordAvec(client);
      expect(tableau.ok).toBe(false);
      expect(await lireCompteurMenuAvec(client)).toBeNull();
      const comptage = await compterDemandesAvec(client, { statut: "nouvelle" });
      expect(comptage.ok).toBe(false);
    },
  );

  it("« Mes demandes » sans membre connecté : échec, jamais toutes les demandes", async () => {
    const anonyme = clientPubliableTest();
    const resultat = await compterDemandesAvec(anonyme, FILTRES_MES_DEMANDES_EN_COURS);
    expect(resultat.ok).toBe(false);
    expect((await lireTableauDeBordAvec(anonyme)).ok).toBe(false);
  });
});
