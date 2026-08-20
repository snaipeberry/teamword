import { motion } from 'framer-motion';

/**
 * Clavier intégré au jeu, disposition AZERTY.
 *
 * On n'utilise PAS le clavier natif du téléphone : sa hauteur est imposée par
 * l'OS, il apparaît et disparaît sans qu'on le contrôle, et il recouvrait la
 * moitié de la grille. Avec un clavier maison, sa hauteur fait partie de la
 * mise en page — la grille occupe exactement la place restante et reste
 * toujours entièrement visible.
 *
 * Le clavier physique reste géré séparément (écoute globale des touches dans
 * CrosswordGrid), pour ne rien perdre sur ordinateur.
 */
const ROWS = [
  ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
  ['W', 'X', 'C', 'V', 'B', 'N'],
];

interface KeyboardProps {
  onLetter: (letter: string) => void;
  onBackspace: () => void;
}

export function Keyboard({ onLetter, onBackspace }: KeyboardProps) {
  return (
    <div
      className="w-full max-w-[560px] shrink-0 select-none px-1 pb-[max(env(safe-area-inset-bottom),4px)] pt-1"
      // Empêche le navigateur de traiter les appuis comme du défilement ou
      // un double-tap-zoom, qui rendaient la frappe rapide peu fiable.
      style={{ touchAction: 'manipulation' }}
    >
      {ROWS.map((row, i) => (
        <div key={i} className="mb-1 flex justify-center gap-[3px]">
          {row.map((letter) => (
            <motion.button
              key={letter}
              type="button"
              whileTap={{ scale: 0.88 }}
              // onPointerDown plutôt que onClick : la frappe répond
              // immédiatement, sans les ~300 ms d'attente du clic tactile.
              onPointerDown={(e) => {
                e.preventDefault();
                onLetter(letter);
              }}
              className="h-[42px] min-w-0 flex-1 rounded-md bg-white/90 font-display text-[15px] font-semibold text-aurora-violet shadow-sm active:bg-white"
            >
              {letter}
            </motion.button>
          ))}

          {i === ROWS.length - 1 && (
            <motion.button
              type="button"
              aria-label="Effacer"
              whileTap={{ scale: 0.88 }}
              onPointerDown={(e) => {
                e.preventDefault();
                onBackspace();
              }}
              className="h-[42px] flex-[1.6] rounded-md bg-white/25 text-[15px] font-semibold text-white shadow-sm active:bg-white/40"
            >
              ⌫
            </motion.button>
          )}
        </div>
      ))}
    </div>
  );
}
