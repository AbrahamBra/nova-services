import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  avecBase,
  clientConnecte,
  clientPubliableTest,
  clientServiceTest,
  creerCompteTest,
  effacerJournalDesComptesTest,
  supprimerComptesTest,
  type CompteTest,
} from "@/tests/outils/comptes";

// Story 4.1 — action `inviter` contre la VRAIE base et la vraie API Auth de
// nova-dev (seuls le profil de session et Next.js sont simulés). Prouve
// qu'inviter l'adresse d'un compte existant ne touche jamais ce compte :
//   - membre actif (compte Auth confirmé) ;
//   - membre invité en attente (compte Auth NON confirmé : generateLink
//     l'aurait renvoyé avec un nouveau jeton) : son lien d'origine reste
//     valable.
// Comptes `TEST-4.1-…` jetables, supprimés à la fin.

const sim = vi.hoisted(() => ({ profil: null as unknown }));

vi.mock("@sentry/nextjs", () => ({ captureMessage: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, refresh: () => {} }));
vi.mock("@/lib/session", async (importer) => ({
  ...(await importer<typeof import("@/lib/session")>()),
  lireProfil: async () => sim.profil,
}));

import { inviter } from "@/lib/actions/admin";
import { messageErreur } from "@/lib/erreurs";
import { ETAT_INVITATION_INITIAL } from "@/lib/schemas/invitation";

const comptes: CompteTest[] = [];
const authSeuls: string[] = [];
let admin: CompteTest;
let actif: CompteTest;
const siteAvant = process.env.NEXT_PUBLIC_SITE_URL;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3210";
  admin = await creerCompteTest({ etiquette: "4.1", role: "administrateur", prenom: "Claire" });
  actif = await creerCompteTest({ etiquette: "4.1", role: "collaborateur", prenom: "Karim" });
  comptes.push(admin, actif);
  sim.profil = {
    ok: true,
    donnees: { id: admin.id, nom: admin.nom, prenom: "TEST", role: "administrateur", estAdmin: true },
  };
}, 60_000);

afterAll(async () => {
  process.env.NEXT_PUBLIC_SITE_URL = siteAvant;
  await effacerJournalDesComptesTest(comptes.map((c) => c.id)).catch((erreur) =>
    console.error(`Nettoyage du journal impossible : ${String(erreur)}`),
  );
  await supprimerComptesTest(comptes);
  for (const id of authSeuls) await clientServiceTest().auth.admin.deleteUser(id).catch(() => {});
}, 60_000);

function formulaire(nom: string, email: string): FormData {
  const f = new FormData();
  f.set("nom", nom);
  f.set("email", email);
  f.set("role", "collaborateur");
  return f;
}

async function etatDe(id: string) {
  return avecBase(async (b) => ({
    membre: (await b.query("select etat, email from public.membres where id = $1", [id])).rows[0],
    auth: (await b.query("select id from auth.users where id = $1", [id])).rowCount,
  }));
}

describe("inviter l'adresse d'un compte existant", () => {
  it("membre actif : EMAIL_DEJA_UTILISE, son compte Auth et sa ligne membres restent intacts", async () => {
    const etat = await inviter(
      ETAT_INVITATION_INITIAL,
      formulaire(`TEST-4.1-${randomUUID().slice(0, 8)} Doublon`, actif.email.toUpperCase()),
    );
    expect(etat.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
    expect(etat.invitation).toBeNull();
    expect(await etatDe(actif.id)).toEqual({ membre: { etat: "actif", email: actif.email }, auth: 1 });
    // Il se connecte toujours.
    await expect(clientConnecte(actif)).resolves.toBeTruthy();
  });

  it("invitation en attente : refusée, le compte reste et son premier lien reste valable", async () => {
    const leo = { nom: `TEST-4.1-${randomUUID().slice(0, 8)} Léo Martin`, email: `test-4-1-${randomUUID().slice(0, 8)}@example.com` };
    const premiere = await inviter(ETAT_INVITATION_INITIAL, formulaire(leo.nom, leo.email));
    expect(premiere.invitation).not.toBeNull();
    const jeton = new URL(premiere.invitation!.lien).searchParams.get("token_hash")!;
    const { rows } = await avecBase((b) =>
      b.query<{ id: string }>("select id from public.membres where email = $1", [leo.email]),
    );
    const id = rows[0].id;
    comptes.push({ id, nom: leo.nom, email: leo.email, motDePasse: "", role: "collaborateur", etat: "invite" });

    const seconde = await inviter(ETAT_INVITATION_INITIAL, formulaire(leo.nom, leo.email));
    expect(seconde.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
    expect(seconde.invitation).toBeNull();
    expect(await etatDe(id)).toEqual({ membre: { etat: "invite", email: leo.email }, auth: 1 });

    // Aucun nouveau jeton n'a été émis : le premier lien fonctionne encore.
    const { error } = await clientPubliableTest().auth.verifyOtp({ token_hash: jeton, type: "invite" });
    expect(error).toBeNull();
  });

  it("compte Auth sans membre (orphelin) : refusé, jamais supprimé", async () => {
    const email = `test-4-1-orphelin-${randomUUID().slice(0, 8)}@example.com`;
    const { data } = await clientServiceTest().auth.admin.generateLink({ type: "invite", email });
    const id = data.user!.id;
    authSeuls.push(id);
    const etat = await inviter(ETAT_INVITATION_INITIAL, formulaire("TEST-4.1 Orphelin", email));
    expect(etat.erreurs).toEqual({ email: messageErreur("EMAIL_DEJA_UTILISE") });
    expect((await etatDe(id)).auth).toBe(1);
  });
});
