import { motion } from 'framer-motion';
import type { Arrow, WordEntry } from '../types/puzzle';

const ARROW_GLYPH: Record<Arrow, string> = {
  right: '▶',
  down: '▼',
  down_right: '↳',
  right_down: '↴',
};

/**
 * Rappel de la définition en cours, dans la rangée d'actions.
 *
 * Dans la grille, une définition est écrite en 6 à 9 px pour tenir dans sa
 * case : lisible pour se repérer, pénible pour réfléchir. La reprendre ici en
 * grand évite de plisser les yeux pendant la saisie.
 *
 * Elle partage la ligne des boutons plutôt que d'occuper la sienne : une
 * rangée supplémentaire prendrait de la hauteur à la grille, qui est
 * dimensionnée sur la place restante.
 */
export function ActiveClueBar({
  word,
  arrow,
  filled,
}: {
  word: WordEntry | null;
  arrow: Arrow | null;
  filled: number;
}) {
  if (!word) return null;

  return (
    <motion.div
      key={word.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15 }}
      // `min-w-0` autorise la troncature : sans lui, une définition longue
      // pousserait les boutons hors de l'écran.
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2.5 py-1.5 shadow-lg backdrop-blur-md"
    >
      {arrow && (
        <span aria-hidden="true" className="shrink-0 text-[11px] text-white/70">
          {ARROW_GLYPH[arrow]}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-clue text-[13px] font-bold leading-tight text-white">
        {word.clue}
      </span>
      <span className="shrink-0 font-display text-[10px] font-bold tabular-nums text-white/70">
        {filled}/{word.length}
      </span>
    </motion.div>
  );
}
