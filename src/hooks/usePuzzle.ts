import { useEffect, useState } from 'react';
import { buildGrid } from '../lib/gridBuilder';
import { demoPuzzle } from '../data/demoPuzzle';
import { fetchPuzzle } from '../lib/puzzleApi';
import type { Puzzle } from '../types/puzzle';

interface UsePuzzleResult {
  puzzle: Puzzle | null;
  loading: boolean;
  error: string | null;
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
export function usePuzzle(seed: string): UsePuzzleResult {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchPuzzle({ seed, signal: controller.signal })
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
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        // Le jeu reste jouable hors ligne / serveur éteint : on retombe sur
        // la grille de démonstration embarquée.
        setError(err instanceof Error ? err.message : String(err));
        setPuzzle(demoPuzzle);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [seed]);

  return { puzzle, loading, error };
}
