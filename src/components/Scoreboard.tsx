import { motion } from 'framer-motion';
import { useGameState } from '../state/GameState';
import { AnimatedNumber } from './AnimatedNumber';

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function Scoreboard() {
  const game = useGameState();
  if (!game.multiplayer || game.scoreboard.length === 0) return null;

  const leaderScore = game.scoreboard[0]?.score ?? 0;

  return (
    <div className="mb-1.5 flex w-full max-w-[480px] shrink-0 animate-pop-in flex-col gap-1 px-4" style={{ animationDelay: '0.12s' }}>
      {game.scoreboard.map((p, i) => {
        const isLeader = i === 0 && leaderScore > 0;
        const displayName = p.isMe ? 'Vous' : p.name;
        return (
          <motion.div
            key={p.playerId}
            layout
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className={`flex items-center justify-between rounded-2xl border px-3 py-2 shadow-lg backdrop-blur-md transition-colors ${
              p.isMe
                ? 'border-white/30 bg-gradient-to-r from-white/25 to-white/10 text-white'
                : 'border-white/10 bg-white/10 text-white/90'
            } ${isLeader ? 'ring-2 ring-aurora-amber/70' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="relative shrink-0">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full font-display text-xs font-semibold text-white shadow-inner"
                  style={{ backgroundColor: p.color }}
                >
                  {initials(displayName)}
                </span>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#3D1F63]"
                  style={{ backgroundColor: p.online ? '#4ADE80' : '#9CA3AF' }}
                />
              </span>
              <span className="min-w-0 truncate font-semibold">
                {isLeader && (
                  <span aria-hidden="true" className="mr-1">
                    👑
                  </span>
                )}
                {displayName}
              </span>
              {!p.online && <span className="shrink-0 text-[10px] text-white/50">hors ligne</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2 font-display text-sm font-semibold tabular-nums">
              {p.hints > 0 && (
                <span className="text-xs font-medium text-white/60" title="lettres révélées">
                  💡{p.hints}
                </span>
              )}
              <span>
                <AnimatedNumber value={p.score} /> mot{p.score === 1 ? '' : 's'}
              </span>
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
