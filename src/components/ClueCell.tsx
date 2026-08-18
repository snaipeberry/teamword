import type { ClueCellData } from '../types/puzzle';

const ARROW: Record<'right' | 'down', string> = { right: '▶', down: '▼' };

interface ClueCellProps {
  data: ClueCellData;
  solvedWordIds: Set<string>;
}

export function ClueCell({ data, solvedWordIds }: ClueCellProps) {
  const isDouble = data.clues.length > 1;

  return (
    <div
      className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 border border-cell-border/50 px-1 py-0.5 text-center font-clue text-[clamp(7px,2.1vw,10px)] font-bold leading-[1.1] text-neutral-800 ${
        isDouble ? 'bg-gradient-to-br from-clue-accent to-amber-200' : 'bg-clue'
      }`}
    >
      {data.clues.map((clue, i) => {
        const solved = solvedWordIds.has(clue.wordId);
        return (
          <span
            key={i}
            className={`line-clamp-3 transition-opacity duration-300 ${
              solved ? 'text-emerald-700 opacity-50 line-through decoration-emerald-600' : ''
            }`}
          >
            {clue.text}
          </span>
        );
      })}
      {data.clues.map((clue, i) => (
        <span
          key={`arrow-${i}`}
          aria-hidden="true"
          className={`pointer-events-none absolute text-neutral-500 transition-opacity duration-300 ${
            solvedWordIds.has(clue.wordId) ? 'opacity-30' : ''
          } ${clue.direction === 'right' ? 'right-0.5 top-1/2 -translate-y-1/2' : 'bottom-0 left-1/2 -translate-x-1/2'}`}
        >
          {ARROW[clue.direction]}
        </span>
      ))}
    </div>
  );
}
