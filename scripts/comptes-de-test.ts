// Crée (ou remet à neuf) les deux comptes de test persistants du projet de
// développement : `TEST-Admin` (administrateur) et `TEST-Collaborateur`.
//   npm run comptes:test
// Les mots de passe sont tirés au hasard à chaque lancement et écrits
// SEULEMENT dans .env.local (TEST_ADMIN_MOT_DE_PASSE, TEST_COLLAB_MOT_DE_PASSE),
// jamais affichés. Refusé hors du projet de développement.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clientPubliable,
  clientService,
  codeErreur,
  FORMAT_EMAIL,
  preparerEnvironnement,
  trouverCompteAuth,
} from "./commun.ts";

preparerEnvironnement("comptes-de-test");

type CompteTest = {
  prefixe: "TEST_ADMIN" | "TEST_COLLAB";
  nom: string;
  role: "administrateur" | "collaborateur";
  emailParDefaut: string;
};

const COMPTES: CompteTest[] = [
  {
    prefixe: "TEST_ADMIN",
    nom: "TEST-Admin",
    role: "administrateur",
    emailParDefaut: "test-admin@example.com",
  },
  {
    prefixe: "TEST_COLLAB",
    nom: "TEST-Collaborateur",
    role: "collaborateur",
    emailParDefaut: "test-collaborateur@example.com",
  },
];

const FICHIER_ENV = join(process.cwd(), ".env.local");

/** Remplace ou ajoute des variables dans .env.local, sans toucher au reste. */
function ecrireEnvLocal(valeurs: Record<string, string>): void {
  const contenu = existsSync(FICHIER_ENV) ? readFileSync(FICHIER_ENV, "utf8") : "";
  const fin = contenu.includes("\r\n") ? "\r\n" : "\n";
  const lignes = contenu === "" ? [] : contenu.replace(/(\r?\n)+$/, "").split(/\r?\n/);
  for (const [cle, valeur] of Object.entries(valeurs)) {
    const ligne = `${cle}=${valeur}`;
    const index = lignes.findIndex((l) => l.startsWith(`${cle}=`));
    if (index >= 0) lignes[index] = ligne;
    else lignes.push(ligne);
  }
  writeFileSync(FICHIER_ENV, lignes.join(fin) + fin, "utf8");
}

/**
 * Pour un compte déjà membre : vérifie, en se connectant avec le nouveau mot
 * de passe, qu'il est actif avec le rôle attendu.
 */
async function verifierMembre(compte: CompteTest, email: string, motDePasse: string): Promise<void> {
  const client = clientPubliable();
  const { error } = await client.auth.signInWithPassword({ email, password: motDePasse });
  if (error) {
    throw new Error(`${compte.nom} : connexion de vérification impossible (${error.code ?? error.status}).`);
  }
  try {
    const { data, error: erreurProfil } = await client.rpc("mon_profil");
    const profil = data as { role?: string; etat?: string } | null;
    if (erreurProfil) {
      throw new Error(`${compte.nom} : lecture du profil impossible (${codeErreur(erreurProfil)}).`);
    }
    if (!profil || profil.etat !== "actif" || profil.role !== compte.role) {
      throw new Error(
        `${compte.nom} existe déjà mais n'est pas un membre actif avec le rôle « ${compte.role} ». ` +
          "Corrigez ce compte (ou supprimez-le dans Supabase), puis relancez le script.",
      );
    }
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}

async function supprimerCompteAuth(client: ReturnType<typeof clientService>, id: string, nom: string) {
  const { error } = await client.auth.admin.deleteUser(id);
  if (error && error.status !== 404) {
    console.error(
      `ATTENTION : le compte Auth de ${nom} n'a pas pu être supprimé (${error.code ?? error.status}) ; supprimez-le dans le tableau de bord Supabase.`,
    );
  }
}

async function principal() {
  const client = clientService();

  for (const compte of COMPTES) {
    const email = (process.env[`${compte.prefixe}_EMAIL`] || compte.emailParDefaut).trim().toLowerCase();
    if (!FORMAT_EMAIL.test(email)) {
      throw new Error(`${compte.prefixe}_EMAIL ne semble pas valide dans .env.local.`);
    }
    // 24 caractères aléatoires (144 bits).
    const motDePasse = randomBytes(18).toString("base64url");

    const existant = await trouverCompteAuth(client, email);
    let id: string;
    let cree = false;
    if (existant) {
      const { error } = await client.auth.admin.updateUserById(existant.id, {
        password: motDePasse,
      });
      if (error) throw new Error(`Mise à jour de ${compte.nom} impossible (${error.code ?? error.status}).`);
      id = existant.id;
    } else {
      const { data, error } = await client.auth.admin.createUser({
        email,
        password: motDePasse,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Création de ${compte.nom} impossible (${error?.code ?? error?.status}).`);
      }
      id = data.user.id;
      cree = true;
    }

    // Écrit tout de suite : un échec plus loin ne perd jamais un mot de
    // passe déjà posé dans Auth.
    ecrireEnvLocal({
      [`${compte.prefixe}_EMAIL`]: email,
      [`${compte.prefixe}_MOT_DE_PASSE`]: motDePasse,
    });

    const { error: erreurMembre } = await client.rpc("creer_membre", {
      p_id: id,
      p_nom: compte.nom,
      p_email: email,
      p_role: compte.role,
      p_etat: "actif",
    });
    const code = codeErreur(erreurMembre);
    if (code === "MEMBRE_EXISTANT") {
      await verifierMembre(compte, email, motDePasse);
    } else if (code) {
      if (cree) await supprimerCompteAuth(client, id, compte.nom);
      throw new Error(`Création du membre ${compte.nom} impossible (${code}).`);
    }

    console.log(`${compte.nom} prêt (${email}).`);
  }

  console.log("Mots de passe écrits dans .env.local (jamais affichés).");
}

principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : "Erreur inattendue.");
  process.exit(1);
});
