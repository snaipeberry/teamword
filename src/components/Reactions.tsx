import { AnimatePresence, motion } from 'framer-motion';
import { useGameState } from '../state/GameState';
import { hapticTick } from '../lib/sounds';

/** Palette volontairement courte : au-delà, le choix ralentit plus qu'il n'amuse. */
const REACTIONS: { emoji: string; label: string }[] = [
  { emoji: '😂', label: 'Rigole' },
  { emoji: '😮', label: 'Waw' },
  { emoji: '👏', label: 'Bien joué' },
  { emoji: '🔥', label: 'En feu' },
  { emoji: '🤔', label: 'Hmm' },
];

/** Boutons d'envoi, posés dans la barre d'actions. */
export function ReactionBar() {
  const game = useGameState();

  return (
    <div className="flex min-w-0 items-center gap-1">
      {REACTIONS.map(({ emoji, label }) => (
        <motion.button
          key={emoji}
          type="button"
          aria-label={label}
          title={label}
          whileTap={{ scale: 0.8 }}
          // onPointerDown : réponse immédiate, sans l'attente du clic tactile.
          onPointerDown={(e) => {
            e.preventDefault();
            hapticTick();
            game.sendReaction(emoji);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm shadow-sm backdrop-blur-md transition active:bg-white/30"
        >
          {emoji}
        </motion.button>
      ))}
    </div>
  );
}

/**
 * Couche d'affichage des réactions reçues.
 *
 * `pointer-events-none` est essentiel : cette couche recouvre toute la
 * fenêtre, sans quoi elle intercepterait les appuis sur la grille et le
 * clavier pendant qu'une réaction est visible.
 */
export function ReactionOverlay() {
  const game = useGameState();

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      <AnimatePresence>
        {game.reactions.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 0, scale: 0.5 }}
            animate={{ opacity: [0, 1, 1, 0], y: -180, scale: [0.5, 1.25, 1, 0.9] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.6, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
            className="absolute bottom-[28%] flex flex-col items-center"
            // Décalage horizontal par réaction : sans lui, plusieurs
            // réactions simultanées se superposeraient exactement.
            style={{ left: `${18 + ((i * 23) % 64)}%` }}
          >
            <span className="text-4xl drop-shadow-lg">{r.emoji}</span>
            <span className="mt-0.5 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
              {r.name}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
