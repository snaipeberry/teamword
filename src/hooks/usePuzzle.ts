import { useEffect, useState } from 'react';
import { supabase, hasSupabaseConfig } from '../lib/supabaseClient';
import { buildGrid } from '../lib/gridBuilder';
import { demoPuzzle } from '../data/demoPuzzle';
import type { ClueCellPlacement, Puzzle, WordEntry } from '../types/puzzle';

interface PuzzleRow {
  id: string;
  title: string;
  rows: number;
  cols: number;
  words: WordEntry[];
  clue_cells: ClueCellPlacement[];
}

interface UsePuzzleResult {
  puzzle: Puzzle | null;
  loading: boolean;
  error: string | null;
}

/** Falls back to the bundled demo puzzle whenever Supabase isn't configured or the fetch fails. */
export function usePuzzle(puzzleId: string): UsePuzzleResult {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(hasSupabaseConfig ? null : demoPuzzle);
  const [loading, setLoading] = useState(hasSupabaseConfig);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) return;

    let cancelled = false;
    setLoading(true);

    supabase
      .from('puzzles')
      .select('id, title, rows, cols, words, clue_cells')
      .eq('id', puzzleId)
      .single()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'Grille introuvable');
          setPuzzle(demoPuzzle);
        } else {
          const row = data as PuzzleRow;
          setPuzzle({
            id: row.id,
            title: row.title,
            rows: row.rows,
            cols: row.cols,
            words: row.words,
            grid: buildGrid(row.rows, row.cols, row.words, row.clue_cells),
          });
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [puzzleId]);

  return { puzzle, loading, error };
}
