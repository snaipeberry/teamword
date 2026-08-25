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
}

export function LetterCell({
  value,
  isActive,
  isInActiveWord,
  isLocked,
  lockDelay,
  othersHere,
  onSelect,
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

  const background = isLocked
    ? 'bg-organic-accent2-200'
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
      style={isActive ? { boxShadow: 'inset 0 0 0 2px #D67F48' } : undefined}
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
            className="pointer-events-none absolute inset-0 rounded-sm bg-organic-accent2-400"
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
          isLocked ? 'text-organic-accent2-900' : 'text-organic-text'
        }`}
      >
        {value}
      </motion.span>

      {othersHere.map((p) => (
        <span
          key={p.connectionId}
          className="absolute bottom-0.5 right-0.5 z-10 h-2 w-2 rounded-full ring-1 ring-white"
          style={{ backgroundColor: p.color }}
          title={p.name}
        />
      ))}
    </motion.button>
  );
}
