"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Toasts de l'espace équipe (EXPERIENCE.md §4, epic 2) : un message court
// après chaque action, en bas à droite (en haut sur téléphone). Une réussite
// disparaît après 5 secondes, minuteur en pause tant que le message est
// survolé ou a le focus (WCAG 2.2.1) ; une erreur reste jusqu'à ce qu'on la
// ferme. Un message identique à un message affiché n'est pas répété ; au
// plus 3 messages, le plus ancien part le premier.
// Annoncés aux lecteurs d'écran : deux zones `aria-live` toujours présentes
// (réussites en « polite », erreurs en « assertive »), pour que l'ajout d'un
// message soit lu. Composant unique, réutilisé par toutes les actions.

export type TypeToast = "succes" | "erreur";

export type Toast = { id: number; type: TypeToast; message: string };

/** Durée d'affichage d'une réussite (EXPERIENCE.md §4). */
export const DUREE_TOAST_SUCCES = 5_000;

/** Nombre maximal de messages affichés en même temps. */
export const MAX_TOASTS = 3;

export type RaisonPause = "survol" | "focus";

type Minuteur = {
  poignee: ReturnType<typeof setTimeout> | null;
  restant: number;
  debut: number;
  pauses: Set<RaisonPause>;
};

/**
 * File des toasts, sans React (testable avec de faux minuteurs) : ajout,
 * fermeture, minuteur des réussites avec pause, doublons et limite.
 */
export class FileToasts {
  private toasts: Toast[] = [];
  private readonly minuteurs = new Map<number, Minuteur>();
  private readonly ecouteurs = new Set<() => void>();
  private prochainId = 1;

  constructor(
    private readonly duree = DUREE_TOAST_SUCCES,
    private readonly max = MAX_TOASTS,
  ) {}

  liste = (): Toast[] => this.toasts;

  abonner = (ecouteur: () => void): (() => void) => {
    this.ecouteurs.add(ecouteur);
    return () => {
      this.ecouteurs.delete(ecouteur);
    };
  };

  /** Affiche un message ; un message identique déjà affiché n'est pas répété. */
  afficher = (type: TypeToast, message: string): number => {
    const existant = this.toasts.find((t) => t.type === type && t.message === message);
    if (existant) return existant.id;
    const toast = { id: this.prochainId++, type, message };
    this.toasts = [...this.toasts, toast];
    while (this.toasts.length > this.max) this.retirer(this.toasts[0].id);
    if (type === "succes") {
      this.minuteurs.set(toast.id, { poignee: null, restant: this.duree, debut: 0, pauses: new Set() });
      this.demarrer(toast.id);
    }
    this.prevenir();
    return toast.id;
  };

  fermer = (id: number): void => {
    if (!this.toasts.some((t) => t.id === id)) return;
    this.retirer(id);
    this.prevenir();
  };

  /** Met en pause le minuteur d'une réussite (survol ou focus). */
  suspendre = (id: number, raison: RaisonPause): void => {
    const m = this.minuteurs.get(id);
    if (!m) return;
    if (m.pauses.size === 0 && m.poignee !== null) {
      clearTimeout(m.poignee);
      m.poignee = null;
      m.restant = Math.max(0, m.restant - (Date.now() - m.debut));
    }
    m.pauses.add(raison);
  };

  /** Reprend le minuteur quand plus rien ne le met en pause. */
  reprendre = (id: number, raison: RaisonPause): void => {
    const m = this.minuteurs.get(id);
    if (!m || !m.pauses.delete(raison) || m.pauses.size > 0) return;
    this.demarrer(id);
  };

  /** Arrête tous les minuteurs (démontage). */
  vider = (): void => {
    for (const m of this.minuteurs.values()) if (m.poignee !== null) clearTimeout(m.poignee);
    this.minuteurs.clear();
  };

  private demarrer(id: number) {
    const m = this.minuteurs.get(id);
    if (!m) return;
    m.debut = Date.now();
    m.poignee = setTimeout(() => this.fermer(id), m.restant);
  }

  private retirer(id: number) {
    const m = this.minuteurs.get(id);
    if (m?.poignee != null) clearTimeout(m.poignee);
    this.minuteurs.delete(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  private prevenir() {
    for (const ecouteur of this.ecouteurs) ecouteur();
  }
}

type ContexteToasts = {
  /** Affiche un message ; renvoie son identifiant. */
  afficher: (type: TypeToast, message: string) => number;
  fermer: (id: number) => void;
};

const Contexte = createContext<ContexteToasts | null>(null);

export function useToasts(): ContexteToasts {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error("useToasts doit être utilisé sous <FournisseurToasts>.");
  return contexte;
}

const AUCUN_TOAST: Toast[] = [];

function Message({ toast, file }: { toast: Toast; file: FileToasts }) {
  const erreur = toast.type === "erreur";
  return (
    <div
      data-testid="toast"
      data-type={toast.type}
      onMouseEnter={() => file.suspendre(toast.id, "survol")}
      onMouseLeave={() => file.reprendre(toast.id, "survol")}
      onFocus={() => file.suspendre(toast.id, "focus")}
      onBlur={() => file.reprendre(toast.id, "focus")}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg",
        erreur
          ? "border-destructive/30 bg-surface text-destructive"
          : "border-border bg-surface text-foreground",
      )}
    >
      <p className="min-w-0 flex-1 py-0.5 break-words">{toast.message}</p>
      <button
        type="button"
        onClick={() => file.fermer(toast.id)}
        aria-label="Fermer le message"
        className="-my-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

export function FournisseurToasts({ children }: { children: ReactNode }) {
  const [file] = useState(() => new FileToasts());
  const toasts = useSyncExternalStore(file.abonner, file.liste, () => AUCUN_TOAST);
  useEffect(() => () => file.vider(), [file]);

  const valeur = useMemo(() => ({ afficher: file.afficher, fermer: file.fermer }), [file]);
  const reussites = toasts.filter((t) => t.type === "succes");
  const erreurs = toasts.filter((t) => t.type === "erreur");

  return (
    <Contexte.Provider value={valeur}>
      {children}
      <div
        data-testid="zone-toasts"
        className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-6 sm:w-[380px]"
      >
        <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
          {erreurs.map((t) => (
            <Message key={t.id} toast={t} file={file} />
          ))}
        </div>
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {reussites.map((t) => (
            <Message key={t.id} toast={t} file={file} />
          ))}
        </div>
      </div>
    </Contexte.Provider>
  );
}
