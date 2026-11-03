// Crée le premier administrateur de Nova Services (AD-17, AD-18).
// À lancer par Abraham lui-même, dans un terminal :
//   npm run admin:creer
// Le script demande le nom, l'email et le mot de passe (saisie masquée).
// Rien n'est écrit dans le code ni affiché. Refusé hors du projet de
// développement (la production viendra avec la story 3.1), et refusé si un
// administrateur actif existe déjà (le compte TEST-Admin compte aussi) :
//   npm run admin:creer -- --encore   pour en créer un autre malgré tout.

import { createInterface } from "node:readline/promises";
import { clientService, codeErreur, FORMAT_EMAIL, preparerEnvironnement } from "./commun.ts";

const LONGUEUR_MIN_MOT_DE_PASSE = 8;

preparerEnvironnement("premier-admin");

if (!process.stdin.isTTY) {
  console.error("Lancez ce script dans un terminal : le mot de passe doit être saisi au clavier.");
  process.exit(1);
}

async function question(libelle: string): Promise<string> {
  const lecteur = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await lecteur.question(libelle)).trim();
  } finally {
    lecteur.close();
  }
}

/** Saisie masquée : rien ne s'affiche pendant la frappe. */
function questionMasquee(libelle: string): Promise<string> {
  return new Promise((resoudre) => {
    process.stdout.write(libelle);
    const entree = process.stdin;
    entree.setRawMode(true);
    entree.resume();
    entree.setEncoding("utf8");
    let saisie = "";
    const surDonnees = (morceau: string) => {
      for (const caractere of morceau) {
        if (caractere === "\r" || caractere === "\n") {
          entree.setRawMode(false);
          entree.pause();
          entree.off("data", surDonnees);
          process.stdout.write("\n");
          resoudre(saisie);
          return;
        }
        if (caractere === "\u0003") {
          // Ctrl+C
          entree.setRawMode(false);
          process.stdout.write("\nAnnulé.\n");
          process.exit(1);
        }
        if (caractere === "\u007f" || caractere === "\b") {
          saisie = Array.from(saisie).slice(0, -1).join("");
        } else if (caractere >= " ") {
          saisie += caractere;
        }
      }
    };
    entree.on("data", surDonnees);
  });
}

async function principal() {
  console.log("Création du premier administrateur (projet de développement).");

  const client = clientService();

  // Garde-fou : un seul « premier » administrateur, sauf demande explicite.
  const { data: nombre, error: erreurNombre } = await client.rpc("nombre_administrateurs_actifs");
  if (erreurNombre || typeof nombre !== "number") {
    console.error(
      `Vérification des administrateurs impossible (${codeErreur(erreurNombre) ?? "réponse inattendue"}).`,
    );
    process.exit(1);
  }
  if (nombre > 0 && !process.argv.includes("--encore")) {
    console.error(
      `Refusé : ${nombre} administrateur${nombre > 1 ? "s" : ""} actif${nombre > 1 ? "s" : ""} existe${
        nombre > 1 ? "nt" : ""
      } déjà. Pour en créer un autre malgré tout : npm run admin:creer -- --encore`,
    );
    process.exit(1);
  }

  const nom = await question("Nom et prénom : ");
  if (nom.length < 1 || Array.from(nom).length > 150) {
    console.error("Le nom doit compter entre 1 et 150 caractères.");
    process.exit(1);
  }

  const email = (await question("Email : ")).toLowerCase();
  if (!FORMAT_EMAIL.test(email) || email.length > 254) {
    console.error("Cette adresse email ne semble pas valide.");
    process.exit(1);
  }

  const motDePasse = await questionMasquee(
    `Mot de passe (${LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum, rien ne s'affiche) : `,
  );
  if (Array.from(motDePasse).length < LONGUEUR_MIN_MOT_DE_PASSE) {
    console.error(`Le mot de passe doit compter au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`);
    process.exit(1);
  }
  const confirmation = await questionMasquee("Confirmez le mot de passe : ");
  if (confirmation !== motDePasse) {
    console.error("Les deux mots de passe sont différents.");
    process.exit(1);
  }

  // 1. Compte Auth (sans email envoyé, adresse considérée comme confirmée).
  const { data, error } = await client.auth.admin.createUser({
    email,
    password: motDePasse,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.error(
      error?.code === "email_exists"
        ? "Un compte existe déjà avec cet email."
        : `Création du compte impossible (${error?.code ?? error?.status ?? "réponse vide"}).`,
    );
    process.exit(1);
  }

  // 2. Ligne `membres` : seule voie de création (AD-17). En cas d'échec, le
  // compte Auth est supprimé pour ne pas laisser de compte sans membre.
  const { error: erreurMembre } = await client.rpc("creer_membre", {
    p_id: data.user.id,
    p_nom: nom,
    p_email: email,
    p_role: "administrateur",
    p_etat: "actif",
  });
  if (erreurMembre) {
    const { error: erreurSuppression } = await client.auth.admin.deleteUser(data.user.id);
    console.error(
      erreurSuppression
        ? `Création du membre impossible (${codeErreur(erreurMembre)}). ATTENTION : le compte Auth n'a pas pu être supprimé (${erreurSuppression.code ?? erreurSuppression.status}) ; supprimez-le dans le tableau de bord Supabase (Authentication → Users).`
        : `Création du membre impossible (${codeErreur(erreurMembre)}). Compte Auth supprimé.`,
    );
    process.exit(1);
  }

  console.log("Administrateur créé. Vous pouvez vous connecter sur /connexion.");
}

principal().catch((erreur: unknown) => {
  console.error(`Erreur inattendue : ${erreur instanceof Error ? erreur.message : "inconnue"}`);
  process.exit(1);
});
