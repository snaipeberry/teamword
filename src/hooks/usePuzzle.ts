import { useEffect, useRef, useState } from 'react';
import { buildGrid } from '../lib/gridBuilder';
import { demoPuzzle } from '../data/demoPuzzle';
import { fetchPuzzle } from '../lib/puzzleApi';
import type { HintDistribution, MultiplayerGrade } from '../lib/difficulty';
import type { Puzzle } from '../types/puzzle';

/** Au-delà, on cesse d'attendre le serveur de grilles. Large à dessein :
 *  fabriquer une grille 10x10 prend déjà plusieurs secondes en temps normal. */
const DELAI_MAX_MS = 20_000;

interface UsePuzzleResult {
  puzzle: Puzzle | null;
  loading: boolean;
  error: string | null;
}

interface UsePuzzleOptions {
  hints?: HintDistribution;
  /** Niveau du joueur : pilote la complexité des mots retenus. */
  difficulty?: MultiplayerGrade;
  /** Tant que `false`, aucun fetch n'est déclenché — utilisé en solo, où la
   *  répartition dépend du palier du joueur, connu seulement une fois son
   *  profil chargé (voir Round dans App.tsx). Vrai par défaut : les autres
   *  modes n'ont rien à attendre avant de savoir quelle grille demander. */
  ready?: boolean;
}

/**
 * Récupère une grille auprès du serveur de remplissage.
 *
 * Le serveur ne fait que remplir des squelettes pré-construits, et il est
 * déterministe pour une graine donnée : les deux joueurs d'une partie
 * appellent chacun le service et obtiennent la même grille.
 *
 * On lui demande `words` + `clue_cells` plutôt qu'une grille toute faite,
 * pour que `buildGrid` la reconstruise côté client — il revalide au passage
 * l'adjacence indice/mot et la cohérence des croisements.
 */
export function usePuzzle(seed: string, options: UsePuzzleOptions = {}): UsePuzzleResult {
  const { hints, difficulty, ready = true } = options;
  // Distingue notre échéance de l'abandon provoqué par un démontage : le
  // premier doit basculer sur la grille de repli, le second ne doit rien
  // faire du tout.
  const echeanceAtteinte = useRef(false);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Les poids se comparent par valeur, pas par référence : un objet recréé à
  // chaque rendu avec les mêmes nombres ne doit pas redéclencher un fetch.
  const hintsKey = hints ? `${hints.facile},${hints.moyen},${hints.difficile}` : '';

  useEffect(() => {
    if (!ready) {
      setLoading(true);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    // Une grille se fabrique côté serveur : sur une connexion moyenne, ou un
    // service qui rame, l'attente était sans fin ET sans mot. On coupe au
    // bout d'un délai généreux — la grille de démonstration embarquée prend
    // alors le relais, ce qui vaut toujours mieux qu'un point qui pulse.
    echeanceAtteinte.current = false;
    const echeance = setTimeout(() => {
      echeanceAtteinte.current = true;
      controller.abort();
    }, DELAI_MAX_MS);

    setLoading(true);
    setError(null);

    fetchPuzzle({ seed, hints, difficulty, signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        setPuzzle({
          id: payload.id,
          title: payload.title,
          rows: payload.rows,
          cols: payload.cols,
          words: payload.words,
          grid: buildGrid(payload.rows, payload.cols, payload.words, payload.clue_cells),
        });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Un abandon déclenché par NOTRE échéance doit aboutir au repli ;
        // celui du démontage, non — il n'y a plus personne pour le voir.
        const abandon = err instanceof Error && err.name === 'AbortError';
        if (abandon && !echeanceAtteinte.current) return;
        // Le jeu reste jouable hors ligne / serveur éteint : on retombe sur
        // la grille de démonstration embarquée.
        setError(err instanceof Error ? err.message : String(err));
        setPuzzle(demoPuzzle);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(echeance);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, ready, hintsKey, difficulty]);

  return { puzzle, loading, error };
}
