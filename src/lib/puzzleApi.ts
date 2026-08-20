import type { ClueCellPlacement, WordEntry } from '../types/puzzle';

/**
 * Graine de génération. Le serveur étant déterministe, deux joueurs d'une
 * même partie (même code de session, même manche) obtiennent exactement la
 * même grille — sans que le serveur ait à stocker quoi que ce soit.
 */
export function seedFor(sessionId: string, round: number): string {
  return `${sessionId}-r${round}`;
}

// Par défaut : même origine. En production c'est la fonction serverless
// `api/puzzle.py` ; en développement, le proxy déclaré dans vite.config.ts
// renvoie /api vers le serveur Python local. Une même URL des deux côtés.
//
// `VITE_PUZZLE_API_URL` ne sert qu'à viser un service hébergé ailleurs. Le
// `.trim()` est indispensable : une variable déclarée mais vide dans .env
// arrive comme chaîne vide, pas comme undefined, donc `??` ne la rattraperait
// pas — et un `||` sur une base vide est justement ce qu'on veut ici.
const configured = import.meta.env.VITE_PUZZLE_API_URL?.trim();
const API_BASE = (configured || '').replace(/\/$/, '');

export interface PuzzlePayload {
  id: string;
  title: string;
  rows: number;
  cols: number;
  words: WordEntry[];
  clue_cells: ClueCellPlacement[];
  stats: { words: number; letters: number; clues: number; dead_clues: number };
  generated_in_ms: number;
}

export async function fetchPuzzle(options: {
  seed: string;
  signal?: AbortSignal;
}): Promise<PuzzlePayload> {
  const params = new URLSearchParams({ seed: options.seed });

  const response = await fetch(`${API_BASE}/api/puzzle?${params}`, {
    signal: options.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Serveur de grilles: ${response.status} ${detail}`.trim());
  }
  return (await response.json()) as PuzzlePayload;
}
