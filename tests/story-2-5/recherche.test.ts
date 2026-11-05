import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { lireDemandesAvec } from "@/lib/demandes";
import { normaliserRecherche, type Filtres } from "@/lib/filtres";
import { lireOptionsFiltresAvec } from "@/lib/options-filtres";
import {
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
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

// Story 2.5 — recherche et filtres, contre la base de développement
// (migration 20261103000018) : normalisation, colonne `recherche` tenue à
// jour par la base, recherche partielle sans majuscules ni accents,
// caractères spéciaux, chaque filtre et leurs combinaisons, droits.
// Base partagée : les demandes de cette exécution portent un préfixe unique
// (`TEST-2.5-xxxxxxxx`) dans le nom du demandeur, donc dans la colonne de
// recherche : chercher ce préfixe isole exactement nos demandes.

const PREFIXE = `TEST-2.5-${randomUUID().slice(0, 8)}`;
const PERMISSION_REFUSEE = "42501";

const comptes: CompteTest[] = [];
let karim: CompteTest;
let nadia: CompteTest;
let desactive: CompteTest;
let invite: CompteTest;
let membre: SupabaseClient;

let base: Client;
let categorie: { id: string; nom: string };

// Demandes de cette exécution.
let dupont: DemandeTest; // Jean Dupont, Nouvelle, Haute, sans responsable, formulaire
let dupontAidi: DemandeTest; // Samira Dupont-Aïdi, En cours, Haute, Karim, téléphone
let garnier: DemandeTest; // Sophie Garnier, Traitée, Haute, Nadia, email
let speciale: DemandeTest; // caractères spéciaux, Nouvelle, Basse, catégorie de test
let apostrophe: DemandeTest; // « l'été », En cours, Normale, Nadia
let toutes: DemandeTest[];

function creer(options: OptionsDemande): Promise<DemandeTest> {
  return creerDemandeTest(base, PREFIXE, { decalage: "-10 years", ...options });
}

beforeAll(async () => {
  karim = await creerCompteTest({ role: "collaborateur", prenom: "Karim", etiquette: "2.5" });
  comptes.push(karim);
  nadia = await creerCompteTest({ role: "collaborateur", prenom: "Nadia", etiquette: "2.5" });
  comptes.push(nadia);
  desactive = await creerCompteTest({ etat: "desactive", etiquette: "2.5" });
  comptes.push(desactive);
  invite = await creerCompteTest({ etat: "invite", etiquette: "2.5" });
  comptes.push(invite);
  membre = await clientConnecte(karim);

  base = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await base.connect();
  const { rows } = await base.query<{ id: string; nom: string }>(
    "insert into public.categories (nom, actif, ordre) values ($1, false, 999) returning id, nom",
    [`${PREFIXE} Catégorie`],
  );
  categorie = rows[0];

  dupont = await creer({
    nomDemandeur: "Jean Dupont",
    email: "jean.dupont@example.com",
    societe: "Menuiserie Lefèvre",
    objet: "Impression impossible",
    statut: "nouvelle",
    priorite: "haute",
  });
  dupontAidi = await creer({
    nomDemandeur: "Samira Dupont-Aïdi",
    email: "samira@example.com",
    societe: null,
    objet: "Messagerie inaccessible",
    statut: "en_cours",
    priorite: "haute",
    responsableId: karim.id,
    canal: "telephone",
  });
  garnier = await creer({
    nomDemandeur: "Sophie Garnier",
    email: "contact@atelier-oeuvre.example",
    societe: "Atelier Œuvre",
    objet: "Devis pour deux postes",
    statut: "traitee",
    priorite: "haute",
    responsableId: nadia.id,
    canal: "email",
  });
  speciale = await creer({
    nomDemandeur: "Marc Petit",
    email: "marc.petit@example.com",
    objet: "Remise de 100% sur le_lot \\ réseau",
    statut: "nouvelle",
    priorite: "basse",
    categorieId: categorie.id,
  });
  apostrophe = await creer({
    nomDemandeur: "Inès Haddad",
    email: "ines.haddad@example.com",
    objet: "Question sur l'été",
    statut: "en_cours",
    priorite: "normale",
    responsableId: nadia.id,
  });
  toutes = [dupont, dupontAidi, garnier, speciale, apostrophe];
}, 90_000);

afterAll(async () => {
  if (base) {
    await supprimerDemandesTest(base, PREFIXE);
    await base.query("delete from public.categories where nom like $1", [`${PREFIXE}%`]);
    await base.end().catch(() => {});
  }
  await membre?.auth.signOut({ scope: "local" }).catch(() => {});
  await supprimerComptesTest(comptes);
}, 60_000);

/** Références trouvées par la fonction de recherche, parmi nos demandes. */
async function chercher(texte: string, client: SupabaseClient = membre): Promise<string[]> {
  const { data, error } = await client
    .rpc("rechercher_demandes", { p_texte: texte })
    .select("reference")
    .like("nom", `${PREFIXE}%`);
  expect(error, texte).toBeNull();
  return (data as { reference: string }[]).map((l) => l.reference).sort();
}

/** Références lues par lireDemandesAvec, limitées à nos demandes par la recherche du préfixe. */
async function lire(filtres: Filtres, client: SupabaseClient = membre): Promise<string[]> {
  const resultat = await lireDemandesAvec(client, 1, { q: PREFIXE, ...filtres });
  expect(resultat.ok).toBe(true);
  if (!resultat.ok) return [];
  expect(resultat.donnees.total).toBe(resultat.donnees.lignes.length);
  return resultat.donnees.lignes.map((l) => l.reference).sort();
}

const refs = (...demandes: DemandeTest[]) => demandes.map((d) => d.reference).sort();

describe("normalisation et colonne de recherche", () => {
  it("prive.normaliser : minuscules, sans accents, ligatures, tirets et apostrophes, espaces", async () => {
    const { rows } = await base.query<{ n: string }>(
      "select prive.normaliser($1) as n",
      ["  Dupont-Aïdi   ÉCOLE Œuvre Straße l’été Łódź ÇA Ștefan Țară d'Arc "],
    );
    expect(rows[0].n).toBe("dupont aidi ecole oeuvre strasse l ete lodz ca stefan tara d arc");
  });

  it("même normalisation dans l'application (normaliserRecherche) et dans la base", async () => {
    const textes = [
      "Dupont-Aïdi",
      "  dupont   aidi ",
      "ÉCOLE Œuvre Æther Straße",
      "l’été d'Arc ‘x’ a–b—c",
      "Łódź Øresund Đorđe Ħamrun ıstanbul Ŧ",
      "Ștefan Țară Ğ ñ Ç Ÿ Å",
      "NOVA-2026-0042",
      "jean.dupont@example.com",
      "100% le_lot \\ réseau",
      "éte insécable	Tab",
      "-",
      "'",
    ];
    const { rows } = await base.query<{ n: string }>(
      "select prive.normaliser(t) as n from unnest($1::text[]) with ordinality as x(t, i) order by i",
      [textes],
    );
    expect(rows.map((r) => r.n)).toEqual(textes.map(normaliserRecherche));
  });

  it("la colonne est tenue à jour par la base à chaque modification", async () => {
    const lecture = () =>
      base
        .query<{ recherche: string }>("select recherche from public.demandes where id = $1", [
          apostrophe.id,
        ])
        .then((r) => r.rows[0].recherche);
    const avant = await lecture();
    expect(avant).toContain("ines haddad");
    expect(avant).toContain("question sur l ete");
    expect(avant).toContain(apostrophe.reference.toLowerCase().replace(/-/g, " "));
    expect(avant).toContain("ines.haddad@example.com");

    await base.query("update public.demandes set objet = $2 where id = $1", [
      apostrophe.id,
      "Question sur l'Été indien",
    ]);
    expect(await lecture()).toContain("question sur l ete indien");
    await base.query("update public.demandes set objet = $2 where id = $1", [
      apostrophe.id,
      "Question sur l'été",
    ]);
  });

  it("index trigrammes sur la colonne", async () => {
    const { rows } = await base.query<{ definition: string }>(
      "select indexdef as definition from pg_indexes where tablename = 'demandes' and indexname = 'demandes_recherche_trgm_idx'",
    );
    expect(rows[0]?.definition).toMatch(/USING gin \(recherche (extensions\.)?gin_trgm_ops\)/);
  });
});

describe("recherche texte (rechercher_demandes)", () => {
  it("référence complète : seule cette demande", async () => {
    const resultat = await lireDemandesAvec(membre, 1, { q: dupont.reference });
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.total).toBe(1);
    expect(resultat.donnees.lignes.map((l) => l.reference)).toEqual([dupont.reference]);
  });

  it("mot partiel, sans majuscules ni accents", async () => {
    expect(await chercher("dupont")).toEqual(refs(dupont, dupontAidi));
    expect(await chercher("DUPONT")).toEqual(refs(dupont, dupontAidi));
    expect(await chercher("aidi")).toEqual(refs(dupontAidi));
    expect(await chercher("Aïdi")).toEqual(refs(dupontAidi));
    expect(await chercher("dupont-aïdi")).toEqual(refs(dupontAidi));
    expect(await chercher("Dupont Aïdi")).toEqual(refs(dupontAidi));
    expect(await chercher("  dupont    aidi ")).toEqual(refs(dupontAidi));
    expect(await chercher(dupont.reference.replace(/-/g, " "))).toEqual(refs(dupont));
    expect(await chercher("upon")).toEqual(refs(dupont, dupontAidi));
    expect(await chercher("ete")).toEqual(refs(apostrophe));
  });

  it("porte sur la société, l'email et l'objet", async () => {
    expect(await chercher("lefevre")).toEqual(refs(dupont));
    expect(await chercher("oeuvre")).toEqual(refs(garnier));
    expect(await chercher("Œuvre")).toEqual(refs(garnier));
    expect(await chercher("samira@example")).toEqual(refs(dupontAidi));
    expect(await chercher("postes")).toEqual(refs(garnier));
  });

  it("caractères spéciaux cherchés tels quels, sans erreur", async () => {
    expect(await chercher("%")).toEqual(refs(speciale));
    expect(await chercher("100%")).toEqual(refs(speciale));
    expect(await chercher("_")).toEqual(refs(speciale));
    expect(await chercher("le_lot")).toEqual(refs(speciale));
    expect(await chercher("\\")).toEqual(refs(speciale));
    // Apostrophes et tirets valent une espace : « ' » seule ne restreint rien.
    expect(await chercher("'")).toEqual(refs(...toutes));
    expect(await chercher("l'été")).toEqual(refs(apostrophe));
    expect(await chercher("l’été")).toEqual(refs(apostrophe));
    expect(await chercher("aucun texte de ce genre")).toEqual([]);
  });

  it("texte de plus de 100 caractères refusé (DONNEES_INVALIDES)", async () => {
    const { error } = await membre.rpc("rechercher_demandes", { p_texte: "a".repeat(101) });
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("DONNEES_INVALIDES");
  });

  it("le préfixe de l'exécution isole nos demandes (total et pagination)", async () => {
    expect(await lire({})).toEqual(refs(...toutes));
  });
});

