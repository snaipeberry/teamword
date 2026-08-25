import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { aggregateTeams, TEAM_COLORS } from '../lib/teams';
import { Avatar } from './Avatar';
import { SoundToggle } from './SoundToggle';
import { SessionMenu } from './SessionMenu';
import { AnimatedNumber } from './AnimatedNumber';
import { buildInviteUrl } from '../lib/sessionCode';
import { blockPlayer } from '../lib/roomClient';

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
  const { teams, ranked } = useRound();
  const [copied, setCopied] = useState(false);
  // Confirmation en deux temps (même motif que SessionMenu) : bloquer
  // quelqu'un n'a rien de bénin, un tap accidentel ne doit pas suffire.
  const [aBloquer, setABloquer] = useState<string | null>(null);
  const [bloques, setBloques] = useState<Set<string>>(new Set());
  const totals = aggregateTeams(game.scoreboard, teams);

  const copyLink = async () => {
    // Surtout pas window.location.href : sur une preview Vercel, cette URL
    // est protégée et forcerait l'invité à se connecter à Vercel.
    await navigator.clipboard.writeText(buildInviteUrl(sessionId));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const bloquer = async (playerId: string) => {
    if (aBloquer !== playerId) {
      setABloquer(playerId);
      return;
    }
    setABloquer(null);
    await blockPlayer(game.myPlayerId, playerId).catch(() => {});
    setBloques((prev) => new Set(prev).add(playerId));
  };

  return (
    // `relative z-50` : la carte de grille est un motion.div transformé, donc
    // un contexte d'empilement qui passerait devant le menu déroulant —
    // le z-index du menu seul ne suffit pas, il faut élever son ancêtre.
    // La zone sûre du haut est désormais gérée par le conteneur racine
    // (App.tsx) — un second padding ici la doublerait.
    <div className="relative z-50 flex w-full max-w-[560px] shrink-0 items-center gap-1.5 px-2">
      <span
        className={`shrink-0 rounded-full px-2 py-1 font-display text-[11px] ${
          dailyLabel ? 'bg-organic-accent-200 text-organic-accent-800' : 'bg-organic-neutral-200 text-organic-text'
        }`}
      >
        {dailyLabel ?? `#${round + 1}`}
      </span>

      {/* En partie par équipes, on affiche les TOTAUX de camp : c'est le score
          qui compte, celui de chacun n'étant qu'un détail. */}
      {totals.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          {totals.map((t) => (
            <span
              key={t.team}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold text-organic-text"
              style={{ backgroundColor: `${TEAM_COLORS[t.team] ?? '#888'}33` }}
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
              p.isMe ? 'bg-organic-accent2-200 text-organic-accent2-900' : 'bg-organic-neutral-200 text-organic-neutral-700'
            }`}
            title={`${p.name}${p.online ? '' : ' (hors ligne)'} — ${p.score} mot${p.score === 1 ? '' : 's'}${p.hints ? `, ${p.hints} indice(s)` : ''}`}
          >
            <span className="relative shrink-0">
              <Avatar name={p.isMe ? 'Vous' : p.name} color={p.color} size={20} />
              {!p.online && (
                <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-organic-neutral-500 ring-1 ring-organic-bg" />
              )}
            </span>
            <AnimatedNumber value={p.score} />
            {p.hints > 0 && <span className="text-[9px] font-medium opacity-70">{p.hints} ind.</span>}
            {/* Bloquer n'a de sens qu'en duel ALÉATOIRE — inviter soi-même
                quelqu'un en partie privée puis le bloquer n'en a aucun. */}
            {ranked && !p.isMe && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void bloquer(p.playerId);
                }}
                disabled={bloques.has(p.playerId)}
                aria-label={aBloquer === p.playerId ? 'Confirmer le blocage' : `Bloquer ${p.name}`}
                title={bloques.has(p.playerId) ? 'Bloqué' : undefined}
                className={`shrink-0 rounded-full px-1.5 text-[9px] font-bold uppercase tracking-wide ${
                  bloques.has(p.playerId)
                    ? 'text-organic-neutral-500'
                    : aBloquer === p.playerId
                      ? 'bg-organic-accent-500 text-organic-bg'
                      : 'text-organic-neutral-600 active:bg-organic-neutral-300'
                }`}
              >
                {bloques.has(p.playerId) ? 'bloqué' : 'bloquer'}
              </button>
            )}
          </motion.span>
        ))}
      </div>
      )}

      {game.multiplayer && (
        <button
          type="button"
          onClick={copyLink}
          aria-label="Copier le lien d'invitation"
          className="shrink-0 rounded-full bg-organic-accent-500 px-3 py-1 font-display text-[11px] text-organic-bg shadow-sm active:bg-organic-accent-600"
        >
          {copied ? 'Copié' : 'Lien'}
        </button>
      )}
      <SoundToggle />
      <SessionMenu multiplayer={game.multiplayer} />
    </div>
  );
}
