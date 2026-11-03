// Garde-fou lancé une seule fois avant tous les tests Vitest (AD-27).
// Les tests écrivent et lisent dans le projet Supabase : ils ne doivent
// tourner que sur le projet de développement, jamais sur la production.

export const ENVIRONNEMENT_ATTENDU = "developpement";

export function verifierEnvironnement(valeur: string | undefined): void {
  if (valeur !== ENVIRONNEMENT_ATTENDU) {
    throw new Error(
      `Tests arrêtés : SUPABASE_ENVIRONNEMENT vaut ${
        valeur === undefined || valeur === "" ? "(absent)" : `« ${valeur} »`
      } au lieu de « ${ENVIRONNEMENT_ATTENDU} ». ` +
        "Les tests ne tournent que sur le projet Supabase de développement. " +
        "Vérifiez .env.local (ou les secrets GitHub).",
    );
  }
}

// Point d'entrée `globalSetup` de Vitest : s'exécute avant toute connexion.
export default function setup(): void {
  verifierEnvironnement(process.env.SUPABASE_ENVIRONNEMENT);
}
