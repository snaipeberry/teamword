import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { aggregateTeams, TEAM_COLORS } from '../lib/teams';
import { Avatar } from './Avatar';
import { SoundToggle } from './SoundToggle';
import { SessionMenu } from './SessionMenu';
import { AnimatedNumber } from './AnimatedNumber';
import { buildInviteUrl } from '../lib/sessionCode';

/**
 * Bandeau unique regroupant numéro de grille, scores et actions.
 *
 * L'en-tête, la barre d'invitation et le tableau des scores occupaient trois
 * blocs empilés — soit une hauteur qui croissait avec le nombre de joueurs et
 * mangeait la grille. Tout tient désormais sur UNE ligne de hauteur fixe :
 * les joueurs sont réduits à des pastilles (initiales + score), quel que soit
 * leur nombre, et la ligne défile horizontalement au-delà de trois ou quatre.
 */
export function TopBar({
  sessionId,
  round,
  dailyLabel = null,
}: {
  sessionId: string;
  round: number;
  /** Renseigné en mode « grille du jour » : remplace le numéro de grille. */
  dailyLabel?: string | null;
}) {
  const game = useGameState();
  const { teams } = useRound();
  const [copied, setCopied] = useState(false);
  const totals = aggregateTeams(game.scoreboard, teams);

  const copyLink = async () => {
    // Surtout pas window.location.href : sur une preview Vercel, cette URL
    // est protégée et forcerait l'invité à se connecter à Vercel.
    await navigator.clipboard.writeText(buildInviteUrl(sessionId));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    // `relative z-50` : la carte de grille est un motion.div transformé, donc
    // un contexte d'empilement qui passerait devant le menu déroulant —
    // le z-index du menu seul ne suffit pas, il faut élever son ancêtre.
    <div className="relative z-50 flex w-full max-w-[560px] shrink-0 items-center gap-1.5 px-2 pt-[max(env(safe-area-inset-top),6px)]">
      <span
        className={`shrink-0 rounded-full px-2 py-1 font-display text-[11px] font-bold ${
          dailyLabel ? 'bg-amber-400/30 text-amber-50' : 'bg-white/15 text-white/90'
        }`}
      >
        {dailyLabel ? `☀️ ${dailyLabel}` : `#${round + 1}`}
      </span>

      {/* En partie par équipes, on affiche les TOTAUX de camp : c'est le score
          qui compte, celui de chacun n'étant qu'un détail. */}
      {totals.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          {totals.map((t) => (
            <span
              key={t.team}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold text-white"
              style={{ backgroundColor: `${TEAM_COLORS[t.team] ?? '#888'}44` }}
              title={t.members.map((m) => (m.isMe ? 'Vous' : m.name)).join(', ')}
            >
              <span style={{ color: TEAM_COLORS[t.team] }}>{t.team}</span>
              <AnimatedNumber value={t.score} />
            </span>
          ))}
        </div>
      ) : (
      /* Pastilles joueurs — `min-w-0` autorise la compression, sinon la
         ligne pousserait les boutons hors de l'écran à trois joueurs. */
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {game.scoreboard.map((p) => (
          <motion.span
            key={p.playerId}
            layout
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className={`flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] font-bold ${
              p.isMe ? 'bg-white/25 text-white' : 'bg-white/10 text-white/80'
            }`}
            title={`${p.name}${p.online ? '' : ' (hors ligne)'} — ${p.score} mot${p.score === 1 ? '' : 's'}${p.hints ? `, ${p.hints} indice(s)` : ''}`}
          >
            <span className="relative shrink-0">
              <Avatar name={p.isMe ? 'Vous' : p.name} color={p.color} size={20} />
              {!p.online && (
                <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-neutral-400 ring-1 ring-[#3D1F63]" />
              )}
            </span>
            <AnimatedNumber value={p.score} />
            {p.hints > 0 && <span className="text-[9px] font-medium opacity-60">💡{p.hints}</span>}
          </motion.span>
        ))}
      </div>
      )}

      {game.multiplayer && (
        <button
          type="button"
          onClick={copyLink}
          aria-label="Copier le lien d'invitation"
          className="shrink-0 rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition active:scale-95"
        >
          {copied ? '✓' : '🔗'}
        </button>
      )}
      <SoundToggle />
      <SessionMenu multiplayer={game.multiplayer} />
    </div>
  );
}