describe("filtres", () => {
  it("statut, dont « Non traitées » (Nouvelle et En cours)", async () => {
    expect(await lire({ statut: "nouvelle" })).toEqual(refs(dupont, speciale));
    expect(await lire({ statut: "en_cours" })).toEqual(refs(dupontAidi, apostrophe));
    expect(await lire({ statut: "traitee" })).toEqual(refs(garnier));
    expect(await lire({ statut: "non_traitees" })).toEqual(
      refs(dupont, dupontAidi, speciale, apostrophe),
    );
  });

  it("priorité, canal, catégorie", async () => {
    expect(await lire({ priorite: "haute" })).toEqual(refs(dupont, dupontAidi, garnier));
    expect(await lire({ priorite: "basse" })).toEqual(refs(speciale));
    expect(await lire({ canal: "telephone" })).toEqual(refs(dupontAidi));
    expect(await lire({ canal: "email" })).toEqual(refs(garnier));
    expect(await lire({ canal: "formulaire" })).toEqual(refs(dupont, speciale, apostrophe));
    expect(await lire({ categorie: categorie.id })).toEqual(refs(speciale));
  });

  it("responsable : sans responsable, mes demandes, un membre", async () => {
    expect(await lire({ responsable: "aucun" })).toEqual(refs(dupont, speciale));
    // Session de Karim : « Mes demandes ».
    expect(await lire({ responsable: "moi" })).toEqual(refs(dupontAidi));
    expect(await lire({ responsable: nadia.id })).toEqual(refs(garnier, apostrophe));
    // Session de Nadia : « Mes demandes » change avec la personne connectée.
    const clientNadia = await clientConnecte(nadia);
    try {
      expect(await lire({ responsable: "moi" }, clientNadia)).toEqual(refs(garnier, apostrophe));
    } finally {
      await clientNadia.auth.signOut({ scope: "local" });
    }
  });

  it("filtres combinés (critère 2 : Non traitées et Haute)", async () => {
    expect(await lire({ statut: "non_traitees", priorite: "haute" })).toEqual(
      refs(dupont, dupontAidi),
    );
    expect(await lire({ statut: "non_traitees", priorite: "haute", responsable: "aucun" })).toEqual(
      refs(dupont),
    );
    expect(
      await lire({ statut: "en_cours", canal: "telephone", responsable: "moi", priorite: "haute" }),
    ).toEqual(refs(dupontAidi));
    // Recherche et filtres ensemble.
    const resultat = await lireDemandesAvec(membre, 1, { q: "dupont", statut: "nouvelle" });
    expect(resultat.ok && resultat.donnees.lignes.map((l) => l.reference)).toContain(
      dupont.reference,
    );
    expect(resultat.ok && resultat.donnees.lignes.map((l) => l.reference)).not.toContain(
      dupontAidi.reference,
    );
    // Aucune correspondance.
    expect(await lire({ statut: "traitee", priorite: "basse" })).toEqual([]);
  });

  it("sans recherche texte, les filtres s'appliquent à la vue", async () => {
    // Catégorie et responsable propres à cette exécution : résultat exact.
    const parCategorie = await lireDemandesAvec(membre, 1, { categorie: categorie.id });
    expect(parCategorie.ok && parCategorie.donnees.lignes.map((l) => l.reference)).toEqual([
      speciale.reference,
    ]);
    expect(parCategorie.ok && parCategorie.donnees.total).toBe(1);

    const parMembre = await lireDemandesAvec(membre, 1, {
      responsable: nadia.id,
      statut: "non_traitees",
    });
    expect(parMembre.ok && parMembre.donnees.lignes.map((l) => l.reference)).toEqual([
      apostrophe.reference,
    ]);

    const mesDemandes = await lireDemandesAvec(membre, 1, { responsable: "moi" });
    expect(mesDemandes.ok && mesDemandes.donnees.lignes.map((l) => l.reference)).toEqual([
      dupontAidi.reference,
    ]);
  });
});

