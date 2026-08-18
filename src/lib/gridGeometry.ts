import type { WordEntry } from '../types/puzzle';

export function cellId(row: number, col: number): string {
  return `${row}-${col}`;
}

export function wordCellIds(word: WordEntry): string[] {
  return Array.from({ length: word.length }, (_, i) =>
    word.direction === 'right' ? cellId(word.startRow, word.startCol + i) : cellId(word.startRow + i, word.startCol),
  );
}
