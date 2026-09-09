import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { buildInviteUrl, goHome } from '../lib/sessionCode';
import { Avatar } from './Avatar';
import { GRADE_LABELS, MULTIPLAYER_GRADES } from '../lib/difficulty';
import { screenShell } from '../lib/motion';
import { BackButton } from './BackButton';

/**
 * Salon d'attente : code à partager, liste des joueurs, départ.
 *
 * L'exclusion n'est proposée qu'à l'hôte — mais le contrôle réel est dans la
 * mutation `kickPlayer`, masquer le bouton ne protégeant de rien.
 */
export function Lobby({ sessionId, bot = false }: { sessionId: string; bot?: boolean }) {
  const game = useGameState();
  const {
    hostId, startGame, kickPlayer, isKicked, teams, setTeam, grade, setGrade,
    format, setFormat, timeLimitMin, setTimeLimit,
  } = useRound();
  const [copied, setCopied] = useState<'code' | 'lien' | null>(null);

  const jeSuisHote = hostId === game.myPlayerId;
  // Un joueur exclu reste CONNECTÉ (il voit l'écran d'adieu) : sans ce
  // filtre il continuerait d'apparaître dans la liste de l'hôte.
  const presents = game.scoreboard.filter((p) => p.online && !isKicked(p.playerId));

  const copier = async (quoi: 'code' | 'lien') => {
    await navigator.clipboard.writeText(quoi === 'code' ? sessionId : buildInviteUrl(sessionId));
    setCopied(quoi);
    setTimeout(() => setCopied(null), 1500);
  };

  const styleEquipe = (playerId: string) =>
    teams[playerId] === 'A'
      ? 'bg-organic-accent2-300 text-organic-accent2-900'
      : teams[playerId] === 'B'
        ? 'bg-organic-accent-200 text-organic-accent-800'
        : 'bg-organic-neutral-200 text-organic-neutral-700';

  return (
    <div className={`${screenShell} overflow-y-auto`}>
      <BackButton onClick={goHome} />
      <h1 className="mt-1.5 font-display text-[30px] leading-none text-organic-text">
        {bot ? 'Contre un bot' : 'Salon'}
      </h1>

      {/* Code de la partie : absent contre un bot — cette salle n'attend
          personne d'autre, partager son code n'aurait aucun sens (le
          "match" est déjà complet : vous + le bot au lancement). */}
      {!bot && (
        <>
          <p className="mb-2 mt-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Code de la partie
          </p>
          {/* Une case par lettre, flèche comprise : le code se lit comme une
              réponse de grille (maquette V2). */}
          <div className="flex items-center gap-1.5">
            {sessionId.split('').map((ch, i) => (
              <span
                key={i}
                className="flex h-[50px] w-[44px] shrink-0 items-center justify-center rounded-lg border border-organic-neutral-300 bg-organic-neutral-100 font-display text-[24px] text-organic-text"
              >
                {ch}
              </span>
            ))}
            <span className="ml-0.5 text-[15px] text-organic-accent-600" aria-hidden="true">
              ▶
            </span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => copier('code')}
              className="rounded-full border border-organic-neutral-400 px-4 py-2 font-display text-[12.5px] text-organic-text active:bg-organic-neutral-200"
            >
              {copied === 'code' ? 'Copié' : 'Copier le code'}
            </button>
            <button
              type="button"
              onClick={() => copier('lien')}
              className="rounded-full bg-organic-accent-500 px-4 py-2 font-display text-[12.5px] text-organic-bg active:bg-organic-accent-600"
            >
              {copied === 'lien' ? 'Copié' : 'Partager le lien'}
            </button>
          </div>

          {/* Format : c'est lui qui décide si les camps existent, donc il
              précède la liste des joueurs. Réservé à l'hôte, comme la
              difficulté — le serveur refuse de toute façon les autres. */}
          <p className="mb-2 mt-5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Format
          </p>
          <div className="flex gap-1.5 rounded-full bg-organic-surface p-1">
            {([
              ['1v1', 'Duel 1v1'],
              ['coop', 'Coop'],
              ['equipes', 'Équipes'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                disabled={!jeSuisHote}
                onClick={() => setFormat(k)}
                aria-pressed={format === k}
                className={`flex-1 rounded-full py-2 font-display text-[12.5px] transition ${
                  format === k
                    ? 'bg-organic-bg text-organic-text shadow-sm'
                    : 'text-organic-neutral-600'
                } ${jeSuisHote ? 'active:scale-95' : 'cursor-default'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-[1.45] text-organic-neutral-700">
            {format === 'coop'
              ? 'Une seule grille, tout le monde écrit dedans. Les cases prennent la couleur de qui les a remplies.'
              : format === 'equipes'
                ? 'Deux équipes sur la même grille. Le score d’une équipe est celui de ses mots complets.'
                : 'Deux joueurs, camps attribués d’office. Le plus de mots trouvés prend la manche.'}
          </p>

          <p className="mb-2 mt-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Limite de temps
          </p>
          <div className="flex gap-1.5">
            {([5, 10, 15, 30, null] as const).map((min) => (
              <button
                key={min ?? 'illimite'}
                type="button"
                disabled={!jeSuisHote}
                onClick={() => setTimeLimit(min)}
                aria-pressed={timeLimitMin === min}
                className={`flex-1 rounded-xl border py-2.5 text-center font-display text-[12.5px] transition ${
                  timeLimitMin === min
                    ? 'border-organic-accent2-400 bg-organic-accent2-300 text-organic-accent2-900'
                    : 'border-organic-neutral-300 text-organic-neutral-700'
                } ${jeSuisHote ? 'active:scale-95' : 'cursor-default'}`}
              >
                {min === null ? '∞' : `${min} min`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-[1.45] text-organic-neutral-700">
            {timeLimitMin === null
              ? 'Sans limite : la partie reste ouverte, chacun revient quand il veut.'
              : `Le chrono démarre à l’ouverture de la grille. Au bout de ${timeLimitMin} minutes, les mots trouvés sont comptés.`}
          </p>
        </>
      )}

      {/* Joueurs, équipes et format : sans objet contre un bot — vous seul
          êtes dans ce salon, personne à lister ni à mettre en équipe. */}
      {!bot && (
      <div className="mt-5 w-full">
        <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
          {presents.length} joueur{presents.length > 1 ? 's' : ''}
          {format === 'equipes' ? ' · appuyez sur l’étiquette pour changer d’équipe' : ''}
        </p>
        <div className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {presents.map((p) => (
              <motion.div
                key={p.playerId}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2.5 rounded-[18px] border border-organic-neutral-300 bg-organic-neutral-100 px-3 py-2"
              >
                <Avatar name={p.isMe ? game.myName : p.name} color={p.color} size={34} square />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-organic-text">
                  {p.isMe ? game.myName : p.name}
                  {p.isMe && <span className="ml-1 text-[10px] font-medium text-organic-neutral-500">(vous)</span>}
                </span>
                {hostId === p.playerId && (
                  <span
                    className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-organic-accent-700"
                    title="Hôte"
                  >
                    hôte
                  </span>
                )}
                {/* L'étiquette d'équipe n'a de sens qu'en format « Équipes » :
                    en coop il n'y a pas de camp, en 1v1 ils sont imposés par
                    le serveur (voir l'intent `format`). */}
                {format === 'equipes' ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!p.isMe) return;
                      const actuelle = teams[p.playerId];
                      setTeam(actuelle === 'A' ? 'B' : actuelle === 'B' ? null : 'A');
                    }}
                    disabled={!p.isMe}
                    aria-label={p.isMe ? 'Changer d’équipe' : undefined}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${styleEquipe(p.playerId)} ${p.isMe ? 'active:scale-95' : 'cursor-default'}`}
                  >
                    {teams[p.playerId] ? `Équipe ${teams[p.playerId]}` : 'Coop'}
                  </button>
                ) : (
                  format === '1v1' &&
                  teams[p.playerId] && (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${styleEquipe(p.playerId)}`}
                    >
                      Équipe {teams[p.playerId]}
                    </span>
                  )
                )}

                {jeSuisHote && !p.isMe && (
                  <button
                    type="button"
                    onClick={() => kickPlayer(p.playerId)}
                    aria-label={`Exclure ${p.name}`}
                    title={`Exclure ${p.name}`}
                    className="shrink-0 rounded-full bg-organic-accent-100 px-2.5 py-1 text-[11px] font-bold text-organic-accent-700 active:scale-95"
                  >
                    Exclure
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      )}

      {!bot && (() => {
        const a = presents.filter((p) => teams[p.playerId] === 'A').length;
        const b = presents.filter((p) => teams[p.playerId] === 'B').length;
        if (a === 0 && b === 0) return null;
        return (
          <p className="mt-3 text-center text-[12px] font-bold text-organic-neutral-700">
            Format {a}v{b}
            {a !== b && <span className="ml-1 text-organic-accent-700">— équipes déséquilibrées</span>}
          </p>
        );
      })()}

      {/* Difficulté des indices : réglée par l'hôte, la même pour tous — voir
          lib/difficulty.ts. Visible même en simple observateur, pour que
          chacun sache à quoi s'attendre avant que la partie démarre. */}
      <div className="mt-5 w-full">
        <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-organic-neutral-600">
          Difficulté des indices
        </p>
        <div className="flex justify-center gap-1.5">
          {MULTIPLAYER_GRADES.map((g) => (
            <button
              key={g}
              type="button"
              disabled={!jeSuisHote}
              onClick={() => setGrade(g)}
              aria-label={`Difficulté ${GRADE_LABELS[g]}`}
              aria-pressed={grade === g}
              className={`rounded-full px-4 py-1.5 text-[12.5px] font-bold transition ${
                grade === g
                  ? 'bg-organic-accent-500 text-organic-bg'
                  : 'bg-organic-neutral-200 text-organic-neutral-700'
              } ${jeSuisHote ? 'active:scale-95' : 'cursor-default'}`}
            >
              {GRADE_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      {/* Collé au bas du cadre (maquette Organic) : le départ est l'action
          principale de l'écran, elle reste sous le pouce. */}
      <div className="mt-auto w-full pb-3.5 pt-5">
        {jeSuisHote ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={startGame}
            className="w-full rounded-full bg-organic-accent-500 py-3.5 font-display text-[16px] text-organic-bg shadow-md active:bg-organic-accent-600"
          >
            Commencer
          </motion.button>
        ) : (
          <p className="text-center text-[12px] font-semibold text-organic-neutral-600">
            En attente du lancement par l’hôte…
          </p>
        )}
      </div>
    </div>
  );
}

/** Écran affiché au joueur exclu : il ne doit pas pouvoir revenir tout seul. */
export function KickedScreen() {
  return (
    <div className="flex min-h-0 w-full max-w-[340px] flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="font-display text-[20px] text-organic-text">Vous avez quitté la partie</h1>
      <p className="text-[13px] text-organic-neutral-700">L’hôte vous a retiré du salon.</p>
      <button
        type="button"
        onClick={goHome}
        className="rounded-full bg-organic-accent-500 px-5 py-2.5 font-display text-[14px] text-organic-bg active:bg-organic-accent-600"
      >
        Retour à l’accueil
      </button>
    </div>
  );
}
