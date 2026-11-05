"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type TransitionStartFunction,
} from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  CANAUX,
  LIBELLES_CANAL,
  LIBELLES_PRIORITE,
  LIBELLES_STATUT,
  PRIORITES,
  STATUTS,
} from "@/lib/domaine";
import {
  LONGUEUR_MAX_RECHERCHE,
  RESPONSABLE_AUCUN,
  RESPONSABLE_MOI,
  aDesFiltres,
  adresseListe,
  lireRecherche,
  type CleFiltre,
  type Filtres,
  type OptionFiltre,
} from "@/lib/filtres";

// Barre de recherche et de filtres de la liste (story 2.5, EXPERIENCE.md §4,
// §9.4, maquette key-liste-demandes.html) :
//   - recherche lancée 300 ms après la dernière frappe, ou à l'appui sur Entrée ;
//   - cinq listes : Statut, Priorité, Catégorie, Canal, Responsable ;
//   - « Effacer les filtres » dès qu'un filtre est actif.
// Chaque changement écrit l'adresse (lib/filtres.ts, page 1) par une
// navigation côté navigateur, sans recharger la page :
//   - recherche après la pause de frappe : `router.replace` (pas une entrée
//     d'historique par pause) ;
//   - Entrée, listes, « Effacer les filtres » : `router.push` (le bouton
//     retour du navigateur revient aux filtres précédents).
// Les listes affichent le choix tout de suite (`useOptimistic`) ; pendant la
// lecture, la zone des résultats porte `aria-busy` (`ZoneFiltres`,
// `ResultatsFiltres`).
// Zone de recherche et adresse : la zone garde ce que la personne tape. Elle
// reprend le texte de l'adresse seulement quand l'adresse change sans passer
// par la barre (retour arrière, lien « Effacer les filtres » de la liste
// vide), et seulement si aucune frappe n'attend d'être cherchée ; une
// recherche encore en attente est alors annulée.

export const DELAI_RECHERCHE_MS = 300;

const PLACEHOLDER_RECHERCHE = "Rechercher une référence, un nom, une société, un email, un objet…";

const LISTE_INDISPONIBLE = "Liste indisponible";

const CLASSE_LISTE =
  "w-full [&_select]:h-11 [&_select]:rounded-md [&_select]:bg-surface [&_select]:pl-3 [&_select]:text-[15px]";

const CLASSE_LIBELLE = "mb-1.5 block text-[13px] font-medium text-muted-foreground";

const CLASSE_EFFACER =
  "inline-flex h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-2 outline-none hover:text-primary-hover focus-visible:ring-3 focus-visible:ring-ring/50";

// Lecture en cours, partagée par la barre et la zone des résultats.
type Lecture = { enCours: boolean; demarrer: TransitionStartFunction };
const ContexteLecture = createContext<Lecture | null>(null);

/** Enveloppe la barre et les résultats : une seule lecture en cours à la fois. */
export function ZoneFiltres({ children }: { children: ReactNode }) {
  const [enCours, demarrer] = useTransition();
  return <ContexteLecture value={{ enCours, demarrer }}>{children}</ContexteLecture>;
}

/** Résultats (tableau, pagination, état vide), `aria-busy` pendant la lecture. */
export function ResultatsFiltres({ children }: { children: ReactNode }) {
  const lecture = useContext(ContexteLecture);
  return (
    <div data-testid="resultats" aria-busy={lecture?.enCours || undefined}>
      {children}
    </div>
  );
}

type Choix = { valeur: string; texte: string; disabled?: boolean };

type Props = {
  /** Adresse de la liste (`/equipe/demandes`). */
  chemin: string;
  /** Filtres lus dans l'adresse (déjà validés). */
  filtres: Filtres;
  /** Catégories, ou null si elles n'ont pas pu être lues. */
  categories: OptionFiltre[] | null;
  /** Membres, ou null s'ils n'ont pas pu être lus. */
  membres: OptionFiltre[] | null;
};

/**
 * Choix d'une liste lue en base. Liste illisible : « Liste indisponible »
 * (la valeur de l'adresse reste choisie). Valeur absente d'une liste lue
 * (catégorie effacée…) : `introuvable`.
 */
