import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { Arrow, WordEntry } from '../types/puzzle';

const ARROW_GLYPH: Record<Arrow, string> = {
  right: '▶',
  down: '▼',
  down_right: '↳',
  right_down: '↴',
};

export interface ClueSlot {
  ch: string;
  locked: boolean;
}

/**
 * Rappel de la définition en cours, dans la rangée d'actions.
 *
 * Dans la grille, une définition est écrite en 6 à 9 px pour tenir dans sa
 * case : lisible pour se repérer, pénible pour réfléchir. La reprendre ici en
 * grand évite de plisser les yeux pendant la saisie.
 *
 * Deux niveaux : la pilule reste dans la rangée d'actions (pas de hauteur
 * supplémentaire prise à la grille), un tap l'ouvre en carte plein écran
 * pour lire au calme. Les chevrons changent de mot SANS ouvrir la carte —
 * les deux gestes sont indépendants, comme dans la maquette Organic.
 */
export function ActiveClueBar({
  word,
  arrow,
  filled,
  slots,
  onPrev,
  onNext,
}: {
  word: WordEntry | null;
  arrow: Arrow | null;
  filled: number;
  slots: ClueSlot[];
  onPrev: () => void;
  onNext: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Le mot actif a pu changer depuis l'extérieur (tap direct sur une case
  // d'un autre mot pendant que la carte était ouverte) : elle ne doit pas
  // rester ouverte sur un contenu qui ne correspond plus à rien.
  useEffect(() => setOpen(false), [word?.id]);

  if (!word) return null;

  return (
    <>
      <motion.div
        key={word.id}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        // `min-w-0` autorise la troncature : sans lui, une définition longue
        // pousserait les boutons hors de l'écran.
        className="flex min-w-0 flex-1 items-stretch gap-1 rounded-[20px] border border-organic-accent-200 bg-organic-accent-100 px-1 py-1"
      >
        <button
          type="button"
          onClick={onPrev}
          aria-label="Définition précédente"
          className="w-6 shrink-0 font-bold text-organic-accent-700 active:text-organic-accent-500"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-organic-accent-700">
            {arrow && <span aria-hidden="true">{ARROW_GLYPH[arrow]}</span>}
            {filled}/{word.length}
          </span>
          <span className="block truncate font-clue text-[13px] font-bold leading-tight text-organic-text">
            {word.clue}
          </span>
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Définition suivante"
          className="w-6 shrink-0 font-bold text-organic-accent-700 active:text-organic-accent-500"
        >
          ›
        </button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-end justify-center bg-organic-neutral-900/50 p-5"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded-[28px] bg-organic-bg p-6 shadow-lg"
            >
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-organic-accent-700">
                {arrow && <span aria-hidden="true">{ARROW_GLYPH[arrow]}</span>}
                {word.length} lettres · {word.direction === 'right' ? 'horizontal' : 'vertical'}
              </p>
              <p className="mt-2 font-display text-[27px] leading-tight text-organic-text">{word.clue}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {slots.map((s, i) => (
                  <span
                    key={i}
                    className={`flex h-11 w-9 items-center justify-center rounded-lg text-[20px] font-bold ${
                      s.locked
                        ? 'bg-organic-accent2-200 text-organic-accent2-900'
                        : 'border border-organic-neutral-300 bg-organic-neutral-100 text-organic-text'
                    }`}
                  >
                    {s.ch}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-5 w-full rounded-full bg-organic-accent-500 py-3.5 font-display text-[15px] text-organic-bg shadow-md active:bg-organic-accent-600"
              >
                Continuer
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
