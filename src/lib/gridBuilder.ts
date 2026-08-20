import type { Arrow, Cell, ClueCellPlacement, Direction, WordEntry } from '../types/puzzle';

/**
 * Pour chaque flèche : dans quel sens le mot se lit, et où se trouve sa
 * première lettre par rapport à la case-indice.
 */
const ARROW_SPEC: Record<Arrow, { reads: Direction; startOffset: [number, number] }> = {
  right: { reads: 'right', startOffset: [0, 1] },
  down: { reads: 'down', startOffset: [1, 0] },
  down_right: { reads: 'right', startOffset: [1, 0] },
  right_down: { reads: 'down', startOffset: [0, 1] },
};

/**
 * Assembles a grid from word placements + clue-cell placements, validating
 * that any two words sharing a cell agree on the letter there. Puzzle
 * authoring (here or from Supabase) works in this word-list shape rather
 * than a hand-drawn 2D array, since the array is easy to get subtly wrong.
 */
export function buildGrid(
  rows: number,
  cols: number,
  words: WordEntry[],
  clueCells: ClueCellPlacement[],
): Cell[][] {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (): Cell => ({ type: 'blank' })),
  );

  for (const placement of clueCells) {
    grid[placement.row][placement.col] = { type: 'clue', clues: placement.clues };
  }

  const wordsById = new Map(words.map((w) => [w.id, w]));
  for (const placement of clueCells) {
    for (const clue of placement.clues) {
      const word = wordsById.get(clue.wordId);
      if (!word) {
        throw new Error(`Clue at (${placement.row}, ${placement.col}) references unknown word "${clue.wordId}"`);
      }
      // Une flèche coudée place l'indice PERPENDICULAIREMENT au mot : la
      // case de départ et le sens de lecture ne se déduisent donc plus l'un
      // de l'autre, c'est la flèche qui porte les deux informations.
      const arrow = clue.arrow ?? clue.direction;
      const spec = ARROW_SPEC[arrow];
      if (!spec) {
        throw new Error(`Clue at (${placement.row}, ${placement.col}) has unknown arrow "${arrow}"`);
      }
      if (word.direction !== spec.reads) {
        throw new Error(
          `Clue at (${placement.row}, ${placement.col}) has arrow "${arrow}" (mot ${spec.reads}) but word "${clue.wordId}" runs "${word.direction}"`,
        );
      }
      const expectedRow = placement.row + spec.startOffset[0];
      const expectedCol = placement.col + spec.startOffset[1];
      if (word.startRow !== expectedRow || word.startCol !== expectedCol) {
        throw new Error(
          `Clue at (${placement.row}, ${placement.col}) with arrow "${arrow}" expects word "${clue.wordId}" ` +
            `to start at (${expectedRow}, ${expectedCol}) but it starts at (${word.startRow}, ${word.startCol})`,
        );
      }
    }
  }

  for (const word of words) {
    if (word.answer.length !== word.length) {
      throw new Error(`Word ${word.id}: answer length does not match declared length`);
    }
    for (let i = 0; i < word.length; i++) {
      const row = word.direction === 'down' ? word.startRow + i : word.startRow;
      const col = word.direction === 'right' ? word.startCol + i : word.startCol;
      if (row >= rows || col >= cols) {
        throw new Error(`Word ${word.id}: cell (${row}, ${col}) is outside the grid`);
      }
      const letter = word.answer[i];
      const existing = grid[row][col];
      if (existing.type === 'clue') {
        throw new Error(`Word ${word.id}: cell (${row}, ${col}) collides with a clue cell`);
      }
      if (existing.type === 'letter') {
        if (existing.answer !== letter) {
          throw new Error(
            `Word ${word.id}: cell (${row}, ${col}) expects "${letter}" but another word placed "${existing.answer}"`,
          );
        }
        existing.wordIds.push(word.id);
      } else {
        grid[row][col] = { type: 'letter', answer: letter, wordIds: [word.id] };
      }
    }
  }

  return grid;
}