function choixLus(
  options: OptionFiltre[] | null,
  valeur: string | undefined,
  feminin: boolean,
  introuvable: string,
): Choix[] {
  if (options === null) {
    return valeur
      ? [{ valeur, texte: LISTE_INDISPONIBLE }]
      : [{ valeur: "indisponible", texte: LISTE_INDISPONIBLE, disabled: true }];
  }
  const suffixe = feminin ? " (désactivée)" : " (désactivé)";
  const choix = options.map((o) => ({
    valeur: o.id,
    texte: o.desactive ? `${o.nom}${suffixe}` : o.nom,
  }));
  if (valeur && valeur !== RESPONSABLE_AUCUN && valeur !== RESPONSABLE_MOI) {
    if (!choix.some((c) => c.valeur === valeur)) choix.push({ valeur, texte: introuvable });
  }
  return choix;
}

function Liste({
  cle,
  libelle,
  valeur,
  choix,
  changer,
}: {
  cle: CleFiltre;
  libelle: string;
  valeur: string | undefined;
  choix: Choix[];
  changer: (cle: CleFiltre, valeur: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 sm:w-44">
      <label htmlFor={id} className={CLASSE_LIBELLE}>
        {libelle}
      </label>
      <NativeSelect
        id={id}
        value={valeur ?? ""}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => changer(cle, e.target.value)}
        data-testid={`filtre-${cle}`}
        className={CLASSE_LISTE}
      >
        {choix.map((c) => (
          <NativeSelectOption key={c.valeur} value={c.valeur} disabled={c.disabled}>
            {c.texte}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

export function FiltresDemandes({ chemin, filtres, categories, membres }: Props) {
  const router = useRouter();
  const lecture = useContext(ContexteLecture);
  const [, demarrerLocal] = useTransition();
  const demarrer = lecture?.demarrer ?? demarrerLocal;
  const idRecherche = useId();
  const champ = useRef<HTMLInputElement>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filtres affichés : ceux de l'adresse, ou le dernier choix pendant la lecture.
  const [affiches, afficher] = useOptimistic(filtres);

  // Zone de recherche. `suivi.q` : dernier texte vu dans l'adresse ;
  // `suivi.envoye` : dernier texte écrit dans l'adresse par la barre ;
  // `suivi.externes` : nombre de changements venus d'ailleurs. `edition` :
  // une frappe attend d'être cherchée.
  const qAdresse = filtres.q ?? "";
  const [texte, setTexte] = useState(qAdresse);
  const [edition, setEdition] = useState(false);
  const [suivi, setSuivi] = useState({ q: qAdresse, envoye: qAdresse, externes: 0 });
  if (qAdresse !== suivi.q) {
    const externe = qAdresse !== suivi.envoye;
    setSuivi({
      q: qAdresse,
      envoye: externe ? qAdresse : suivi.envoye,
      externes: suivi.externes + (externe ? 1 : 0),
    });
    if (externe) {
      if (!edition) setTexte(qAdresse);
      setEdition(false);
    }
  }

  // Changement venu d'ailleurs : la recherche en attente est annulée (elle
  // déferait le retour arrière). Vérifié aussi au déclenchement du minuteur.
  const externes = useRef(suivi.externes);
  useEffect(() => {
    externes.current = suivi.externes;
    if (minuteur.current) {
      clearTimeout(minuteur.current);
      minuteur.current = null;
    }
  }, [suivi.externes]);

  useEffect(
    () => () => {
      if (minuteur.current) clearTimeout(minuteur.current);
    },
    [],
  );

  function annulerMinuteur() {
    if (minuteur.current) {
      clearTimeout(minuteur.current);
      minuteur.current = null;
    }
  }

  /** Écrit les filtres dans l'adresse (page 1). */
  function naviguer(nouveaux: Filtres, mode: "push" | "replace") {
    annulerMinuteur();
    setEdition(false);
    const q = nouveaux.q ?? "";
    setSuivi((actuel) => ({ ...actuel, envoye: q }));
    demarrer(() => {
      afficher(nouveaux);
      const adresse = adresseListe(chemin, nouveaux);
      if (mode === "replace") router.replace(adresse);
      else router.push(adresse);
    });
  }

  function chercher(saisie: string, mode: "push" | "replace") {
    const q = lireRecherche(saisie);
    if (q === affiches.q) {
      setEdition(false);
      return;
    }
    naviguer({ ...affiches, q }, mode);
  }

  function saisir(evenement: ChangeEvent<HTMLInputElement>) {
    const saisie = evenement.target.value;
    setTexte(saisie);
    setEdition(true);
    annulerMinuteur();
    const depart = suivi.externes;
    minuteur.current = setTimeout(() => {
      minuteur.current = null;
      // L'adresse a changé d'ailleurs entre-temps : rien n'est lancé.
      if (externes.current !== depart) {
        setEdition(false);
        return;
      }
      chercher(saisie, "replace");
    }, DELAI_RECHERCHE_MS);
  }

  function valider(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    annulerMinuteur();
    chercher(texte, "push");
  }

  function changer(cle: CleFiltre, valeur: string) {
    // Le texte tapé (même pas encore cherché) part avec le filtre.
    naviguer(
      { ...affiches, q: lireRecherche(texte), [cle]: valeur === "" ? undefined : valeur },
      "push",
    );
  }

  function effacer() {
    setTexte("");
    naviguer({}, "push");
    // Le bouton disparaît : le focus revient à la zone de recherche.
    champ.current?.focus();
  }

  const choixStatut: Choix[] = [
    { valeur: "", texte: "Tous" },
    { valeur: "non_traitees", texte: "Non traitées" },
    ...STATUTS.map((s) => ({ valeur: s, texte: LIBELLES_STATUT[s] })),
  ];
  const choixPriorite: Choix[] = [
    { valeur: "", texte: "Toutes" },
    ...PRIORITES.map((p) => ({ valeur: p, texte: LIBELLES_PRIORITE[p] })),
  ];
  const choixCategorie: Choix[] = [
    { valeur: "", texte: "Toutes" },
    ...choixLus(categories, affiches.categorie, true, "Catégorie introuvable"),
  ];
  const choixCanal: Choix[] = [
    { valeur: "", texte: "Tous" },
    ...CANAUX.map((c) => ({ valeur: c, texte: LIBELLES_CANAL[c] })),
  ];
  const choixResponsable: Choix[] = [
    { valeur: "", texte: "Tous" },
    { valeur: RESPONSABLE_AUCUN, texte: "Sans responsable" },
    { valeur: RESPONSABLE_MOI, texte: "Mes demandes" },
    ...choixLus(membres, affiches.responsable, false, "Membre introuvable"),
  ];

  return (
    <form
      role="search"
      aria-label="Rechercher et filtrer les demandes"
      onSubmit={valider}
      className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3.5 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="min-w-0 sm:flex-[1_1_320px]">
        <label htmlFor={idRecherche} className={CLASSE_LIBELLE}>
          Rechercher
        </label>
        <Input
          ref={champ}
          id={idRecherche}
          type="search"
          value={texte}
          onChange={saisir}
          placeholder={PLACEHOLDER_RECHERCHE}
          maxLength={LONGUEUR_MAX_RECHERCHE}
          autoComplete="off"
          enterKeyHint="search"
          data-testid="filtre-q"
          className="h-11 rounded-md bg-surface px-3 text-[15px] md:text-[15px]"
        />
      </div>
      <Liste cle="statut" libelle="Statut" valeur={affiches.statut} choix={choixStatut} changer={changer} />
      <Liste
        cle="priorite"
        libelle="Priorité"
        valeur={affiches.priorite}
        choix={choixPriorite}
        changer={changer}
      />
      <Liste
        cle="categorie"
        libelle="Catégorie"
        valeur={affiches.categorie}
        choix={choixCategorie}
        changer={changer}
      />
      <Liste cle="canal" libelle="Canal" valeur={affiches.canal} choix={choixCanal} changer={changer} />
      <Liste
        cle="responsable"
        libelle="Responsable"
        valeur={affiches.responsable}
        choix={choixResponsable}
        changer={changer}
      />
      {aDesFiltres(affiches) ? (
        <button type="button" onClick={effacer} className={CLASSE_EFFACER}>
          Effacer les filtres
        </button>
      ) : null}
    </form>
  );
}
