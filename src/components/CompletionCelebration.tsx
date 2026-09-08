import { motion } from 'framer-motion';
import { useEffect } from 'react';

// Tons organic — plus d'émoji dans la salve, les confettis en formes suffisent.
const COLORS = ['#D67F48', '#8FA073', '#B2622D', '#728157', '#F6A06B', '#AEBF92'];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function CompletionCelebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timeout = setTimeout(onDone, 3000);
    return () => clearTimeout(timeout);
  }, [onDone]);

  const confetti = Array.from({ length: 34 }, (_, i) => i);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-organic-neutral-900/40 backdrop-blur-sm"
    >
      {confetti.map((i) => {
        const angle = randomBetween(0, Math.PI * 2);
        const distance = randomBetween(90, 320);
        const isCircle = i % 2 === 0;
        return (
          <motion.span
            key={`c-${i}`}
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.5 }}
            animate={{
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance - 50,
              opacity: 0,
              scale: 1,
              rotate: randomBetween(-220, 220),
            }}
            transition={{ duration: randomBetween(1.1, 1.7), ease: 'easeOut', delay: randomBetween(0, 0.15) }}
            className={`absolute h-3 w-3 ${isCircle ? 'rounded-full' : 'rounded-sm'}`}
            style={{ backgroundColor: COLORS[i % COLORS.length] }}
          />
        );
      })}

      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: -4 }}
        animate={{ scale: [0.5, 1.12, 1], opacity: 1, rotate: 0 }}
        transition={{ duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
        className="rounded-[28px] bg-organic-accent-500 px-9 py-6 text-center text-organic-bg shadow-lg"
      >
        <p className="font-display text-[28px] tracking-wide">Bravo !</p>
        <p className="mt-1 text-[13px] font-medium text-organic-bg/85">Grille terminée</p>
      </motion.div>
    </motion.div>
  );
}
