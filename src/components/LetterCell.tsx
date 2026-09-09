import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { PlayerCursor } from '../state/GameState';

interface LetterCellProps {
  value: string;
  isActive: boolean;
  isInActiveWord: boolean;
  isLocked: boolean;
  lockDelay: number;
  othersHere: PlayerCursor[];
  onSelect: () => void;
  /** Duel classé uniquement : couleur du joueur qui a trouvé ce mot — la
   *  case verrouillée se teinte à SA couleur plutôt que le sauge générique,
   *  pour distinguer d'un coup d'œil qui a trouvé quoi. */
  lockedColor?: string | null;
  /** Première rangée : l'étiquette de présence passe SOUS la case, sinon elle
   *  serait rognée par le `overflow-hidden` de la carte de grille. */
  labelBelow?: boolean;
}

export function LetterCell({
  value,
  isActive,
  isInActiveWord,
  isLocked,
  lockDelay,
  othersHere,
  onSelect,
  lockedColor,
  labelBelow = false,
}: LetterCellProps) {
  const [showLockFlash, setShowLockFlash] = useState(false);

  // isLocked only ever flips false -> true (a found word never becomes unsolved),
  // so this effect fires exactly once per cell: the moment it locks.
  useEffect(() => {
    if (!isLocked) return;
    const start = setTimeout(() => setShowLockFlash(true), lockDelay * 1000);
    const end = setTimeout(() => setShowLockFlash(false), lockDelay * 1000 + 550);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  const background =
    isLocked && !lockedColor
      ? 'bg-organic-accent2-200'
      : isLocked
        ? '' // teinte posée en style inline ci-dessous
        : isActive
          ? 'bg-white'
          : isInActiveWord
            ? 'bg-organic-accent-100'
            : 'bg-organic-neutral-100';

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileTap={isLocked ? undefined : { scale: 0.88 }}
      transition={{ duration: 0.35 }}
      style={
        isActive
          ? { boxShadow: 'inset 0 0 0 2px #D67F48' }
          : isLocked && lockedColor
            ? { backgroundColor: `${lockedColor}2E` }
            : undefined
      }
      className={`relative flex h-full w-full items-center justify-center overflow-hidden border border-cell-border/70 font-grid text-[clamp(1rem,5.5vw,1.5rem)] font-semibold uppercase transition-colors duration-300 ${background} ${
        isLocked ? 'cursor-default' : ''
      }`}
    >
      {isActive && !isLocked && (
        <span aria-hidden="true" className="absolute -left-1 top-1/2 -translate-y-1/2 text-[10px] text-organic-accent-700">
          ▶
        </span>
      )}

      <AnimatePresence>
        {showLockFlash && (
          <motion.span
            aria-hidden="true"
            initial={{ scale: 0.6, opacity: 0.85 }}
            animate={{ scale: 1.8, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className={`pointer-events-none absolute inset-0 ${lockedColor ? '' : 'bg-organic-accent2-400'}`}
            style={lockedColor ? { backgroundColor: lockedColor } : undefined}
          />
        )}
      </AnimatePresence>

      <motion.span
        key={value}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        // Sauge UNIQUEMENT quand le mot entier est trouvé. Colorer une lettre
        // dès qu'elle est juste individuellement révélait la réponse au fur et
        // à mesure de la saisie.
        className={`relative z-10 ${
          isLocked && !lockedColor ? 'text-organic-accent2-900' : !isLocked ? 'text-organic-text' : ''
        }`}
        style={isLocked && lockedColor ? { color: lockedColor } : undefined}
      >
        {value}
      </motion.span>

      {/* Curseur NOMMÉ plutôt qu'une pastille de couleur (maquette V2) : on
          voit non seulement qu'il y a quelqu'un, mais QUI — la pastille
          obligeait à retenir quelle couleur allait à quel joueur. Un seul
          nom affiché : deux étiquettes sur une case de 40px seraient
          illisibles, le compteur prend le relais au-delà. */}
      {othersHere.length > 0 && (
        <span
          className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-[5px] py-px text-[8px] font-bold tracking-[0.04em] text-white ${
            labelBelow ? '-bottom-[7px]' : '-top-[7px]'
          }`}
          style={{ backgroundColor: othersHere[0].color }}
        >
          {othersHere.length > 1 ? `${othersHere.length} joueurs` : othersHere[0].name}
        </span>
      )}
    </motion.button>
  );
}
