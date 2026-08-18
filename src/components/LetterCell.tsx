import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { PlayerCursor } from '../state/GameState';

interface LetterCellProps {
  value: string;
  isActive: boolean;
  isInActiveWord: boolean;
  isCorrect: boolean;
  isWrong: boolean;
  isLocked: boolean;
  lockDelay: number;
  othersHere: PlayerCursor[];
  onSelect: () => void;
}

export function LetterCell({
  value,
  isActive,
  isInActiveWord,
  isCorrect,
  isWrong,
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
    ? 'bg-gradient-to-br from-emerald-100 to-emerald-200'
    : isActive
      ? 'bg-cell-active'
      : isInActiveWord
        ? 'bg-amber-50'
        : 'bg-white';

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileTap={isLocked ? undefined : { scale: 0.88 }}
      animate={isWrong ? { x: [0, -4, 4, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.35 }}
      style={isActive ? { boxShadow: '0 0 0 3px rgba(77,232,239,0.55), 0 0 14px 2px rgba(77,232,239,0.5)' } : undefined}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden border border-cell-border/70 font-grid text-[clamp(1rem,5.5vw,1.5rem)] font-semibold uppercase transition-colors duration-300 ${background} ${
        isLocked ? 'cursor-default' : ''
      }`}
    >
      {isActive && !isLocked && (
        <span aria-hidden="true" className="absolute -left-1 top-1/2 -translate-y-1/2 text-[10px] text-rose-500">
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
            className="pointer-events-none absolute inset-0 rounded-sm bg-emerald-400"
          />
        )}
      </AnimatePresence>

      {isLocked && (
        <motion.span
          aria-hidden="true"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: lockDelay + 0.2, type: 'spring', stiffness: 500, damping: 18 }}
          className="absolute -right-1 -top-1 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-[8px] text-white shadow"
        >
          ✓
        </motion.span>
      )}

      <motion.span
        key={value}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        className={`relative z-10 ${
          isLocked || isCorrect ? 'text-emerald-700' : isWrong ? 'text-red-600' : 'text-neutral-900'
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
