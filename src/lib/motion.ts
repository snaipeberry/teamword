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

/**
 * Gabarit d'un écran, repris de la maquette Organic.
 *
 * Le contenu REMPLIT le cadre du téléphone de haut en bas — titre en haut,
 * actions de bas de page collées en bas (`mt-auto`) — au lieu d'être un bloc
 * étroit centré verticalement, qui laissait de grandes zones vides en haut
 * et en bas et ne ressemblait pas à une application mobile.
 *
 * La largeur n'est plafonnée que pour rester lisible sur un écran large
 * (navigateur de bureau) : sur téléphone, le contenu occupe toute la largeur
 * moins les 22 px de marge de la maquette.
 *
 * Seule exception : la recherche d'adversaire (Matchmaking), centrée dans la
 * maquette aussi — un écran d'attente n'a rien à aligner en haut.
 */
export const screenShell = 'flex min-h-0 w-full max-w-[440px] flex-1 flex-col px-[22px] pt-3';
