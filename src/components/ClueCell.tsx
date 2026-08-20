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
  solvedWordIds: Set<string>;
  activeWordId: string | null;
  onSelectWord: (wordId: string) => void;
}

/**
 * Taille de police adaptée au contenu : une définition courte s'affiche
 * confortablement, une longue doit se resserrer pour tenir dans une case de
 * ~46 px de côté sur téléphone.
 *
 * Le nombre de définitions compte autant que leur longueur : une case double
 * doit loger deux blocs ET un séparateur, donc à nombre de caractères égal
 * il lui faut une police plus petite (sans ce supplément, les cases doubles
 * débordaient).
 */
function fontSizeFor(totalChars: number, clueCount: number): string {
  const budget = totalChars + (clueCount > 1 ? 12 : 0);
  if (budget > 32) return 'text-[clamp(5px,1.7vw,7.5px)]';
  if (budget > 24) return 'text-[clamp(5.5px,1.85vw,8.5px)]';
  if (budget > 14) return 'text-[clamp(6px,2.05vw,9px)]';
  return 'text-[clamp(7px,2.5vw,10.5px)]';
}

export function ClueCell({
  data,
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
        fontSizeFor(totalChars, data.clues.length),
        isDouble ? 'bg-gradient-to-br from-clue-accent to-amber-200' : 'bg-clue',
      ].join(' ')}
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