describe("page au-delà de la fin", () => {
  it("avec une recherche : dernière page de la liste filtrée", async () => {
    const resultat = await lireDemandesAvec(membre, 1_000_000, { q: PREFIXE });
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.page).toBe(1);
    expect(resultat.donnees.total).toBe(toutes.length);
    expect(resultat.donnees.lignes.map((l) => l.reference).sort()).toEqual(refs(...toutes));
  });

  it("avec un filtre sans recherche : dernière page de la liste filtrée", async () => {
    const resultat = await lireDemandesAvec(membre, 1_000_000, { categorie: categorie.id });
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.page).toBe(1);
    expect(resultat.donnees.total).toBe(1);
    expect(resultat.donnees.lignes.map((l) => l.reference)).toEqual([speciale.reference]);
  });
});

describe("recherche et vue : mêmes lignes, RLS réelle", () => {
  const COLONNES =
    "id, reference, cree_le, nom, societe, email, objet, categorie_id, categorie_nom, canal, statut, priorite, responsable_id, responsable_nom, etat_email, traitee_le";

  it("pour un membre, la recherche renvoie exactement les lignes de la vue", async () => {
    const { data: trouvees, error } = await membre
      .rpc("rechercher_demandes", { p_texte: PREFIXE })
      .select(COLONNES)
      .order("reference");
    expect(error).toBeNull();
    const { data: vue, error: erreurVue } = await membre
      .from("demandes_liste")
      .select(COLONNES)
      .like("nom", `${PREFIXE}%`)
      .order("reference");
    expect(erreurVue).toBeNull();
    expect(trouvees).toHaveLength(toutes.length);
    expect(trouvees).toEqual(vue);
  });

  it("pour un compte désactivé : rien, ni identifiant ni ligne", async () => {
    const client = await clientConnecte(desactive);
    try {
      const { data: ids, error } = await client.rpc("ids_demandes_recherche", { p_texte: PREFIXE });
      expect(error).toBeNull();
      expect(ids).toEqual([]);
      const { data, error: erreur } = await client.rpc("rechercher_demandes", { p_texte: PREFIXE });
      expect(erreur).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await client.auth.signOut({ scope: "local" });
    }
  });

  it("rechercher_demandes lit la vue avec les droits de l'appelant ; seule la recherche des identifiants est SECURITY DEFINER", async () => {
    const { rows } = await base.query<{ nom: string; definer: boolean; reglages: string[] | null }>(
      `select proname as nom, prosecdef as definer, proconfig as reglages
         from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('rechercher_demandes', 'ids_demandes_recherche')
        order by proname`,
    );
    expect(rows).toEqual([
      { nom: "ids_demandes_recherche", definer: true, reglages: ['search_path=""'] },
      // Sans réglage ni SECURITY DEFINER : insérée dans la requête appelante.
      { nom: "rechercher_demandes", definer: false, reglages: null },
    ]);
  });
});

