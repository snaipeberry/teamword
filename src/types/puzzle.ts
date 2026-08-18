export type Direction = 'right' | 'down';

export interface ClueEntry {
  text: string;
  direction: Direction;
  /** Which word this clue resolves — lets the UI mark it solved once that word is locked. */
  wordId: string;
}

export interface ClueCellData {
  type: 'clue';
  clues: ClueEntry[];
}

export interface LetterCellData {
  type: 'letter';
  answer: string;
  wordIds: string[];
}

export interface BlankCellData {
  type: 'blank';
}

export type Cell = ClueCellData | LetterCellData | BlankCellData;

export interface WordEntry {
  id: string;
  direction: Direction;
  clue: string;
  startRow: number;
  startCol: number;
  length: number;
  answer: string;
}

export interface ClueCellPlacement {
  row: number;
  col: number;
  clues: ClueEntry[];
}

export interface Puzzle {
  id: string;
  title: string;
  rows: number;
  cols: number;
  grid: Cell[][];
  words: WordEntry[];
}
