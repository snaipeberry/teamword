import type { Arrow, ClueCellData } from '../types/puzzle';

/**
 * Glyphe et bord de rattachement de chaque flèche.
 *
 * `edge` désigne le côté de la case-indice où se trouve la PREMIÈRE LETTRE
 * du mot — c'est là que la flèche doit pointer. Pour les flèches coudées,
 * ce côté ne coïncide pas avec le sens de lecture, d'où le glyphe distinct :
 * ↳ « je descends puis je lis vers la droite », ↴ « je vais à droite puis
 * je lis vers le bas ».
 */
const ARROW_SPEC: Record<Arrow, { glyph: string; edge: 'right' | 'bottom' }> = {
  right: { glyph: '▶', edge: 'right' },
  down: { glyph: '▼', edge: 'bottom' },
  down_right: { glyph: '↳', edge: 'bottom' },
  right_down: { glyph: '↴', edge: 'right' },
};

interface ClueCellProps {
  data: ClueCellData;
  solvedWordIds: Set<string>;
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

export function ClueCell({ data, solvedWordIds }: ClueCellProps) {
  const isDouble = data.clues.length > 1;

  // Les flèches sont en position absolue : sans gouttière réservée de leur
  // côté, elles se posaient par-dessus la fin du texte (« funérair▶ »).
  // C'est le BORD de la flèche qui compte, pas le sens de lecture du mot :
  // une coudée ↴ se lit verticalement mais s'affiche sur le bord droit.
  const edges = data.clues.map((c) => ARROW_SPEC[c.arrow ?? c.direction].edge);
  const hasRight = edges.includes('right');
  const hasDown = edges.includes('bottom');

  const totalChars = data.clues.reduce((n, c) => n + c.text.length, 0);

  return (
    <div
      // `lang` est requis pour que le navigateur applique la césure FRANÇAISE
      // (hyphens:auto sans lang ne coupe rien).
      lang="fr"
      className={[
        'relative flex h-full w-full flex-col items-center justify-center overflow-hidden',
        'border border-cell-border/50 text-center font-clue font-bold',
        'leading-[1.1] text-neutral-800 hyphens-auto [overflow-wrap:anywhere]',
        fontSizeFor(totalChars, data.clues.length),
        hasRight ? 'pl-[2px] pr-[8px]' : 'px-[2px]',
        hasDown ? 'pb-[7px] pt-[1px]' : 'py-[1px]',
        isDouble ? 'bg-gradient-to-br from-clue-accent to-amber-200' : 'bg-clue',
      ].join(' ')}
    >
      {data.clues.map((clue, i) => {
        const solved = solvedWordIds.has(clue.wordId);
        return (
          <span
            key={i}
            className={[
              'w-full transition-opacity duration-300',
              // Trait de séparation : sans lui, deux définitions empilées se
              // lisent comme une seule phrase.
              i > 0 ? 'mt-[2px] border-t border-neutral-500/30 pt-[2px]' : '',
              solved ? 'text-emerald-700 opacity-50 line-through decoration-emerald-600' : '',
            ].join(' ')}
          >
            {clue.text}
          </span>
        );
      })}

      {data.clues.map((clue, i) => {
        const spec = ARROW_SPEC[clue.arrow ?? clue.direction];
        const bent = spec.glyph === '↳' || spec.glyph === '↴';
        return (
          <span
            key={`arrow-${i}`}
            aria-hidden="true"
            className={[
              'pointer-events-none absolute leading-none transition-opacity duration-300',
              // Les coudées portent plus d'information : on les rend un peu
              // plus grandes et plus contrastées pour qu'on les distingue
              // d'un coup d'œil des flèches droites.
              bent ? 'text-[9px] font-bold text-rose-500' : 'text-[7px] text-neutral-500',
              solvedWordIds.has(clue.wordId) ? 'opacity-30' : '',
              spec.edge === 'right'
                ? 'right-[1px] top-1/2 -translate-y-1/2'
                : 'bottom-[1px] left-1/2 -translate-x-1/2',
            ].join(' ')}
          >
            {spec.glyph}
          </span>
        );
      })}
    </div>
  );
}