describe("choix des filtres", () => {
  it("toutes les catégories (désactivées comprises), les membres actifs et désactivés", async () => {
    const resultat = await lireOptionsFiltresAvec(membre);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.donnees.categories).toContainEqual({
      id: categorie.id,
      nom: categorie.nom,
      desactive: true,
    });
    expect(resultat.donnees.membres).toContainEqual({ id: nadia.id, nom: nadia.nom, desactive: false });
    expect(resultat.donnees.membres).toContainEqual({
      id: desactive.id,
      nom: desactive.nom,
      desactive: true,
    });
    // Un compte invité n'a jamais de demande : absent de la liste.
    expect(resultat.donnees.membres.map((m) => m.id)).not.toContain(invite.id);
  });
});

describe("droits", () => {
  it("la colonne recherche n'est pas lisible par un membre", async () => {
    const { error } = await membre.from("demandes").select("recherche").limit(1);
    expect(error?.code).toBe(PERMISSION_REFUSEE);
    const { error: vue } = await membre.from("demandes_liste").select("recherche").limit(1);
    expect(vue).not.toBeNull();
  });

  it("un compte désactivé ou invité ne trouve rien", async () => {
    for (const compte of [desactive, invite]) {
      const client = await clientConnecte(compte);
      try {
        const { data, error } = await client.rpc("rechercher_demandes", { p_texte: PREFIXE });
        expect(error, compte.etat).toBeNull();
        expect(data, compte.etat).toEqual([]);
        const resultat = await lireDemandesAvec(client, 1, { q: "dupont", statut: "nouvelle" });
        expect(resultat.ok && resultat.donnees.total).toBe(0);
      } finally {
        await client.auth.signOut({ scope: "local" });
      }
    }
  });

  it("le visiteur et la clé secrète sont refusés", async () => {
    const { error: visiteur } = await clientPubliableTest().rpc("rechercher_demandes", {
      p_texte: "dupont",
    });
    expect(visiteur?.code).toBe(PERMISSION_REFUSEE);
    const { error: service } = await clientServiceTest().rpc("rechercher_demandes", {
      p_texte: "dupont",
    });
    expect(service?.code).toBe(PERMISSION_REFUSEE);
  });
});
