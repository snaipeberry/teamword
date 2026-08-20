export type Direction = 'right' | 'down';

/**
 * Type de flèche, au sens des vraies grilles de mots fléchés.
 *
 * Droites — l'indice est collé au mot, dans son axe :
 *   'right'      →   indice à gauche,    mot horizontal
 *   'down'       ↓   indice au-dessus,   mot vertical
 *
 * Coudées — l'indice est perpendiculaire à la lecture du mot. Elles servent
 * à libérer les bords : sans elles, la colonne 0 ne peut jamais démarrer un
 * mot horizontal (aucune case à sa gauche pour poser l'indice), ni la ligne 0
 * un mot vertical.
 *   'down_right' ↳   indice au-dessus,   mot horizontal
 *   'right_down' ↴   indice à gauche,    mot vertical
 */
export type Arrow = 'right' | 'down' | 'down_right' | 'right_down';

export interface ClueEntry {
  text: string;
  direction: Direction;
  /** Which word this clue resolves — lets the UI mark it solved once that word is locked. */
  wordId: string;
  /** Absente = flèche droite, déduite de `direction`. */
  arrow?: Arrow;
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
