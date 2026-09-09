import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { blockPlayer } from '../lib/roomClient';
import { Avatar } from './Avatar';

/**
 * Avancement de chaque joueur, en jauges.
 *
 * Remplace les pastilles « initiales + score » de la barre du haut : un
 * nombre seul ne dit pas si l'autre est à deux doigts de finir. La jauge, si.
 * (Maquette V2 — la carte de territoire qui l'accompagnait n'a volontairement
 * pas été reprise, seules les jauges l'ont été.)
 *
 * Le score EST le nombre de mots trouvés (voir l'intent `letter`/`solveWord`
 * côté serveur), donc le pourcentage se lit directement sur le total de mots
 * de la grille — aucune donnée supplémentaire à demander.
 */
export function PlayerGauges({ totalMots }: { totalMots: number }) {
  const game = useGameState();
  const { ranked } = useRound();
  const joueurs = game.scoreboard;
  // Confirmation en deux temps : bloquer quelqu'un n'a rien de bénin, un tap
  // accidentel ne doit pas suffire. (Déplacé depuis TopBar avec les
  // pastilles joueurs qu'il accompagnait.)
  const [aBloquer, setABloquer] = useState<string | null>(null);
  const [bloques, setBloques] = useState<Set<string>>(new Set());

  const bloquer = async (playerId: string) => {
    if (aBloquer !== playerId) {
      setABloquer(playerId);
      return;
    }
    setABloquer(null);
    await blockPlayer(game.myPlayerId, playerId).catch(() => {});
    setBloques((prev) => new Set(prev).add(playerId));
  };

  // Seul, la jauge n'oppose rien à rien : elle devient une barre de
  // progression de la grille, ce que la ligne « n / total mots » sous la
  // grille dit déjà. On ne l'affiche donc qu'à partir de deux joueurs.
  if (joueurs.length < 2) return null;

  return (
    <div className="mx-[18px] mb-[7px] flex shrink-0 flex-col gap-[7px] rounded-[20px] bg-organic-surface px-[11px] py-[9px]">
      {joueurs.map((p) => {
        const pct = totalMots > 0 ? Math.round((p.score / totalMots) * 100) : 0;
        return (
          <div key={p.playerId} className="flex items-center gap-2">
            <Avatar name={p.isMe ? 'Vous' : p.name} color={p.color} size={30} square />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold leading-tight text-organic-text">
                  {p.isMe ? 'Vous' : p.name}
                </span>
                <span
                  className="shrink-0 text-[10px] font-bold tabular-nums"
                  style={{ color: p.color }}
                >
                  {pct} %
                </span>
              </div>
              <span className="mt-1 block h-[7px] overflow-hidden rounded-full bg-organic-neutral-300">
                <motion.span
                  className="block h-full rounded-full"
                  style={{ backgroundColor: p.color }}
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                />
              </span>
              <span className="mt-[3px] block text-[10px] font-bold text-organic-neutral-600">
                {p.score} mot{p.score === 1 ? '' : 's'}
                {p.isMe
                  ? ` · ${p.hints} indice${p.hints === 1 ? '' : 's'} utilisé${p.hints === 1 ? '' : 's'}`
                  : p.online
                    ? ' · en ligne'
                    : ' · hors ligne'}
              </span>
            </div>
            {/* Bloquer n'a de sens qu'en duel ALÉATOIRE — inviter soi-même
                quelqu'un en partie privée puis le bloquer n'en a aucun. */}
            {ranked && !p.isMe && (
              <button
                type="button"
                onClick={() => void bloquer(p.playerId)}
                disabled={bloques.has(p.playerId)}
                aria-label={aBloquer === p.playerId ? 'Confirmer le blocage' : `Bloquer ${p.name}`}
                className={`shrink-0 self-start rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${
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
          </div>
        );
      })}
    </div>
  );
}
