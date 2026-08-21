import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameState } from '../state/GameState';
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
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function TopBar({ sessionId, round }: { sessionId: string; round: number }) {
  const game = useGameState();
  const [copied, setCopied] = useState(false);

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
      <span className="shrink-0 rounded-full bg-white/15 px-2 py-1 font-display text-[11px] font-bold text-white/90">
        #{round + 1}
      </span>

      {/* Pastilles joueurs — `min-w-0` autorise la compression, sinon la
          ligne pousserait les boutons hors de l'écran à trois joueurs. */}
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
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full font-display text-[9px] text-white"
                style={{ backgroundColor: p.color }}
              >
                {initials(p.isMe ? 'Vous' : p.name)}
              </span>
              {!p.online && (
                <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-neutral-400 ring-1 ring-[#3D1F63]" />
              )}
            </span>
            <AnimatedNumber value={p.score} />
            {p.hints > 0 && <span className="text-[9px] font-medium opacity-60">💡{p.hints}</span>}
          </motion.span>
        ))}
      </div>

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
