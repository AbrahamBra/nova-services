import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUREE_TOAST_SUCCES, FileToasts, MAX_TOASTS } from "@/components/nova/toasts";

// Story 2.1 — file des toasts (components/nova/toasts.tsx), avec de faux
// minuteurs : réussite fermée après 5 s, pause au survol et au focus
// (WCAG 2.2.1), erreur gardée jusqu'à fermeture, doublons, limite de 3.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const messages = (file: FileToasts) => file.liste().map((t) => t.message);

describe("FileToasts", () => {
  it("une réussite se ferme d'elle-même après 5 secondes", () => {
    const file = new FileToasts();
    const ecouteur = vi.fn();
    file.abonner(ecouteur);
    file.afficher("succes", "Vous êtes responsable de cette demande.");
    expect(messages(file)).toEqual(["Vous êtes responsable de cette demande."]);

    vi.advanceTimersByTime(DUREE_TOAST_SUCCES - 1);
    expect(file.liste()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(file.liste()).toHaveLength(0);
    expect(ecouteur).toHaveBeenCalledTimes(2);
  });

  it("minuteur en pause au survol, puis reprise pour le temps restant", () => {
    const file = new FileToasts();
    const id = file.afficher("succes", "Fait.");
    vi.advanceTimersByTime(3_000);
    file.suspendre(id, "survol");
    vi.advanceTimersByTime(60_000);
    expect(file.liste()).toHaveLength(1);

    file.reprendre(id, "survol");
    vi.advanceTimersByTime(1_999);
    expect(file.liste()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(file.liste()).toHaveLength(0);
  });

  it("pause au focus : reste affiché tant que focus ou survol demeure", () => {
    const file = new FileToasts();
    const id = file.afficher("succes", "Fait.");
    file.suspendre(id, "focus");
    file.suspendre(id, "survol");
    file.reprendre(id, "survol");
    vi.advanceTimersByTime(60_000);
    expect(file.liste()).toHaveLength(1);
    file.reprendre(id, "focus");
    vi.advanceTimersByTime(DUREE_TOAST_SUCCES);
    expect(file.liste()).toHaveLength(0);
  });

  it("une erreur reste jusqu'à ce qu'on la ferme", () => {
    const file = new FileToasts();
    const id = file.afficher("erreur", "Déjà prise en charge par Karim Benali.");
    vi.advanceTimersByTime(10 * 60_000);
    expect(file.liste()).toHaveLength(1);
    file.fermer(id);
    expect(file.liste()).toHaveLength(0);
  });

  it("un message identique déjà affiché n'est pas répété", () => {
    const file = new FileToasts();
    const a = file.afficher("erreur", "Le serveur ne répond pas.");
    const b = file.afficher("erreur", "Le serveur ne répond pas.");
    expect(b).toBe(a);
    expect(file.liste()).toHaveLength(1);
    // Même texte, autre type : affiché.
    file.afficher("succes", "Le serveur ne répond pas.");
    expect(file.liste()).toHaveLength(2);
  });

  it(`au plus ${MAX_TOASTS} messages : le plus ancien part le premier`, () => {
    const file = new FileToasts();
    for (const n of [1, 2, 3, 4]) file.afficher("erreur", `Erreur ${n}.`);
    expect(MAX_TOASTS).toBe(3);
    expect(messages(file)).toEqual(["Erreur 2.", "Erreur 3.", "Erreur 4."]);
  });

  it("une réussite écartée par la limite n'est plus fermée par son minuteur", () => {
    const file = new FileToasts();
    file.afficher("succes", "Réussite.");
    for (const n of [1, 2, 3]) file.afficher("erreur", `Erreur ${n}.`);
    expect(messages(file)).toEqual(["Erreur 1.", "Erreur 2.", "Erreur 3."]);
    vi.advanceTimersByTime(DUREE_TOAST_SUCCES);
    expect(file.liste()).toHaveLength(3);
  });
});
