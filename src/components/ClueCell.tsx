import type { Arrow, ClueCellData } from '../types/puzzle';

/**
 * Glyphe de chaque flèche. Il porte à lui seul les deux informations : où
 * commence le mot, et dans quel sens il se lit.
 *
 *   ▶  le mot commence à DROITE   et se lit vers la droite
 *   ▼  le mot commence EN DESSOUS et se lit vers le bas
 *   ↳  le mot commence EN DESSOUS et se lit vers la droite  (coudée)
 *   ↴  le mot commence à DROITE   et se lit vers le bas     (coudée)
 */
const ARROW_GLYPH: Record<Arrow, string> = {
  right: '▶',
  down: '▼',
  down_right: '↳',
  right_down: '↴',
};

const BENT: Record<Arrow, boolean> = {
  right: false,
  down: false,
  down_right: true,
  right_down: true,
};

interface ClueCellProps {
  data: ClueCellData;
  /** Côté de la case en pixels — la police s'y rapporte. */
  cellSize: number;
  solvedWordIds: Set<string>;
  activeWordId: string | null;
  onSelectWord: (wordId: string) => void;
}

/**
 * Taille de police, en fraction de la TAILLE DE CASE.
 *
 * Elle était auparavant exprimée en `vw`, donc indexée sur la largeur de
 * l'écran : cela coïncidait avec la case en 8x8, mais plus du tout en 10x10
 * où les cases rétrécissent alors que l'écran ne bouge pas — 40 % des
 * définitions y débordaient. La rapporter à la case rend le réglage valable
 * quelle que soit la taille de grille.
 *
 * Le nombre de définitions compte autant que leur longueur : une case double
 * doit loger deux blocs ET un séparateur, donc à nombre de caractères égal
 * il lui faut une police plus petite.
 */
function fontRatioFor(totalChars: number, clueCount: number): number {
  const budget = totalChars + (clueCount > 1 ? 12 : 0);
  if (budget > 32) return 0.155;
  if (budget > 24) return 0.175;
  if (budget > 14) return 0.19;
  return 0.225;
}

export function ClueCell({
  data,
  cellSize,
  solvedWordIds,
  activeWordId,
  onSelectWord,
}: ClueCellProps) {
  const isDouble = data.clues.length > 1;
  const totalChars = data.clues.reduce((n, c) => n + c.text.length, 0);

  return (
    <div
      // `lang` est requis pour que le navigateur applique la césure FRANÇAISE
      // (hyphens:auto sans lang ne coupe rien).
      lang="fr"
      className={[
        'flex h-full w-full flex-col items-center justify-center overflow-hidden',
        'border border-cell-border/50 px-[2px] py-[1px] text-center font-clue font-bold',
        'leading-[1.1] text-neutral-800 hyphens-auto [overflow-wrap:anywhere]',
        isDouble ? 'bg-gradient-to-br from-clue-accent to-amber-200' : 'bg-clue',
      ].join(' ')}
      style={{ fontSize: `${(cellSize * fontRatioFor(totalChars, data.clues.length)).toFixed(2)}px` }}
    >
      {data.clues.map((clue, i) => {
        const solved = solvedWordIds.has(clue.wordId);
        const arrow = clue.arrow ?? clue.direction;
        const active = clue.wordId === activeWordId;
        return (
          // Chaque définition est un bouton : c'est le moyen le plus direct de
          // choisir un mot ET son sens de lecture, notamment pour les mots
          // verticaux qu'on ne pouvait sélectionner qu'en tapant deux fois de
          // suite la même case.
          <button
            key={i}
            type="button"
            onClick={() => onSelectWord(clue.wordId)}
            className={[
              'w-full cursor-pointer rounded-[2px] transition-all duration-200',
              i > 0 ? 'mt-[2px] border-t border-neutral-500/30 pt-[2px]' : '',
              active ? 'bg-cell-active/60 ring-1 ring-cyan-500/60' : '',
              solved ? 'text-emerald-700 opacity-50 line-through decoration-emerald-600' : '',
            ].join(' ')}
          >
            {clue.text}
            {/*
              La flèche est rendue DANS le flux de sa propre définition, et
              non plus en position absolue sur un bord de la case.

              Deux raisons, mesurées sur les grilles réelles : 39 % des cases
              à deux définitions avaient leurs deux flèches sur le même bord,
              donc superposées ; et même sans superposition, rien n'indiquait
              quelle flèche appartenait à quelle définition — une définition
              semblait alors ne renvoyer à aucun mot.
            */}
            <span
              aria-hidden="true"
              className={[
                'ml-[2px] inline-block align-baseline leading-none',
                BENT[arrow]
                  ? 'text-[1.15em] font-bold text-rose-600'
                  : 'text-[0.9em] text-neutral-600',
              ].join(' ')}
            >
              {ARROW_GLYPH[arrow]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
