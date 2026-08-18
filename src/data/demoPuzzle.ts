import { buildGrid } from '../lib/gridBuilder';
import type { ClueCellPlacement, Puzzle, WordEntry } from '../types/puzzle';

const words: WordEntry[] = [
  {
    id: 'lion',
    direction: 'right',
    clue: 'Roi des animaux',
    startRow: 1,
    startCol: 1,
    length: 4,
    answer: 'LION',
  },
  {
    id: 'oeuf',
    direction: 'down',
    clue: 'Produit par la poule',
    startRow: 1,
    startCol: 3,
    length: 4,
    answer: 'OEUF',
  },
  {
    id: 'nez',
    direction: 'down',
    clue: "Organe de l'odorat",
    startRow: 1,
    startCol: 4,
    length: 3,
    answer: 'NEZ',
  },
  {
    id: 'os',
    direction: 'right',
    clue: 'Il y en a 206 dans le corps humain',
    startRow: 3,
    startCol: 1,
    length: 2,
    answer: 'OS',
  },
  {
    id: 'ami',
    direction: 'down',
    clue: 'Copain',
    startRow: 4,
    startCol: 0,
    length: 3,
    answer: 'AMI',
  },
];

const clueCells: ClueCellPlacement[] = [
  { row: 1, col: 0, clues: [{ text: 'Roi des animaux', direction: 'right', wordId: 'lion' }] },
  { row: 0, col: 3, clues: [{ text: 'Produit par la poule', direction: 'down', wordId: 'oeuf' }] },
  { row: 0, col: 4, clues: [{ text: "Organe de l'odorat", direction: 'down', wordId: 'nez' }] },
  {
    row: 3,
    col: 0,
    clues: [
      { text: 'Il y en a 206 dans le corps humain', direction: 'right', wordId: 'os' },
      { text: 'Copain', direction: 'down', wordId: 'ami' },
    ],
  },
];

const ROWS = 7;
const COLS = 5;

export const demoPuzzle: Puzzle = {
  id: 'demo',
  title: 'Grille de démonstration',
  rows: ROWS,
  cols: COLS,
  grid: buildGrid(ROWS, COLS, words, clueCells),
  words,
};
