import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { aggregateTeams, winningTeam, TEAM_COLORS } from '../lib/teams';
import { Avatar } from './Avatar';
import { AnimatedNumber } from './AnimatedNumber';
import { ResultModal } from './ResultModal';
import type { WordEntry } from '../types/puzzle';

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

/** `0:08` — la chronologie compte depuis l'ouverture de la grille. */
function chrono(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  daily = false,
  soloPointsEarned,
  words,
  onAdvance,
}: {
  round: number;
  /** Grille du jour : il n'y a pas de suivante, on renvoie à l'accueil. */
  daily?: boolean;
  /** Grille du jour uniquement : points solo gagnés, pour la ligne "+ N points solo". */
  soloPointsEarned?: number;
  /** Mots de la grille — le serveur ne stocke que des identifiants dans la
   *  chronologie (il ignore les réponses), c'est ici qu'on les retraduit. */
  words: WordEntry[];
  onAdvance: () => void;
}) {
  const game = useGameState();
  const { teams } = useRound();
  const totals = aggregateTeams(game.scoreboard, teams);
  const vainqueur = winningTeam(totals);
  const iAmReady = game.isReadyFor(game.myPlayerId, round);
  const everyoneReady = game.allReadyFor(round);

  // Tous les clients détectent la condition en même temps et appellent donc
  // `onAdvance` simultanément ; c'est `advanceRound(fromRound)` qui rend
  // l'opération idempotente, sinon on sauterait plusieurs grilles.
  useEffect(() => {
    if (daily) return; // rien à enchaîner
    if (game.multiplayer && iAmReady && everyoneReady) onAdvance();
  }, [daily, game.multiplayer, iAmReady, everyoneReady, onAdvance]);

  const waiting = game.multiplayer
    ? game.scoreboard.filter((p) => p.online && !game.isReadyFor(p.playerId, round))
    : [];

  return (
    <ResultModal label={daily ? 'Grille du jour terminée' : `Grille ${round + 1} terminée`}>
        <h2 className="text-center font-display text-[20px] text-organic-text">
          {daily ? 'Grille du jour terminée !' : `Grille ${round + 1} terminée !`}
        </h2>

        {daily && soloPointsEarned !== undefined && (
          <p className="mt-1.5 text-center text-[13px] font-bold text-organic-accent-700">
            + {soloPointsEarned} points solo · +1 indice
          </p>
        )}

        {totals.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {totals.map((t) => (
              <div
                key={t.team}
                className={`rounded-[20px] border p-3 ${
                  vainqueur === t.team
                    ? 'border-organic-accent2-300 bg-organic-accent2-200'
                    : 'border-organic-divider bg-organic-neutral-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[12px] text-white"
                    style={{ backgroundColor: TEAM_COLORS[t.team] ?? '#A19786' }}
                  >
                    {t.team}
                  </span>
                  <span className="flex-1 text-[14px] font-bold text-organic-text">
                    Équipe {t.team}
                    {vainqueur === t.team && <span className="ml-1 text-organic-accent2-800">· gagne</span>}
                  </span>
                  <span className="font-display text-[18px] tabular-nums text-organic-text">{t.score}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-9">
                  {t.members.map((m) => (
                    <span key={m.playerId} className="flex items-center gap-1 text-[11px] text-organic-neutral-600">
                      <Avatar name={m.isMe ? 'Vous' : m.name} color={m.color} size={16} />
                      {m.isMe ? 'Vous' : m.name} · {m.score}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {!vainqueur && totals.length > 1 && (
              <p className="text-center text-[12px] font-bold text-organic-neutral-600">Égalité</p>
            )}
          </div>
        )}

        {totals.length === 0 && game.multiplayer && game.scoreboard.length > 0 && (
          <div className="mt-4 flex flex-col gap-1.5">
            {game.scoreboard.map((p, i) => {
              const ready = game.isReadyFor(p.playerId, round);
              const gagne = i === 0 && p.score > 0;
              return (
                <motion.div
                  key={p.playerId}
                  layout
                  className={`flex items-center gap-2 rounded-[20px] px-3 py-2 ${
                    gagne ? 'bg-organic-accent2-200' : 'bg-organic-neutral-100'
                  }`}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[10px] text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {initials(p.isMe ? 'Vous' : p.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-organic-text">
                    {p.isMe ? 'Vous' : p.name}
                    {!p.online && <span className="ml-1 text-[10px] font-medium text-organic-neutral-500">hors ligne</span>}
                  </span>
                  {p.hints > 0 && (
                    <span className="shrink-0 text-[10px] font-medium text-organic-neutral-500">{p.hints} ind.</span>
                  )}
                  <span className="shrink-0 font-display text-[14px] tabular-nums text-organic-text">
                    <AnimatedNumber value={p.score} />
                  </span>
                  {p.online && (
                    <span
                      className={`w-4 shrink-0 text-center text-[10px] font-bold ${ready ? 'text-organic-accent2-700' : 'text-organic-neutral-400'}`}
                      title={ready ? 'Prêt' : 'En attente'}
                    >
                      {ready ? '✓' : '·'}
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* « Mot par mot » (maquette V2) : on relit la manche au lieu de lire
            un total. Chaque ligne porte la couleur de qui a pris le mot, ce
            qui rend le déroulé lisible d'un coup d'œil. */}
        {game.timeline.length > 0 && (
          <>
            <p className="mb-1.5 mt-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
              Mot par mot
            </p>
            <div className="flex max-h-[168px] flex-col gap-[5px] overflow-y-auto">
              {game.timeline.map((e) => {
                const mot = words.find((w) => w.id === e.wordId);
                const joueur = game.scoreboard.find((p) => p.playerId === e.playerId);
                const parMoi = e.playerId === game.myPlayerId;
                return (
                  <div
                    key={e.wordId}
                    className={`flex items-center gap-2 rounded-[14px] px-2.5 py-1.5 ${
                      parMoi ? 'bg-organic-accent2-200' : 'border border-organic-neutral-200 bg-organic-neutral-100'
                    }`}
                  >
                    <span
                      className="block h-[9px] w-[9px] shrink-0 rounded-[3px]"
                      style={{ backgroundColor: joueur?.color ?? '#A19786' }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold tracking-[0.03em] text-organic-text">
                      {mot?.answer ?? '—'}
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-organic-neutral-600">
                      {parMoi ? 'Vous' : (joueur?.name ?? 'Joueur')}
                    </span>
                    <span className="w-[38px] shrink-0 text-right text-[11.5px] font-bold tabular-nums text-organic-neutral-700">
                      {chrono(e.at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            if (daily) {
              const url = new URL(window.location.href);
              url.searchParams.delete('session');
              url.searchParams.delete('daily');
              window.location.href = url.toString();
              return;
            }
            game.multiplayer ? game.setReady(round) : onAdvance();
          }}
          disabled={!daily && iAmReady}
          className={`mt-5 w-full rounded-full py-3 font-display text-[14px] shadow-md transition active:scale-95 ${
            iAmReady
              ? 'cursor-default bg-organic-neutral-200 text-organic-neutral-500'
              : 'bg-organic-accent-500 text-organic-bg active:bg-organic-accent-600'
          }`}
        >
          {daily
            ? 'Retour à l’accueil'
            : !game.multiplayer
            ? 'Grille suivante →'
            : iAmReady
              ? waiting.length > 0
                ? `En attente de ${waiting.map((p) => (p.isMe ? 'vous' : p.name)).join(', ')}…`
                : 'Chargement…'
              : 'Je suis prêt'}
        </button>
    </ResultModal>
  );
}
