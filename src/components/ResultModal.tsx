import { motion } from 'framer-motion';
import { useDialog } from '../hooks/useDialog';

/**
 * Chrome commun aux écrans de fin de manche (RoundResults, SoloRoundResults)
 * — fond assombri + carte qui rebondit à l'apparition. Les deux dupliquaient
 * ce même habillage à l'identique ; ne reste dans chaque écran que ce qui
 * lui est propre (contenu, bouton d'action).
 *
 * C'est un vrai dialogue modal : le focus y entre à l'ouverture et n'en sort
 * plus tant qu'il est là. Sans cela, la tabulation continuait de parcourir la
 * grille masquée derrière, qu'un lecteur d'écran lisait donc tranquillement
 * alors qu'elle était inatteignable.
 *
 * Pas de fermeture par Échap : on n'annule pas une fin de manche, on la
 * traverse par le bouton d'action qu'elle contient.
 */
export function ResultModal({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useDialog<HTMLDivElement>(true, () => {});

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-organic-neutral-900/50 p-4"
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
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
