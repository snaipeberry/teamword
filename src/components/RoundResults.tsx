import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGameState } from '../state/GameState';
import { AnimatedNumber } from './AnimatedNumber';

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

/**
 * Écran de fin de grille : scores puis attente que tout le monde soit prêt.
 *
 * En multijoueur, le passage à la grille suivante n'est PAS automatique : un
 * joueur encore en train de lire les scores se verrait sinon propulsé sur une
 * grille vierge sans comprendre. Chacun appuie sur « Prêt », et la grille
 * suivante ne démarre que lorsque tous les joueurs EN LIGNE le sont — un
 * joueur déconnecté ne doit pas pouvoir bloquer les autres.
 */
export function RoundResults({
  round,
  onAdvance,
}: {
  round: number;
  onAdvance: () => void;
}) {
  const game = useGameState();
  const iAmReady = game.isReadyFor(game.myPlayerId, round);
  const everyoneReady = game.allReadyFor(round);

  // Tous les clients détectent la condition en même temps et appellent donc
  // `onAdvance` simultanément ; c'est `advanceRound(fromRound)` qui rend
  // l'opération idempotente, sinon on sauterait plusieurs grilles.
  useEffect(() => {
    if (game.multiplayer && iAmReady && everyoneReady) onAdvance();
  }, [game.multiplayer, iAmReady, everyoneReady, onAdvance]);

  const waiting = game.multiplayer
    ? game.scoreboard.filter((p) => p.online && !game.isReadyFor(p.playerId, round))
    : [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full max-w-[340px] rounded-3xl bg-gradient-to-br from-white/95 to-white/85 p-5 shadow-2xl"
      >
        <h2 className="text-center font-display text-xl font-bold text-aurora-violet">
          Grille {round + 1} terminée !
        </h2>

        {game.multiplayer && game.scoreboard.length > 0 && (
          <div className="mt-4 flex flex-col gap-1.5">
            {game.scoreboard.map((p, i) => {
              const ready = game.isReadyFor(p.playerId, round);
              return (
                <motion.div
                  key={p.playerId}
                  layout
                  className={`flex items-center gap-2 rounded-2xl px-3 py-2 ${
                    p.isMe ? 'bg-aurora-violet/10' : 'bg-black/5'
                  }`}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[10px] font-semibold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {initials(p.isMe ? 'Vous' : p.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-neutral-800">
                    {i === 0 && p.score > 0 && <span className="mr-1">👑</span>}
                    {p.isMe ? 'Vous' : p.name}
                    {!p.online && <span className="ml-1 text-[10px] font-medium text-neutral-400">hors ligne</span>}
                  </span>
                  {p.hints > 0 && (
                    <span className="shrink-0 text-[10px] font-medium text-neutral-400">💡{p.hints}</span>
                  )}
                  <span className="shrink-0 font-display text-sm font-bold tabular-nums text-aurora-violet">
                    <AnimatedNumber value={p.score} />
                  </span>
                  {p.online && (
                    <span className="w-4 shrink-0 text-center text-sm" title={ready ? 'Prêt' : 'En attente'}>
                      {ready ? '✅' : '⏳'}
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => (game.multiplayer ? game.setReady(round) : onAdvance())}
          disabled={iAmReady}
          className={`mt-5 w-full rounded-full py-3 font-display text-sm font-bold shadow-lg transition active:scale-95 ${
            iAmReady
              ? 'cursor-default bg-neutral-200 text-neutral-500'
              : 'bg-gradient-to-r from-aurora-coral to-aurora-amber text-white'
          }`}
        >
          {!game.multiplayer
            ? 'Grille suivante →'
            : iAmReady
              ? waiting.length > 0
                ? `En attente de ${waiting.map((p) => (p.isMe ? 'vous' : p.name)).join(', ')}…`
                : 'Chargement…'
              : 'Je suis prêt'}
        </button>
      </motion.div>
    </motion.div>
  );
}
