import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameState } from '../state/GameState';
import { hapticTick, unlockAudio } from '../lib/sounds';

/**
 * Bouton talkie-walkie : on maintient pour parler, on relâche pour envoyer.
 *
 * Le maintien est géré par des événements POINTER plutôt que par un clic :
 * il faut capturer aussi bien le doigt que la souris, et surtout savoir quand
 * l'appui se termine hors du bouton. `setPointerCapture` garantit de recevoir
 * le relâchement même si le doigt a glissé ailleurs — sans quoi le micro
 * resterait ouvert indéfiniment.
 */
export function PushToTalk() {
  const game = useGameState();
  const [talking, setTalking] = useState(false);

  // Filet de sécurité : si l'onglet passe en arrière-plan pendant l'appui, le
  // relâchement n'arrivera jamais.
  useEffect(() => {
    if (!talking) return;
    const stop = () => {
      setTalking(false);
      game.stopTalking();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [talking, game]);

  const begin = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    unlockAudio();
    hapticTick();
    setTalking(true);
    void game.startTalking();
  };

  const end = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!talking) return;
    setTalking(false);
    game.stopTalking();
  };

  return (
    <motion.button
      type="button"
      aria-label={game.micDenied ? 'Micro indisponible' : 'Maintenir pour parler'}
      title={game.micDenied ? 'Micro refusé — autorisez-le dans le navigateur' : 'Maintenir pour parler'}
      animate={talking ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={talking ? { repeat: Infinity, duration: 1 } : { duration: 0.15 }}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={end}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold shadow-lg backdrop-blur-md transition ${
        game.micDenied
          ? 'border border-white/20 bg-white/10 text-white/40'
          : talking
            ? 'bg-red-500 text-white ring-2 ring-red-300'
            : 'border border-white/30 bg-white/15 text-white'
      }`}
      style={{ touchAction: 'none' }}
    >
      <span aria-hidden="true">{game.micDenied ? '🚫' : '🎙️'}</span>
      {talking ? 'Parlez…' : 'Parler'}
    </motion.button>
  );
}

/** Bandeau « untel parle », affiché tant qu'un message est en cours. */
export function TalkingIndicator() {
  const game = useGameState();
  if (game.talkingNames.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-none fixed left-1/2 top-2 z-40 -translate-x-1/2 rounded-full bg-red-500/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg"
    >
      🎙️ {game.talkingNames.join(', ')} parle…
    </motion.div>
  );
}
