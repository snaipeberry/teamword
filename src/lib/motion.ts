import type { Transition, Variants } from 'framer-motion';

/**
 * Habillage commun à tous les changements d'écran "à plat" (portail, accueil,
 * salon, partie...) : un fondu avec un léger glissement horizontal, assez
 * bref pour ne jamais donner l'impression d'attendre. Centralisé ici plutôt
 * que dupliqué à chaque routeur, pour que toute la navigation partage la
 * même sensation.
 */
export const screenTransition: Transition = { type: 'spring', stiffness: 340, damping: 32, mass: 0.7 };

export const screenVariants: Variants = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -14 },
};

/** Conteneur neutre : reprend juste la mise en page flex déjà utilisée par
 *  chaque écran, pour que l'ajout de `motion` ne déplace rien. */
export const screenClassName = 'flex min-h-0 w-full flex-1 flex-col items-center';
