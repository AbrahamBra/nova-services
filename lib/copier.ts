// Copie d'un texte dans le presse-papiers (navigateur seulement) : API
// Clipboard, sinon l'ancienne méthode (`execCommand`). Partagée par
// « Copier » (référence, story 1.3) et « Copier le lien » (story 2.8).
// Renvoie false si le navigateur refuse.

export async function copierTexte(texte: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
  } catch {
    // Presse-papiers refusé : on tente l'ancienne méthode.
  }
  const zone = document.createElement("textarea");
  try {
    zone.value = texte;
    zone.setAttribute("readonly", "");
    zone.style.position = "fixed";
    zone.style.opacity = "0";
    document.body.appendChild(zone);
    zone.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    zone.remove();
  }
}
