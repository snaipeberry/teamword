import { motion } from 'framer-motion';

/**
 * Chrome commun aux écrans de fin de manche (RoundResults, SoloRoundResults)
 * — fond assombri + carte qui rebondit à l'apparition. Les deux dupliquaient
 * ce même habillage à l'identique ; ne reste dans chaque écran que ce qui
 * lui est propre (contenu, bouton d'action).
 */
export function ResultModal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-organic-neutral-900/50 p-4"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full max-w-[340px] rounded-[28px] bg-organic-bg p-5 shadow-lg"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
