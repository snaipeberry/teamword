import type { ClueCellPlacement, WordEntry } from '../types/puzzle';

/**
 * Graine de génération. Le serveur étant déterministe, deux joueurs d'une
 * même partie (même code de session, même manche) obtiennent exactement la
 * même grille — sans que le serveur ait à stocker quoi que ce soit.
 */
export function seedFor(sessionId: string, round: number): string {
  return `${sessionId}-r${round}`;
}

// `??` ne suffit pas : une variable déclarée mais vide dans .env
// (`VITE_PUZZLE_API_URL=`) arrive comme chaîne vide, ce qui rendrait l'URL
// relative — la requête partirait alors vers le serveur de dev, qui répond
// index.html à toute route inconnue (donc une erreur JSON très obscure).
const configured = import.meta.env.VITE_PUZZLE_API_URL?.trim();
const API_URL = (configured || 'http://127.0.0.1:8787').replace(/\/$/, '');

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

  const response = await fetch(`${API_URL}/puzzle?${params}`, { signal: options.signal });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Serveur de grilles: ${response.status} ${detail}`.trim());
  }
  return (await response.json()) as PuzzlePayload;
}
