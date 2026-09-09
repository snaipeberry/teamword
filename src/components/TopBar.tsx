import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { aggregateTeams, TEAM_COLORS } from '../lib/teams';
import { SoundToggle } from './SoundToggle';
import { SessionMenu } from './SessionMenu';
import { AnimatedNumber } from './AnimatedNumber';
import { buildInviteUrl, goHome } from '../lib/sessionCode';
import { GRADE_LABELS, type MultiplayerGrade } from '../lib/difficulty';

/** Même ensemble que REACTIONS côté serveur — un émoji d'ici qu'il ne
 *  reconnaît pas serait silencieusement ignoré (voir index.js, intent
 *  `reaction`), donc les deux listes doivent rester identiques. */
const REACTION_CHOICES: { emoji: string; label: string }[] = [
  { emoji: '👏', label: 'Bravo' },
  { emoji: '😮', label: 'Waouh' },
  { emoji: '💡', label: 'Un indice ?' },
  { emoji: '🎉', label: 'Bien joué !' },
];

/**
 * Bandeau de repères et d'actions : retour, chrono, numéro de grille,
 * difficulté, lien d'invitation, réactions, son et menu de partie.
 *
 * Tout tient sur UNE ligne de hauteur fixe — l'en-tête, la barre d'invitation
 * et le tableau des scores occupaient auparavant trois blocs empilés, soit une
 * hauteur qui croissait avec le nombre de joueurs et mangeait la grille.
 *
 * L'avancement joueur par joueur n'est plus ici : il est passé aux jauges
 * placées juste sous cette barre (voir PlayerGauges, maquette V2), qui disent
 * en plus À QUELLE DISTANCE de la fin chacun se trouve. Seuls les totaux par
 * ÉQUIPE restent affichés ici, faute d'équivalent dans les jauges.
 */
export function TopBar({
  sessionId,
  round,
  dailyLabel = null,
  partiePrivee = false,
  difficulty,
  solo = false,
  bot = false,
}: {
  sessionId: string;
  round: number;
  /** Renseigné en mode « grille du jour » : remplace le numéro de grille. */
  dailyLabel?: string | null;
  /**
   * Partie privée : seule situation où le menu « ⋯ » a un sens (recommencer
   * la partie, repartir sur un nouveau code — des actions qui n'existent pas
   * en solo, en quotidien, contre un bot ou en duel classé). Ailleurs, la
   * flèche de retour suffit, comme sur les autres écrans.
   */
  partiePrivee?: boolean;
  /** Niveau de la grille en cours (rotation solo, grade multijoueur, ou
   *  « difficile » fixe en quotidien) — affiché à côté du numéro de grille. */
  difficulty?: MultiplayerGrade;
  /**
   * Le solo passe par une connexion temps réel comme le reste (`solo-<id>`),
   * donc `game.multiplayer` y vaut quand même `true` — mais le serveur
   * refuse qu'un autre joueur rejoigne cette salle précise (voir `join`
   * côté serveur). Partager un lien qui ne mène jamais nulle part n'a pas de
   * sens : le bouton « Lien » ne doit pas y apparaître.
   */
  solo?: boolean;
  /** Contre un bot, comme en solo, il n'y a personne pour recevoir une
   *  réaction — le déclencheur ne sert à rien, autant l'omettre. */
  bot?: boolean;
}) {
  const game = useGameState();
  const { teams, ranked, matchEndsAt, leaveMatch } = useRound();
  const [copied, setCopied] = useState(false);
  const [reactionsOuvertes, setReactionsOuvertes] = useState(false);
  const totals = aggregateTeams(game.scoreboard, teams);

  // Chrono du duel classé (10 minutes, voir server/websocket/index.js) — un
  // simple intervalle plutôt qu'un minuteur serveur : le SERVEUR reste seul
  // juge de la fin réelle du match (voir `matchOver`), ceci n'est qu'un
  // affichage qui suit `matchEndsAt`.
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    if (!matchEndsAt) return;
    const tick = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [matchEndsAt]);
  const secondesRestantes = matchEndsAt ? Math.max(0, Math.round((matchEndsAt - maintenant) / 1000)) : null;

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
    // La zone sûre du haut est désormais gérée par le conteneur racine
    // (App.tsx) — un second padding ici la doublerait.
    <div className="relative z-50 flex w-full max-w-[560px] shrink-0 items-center gap-1.5 px-2">
      {/* Même geste de retour que partout ailleurs, au même endroit — même
          cible tactile de 44px que BackButton.tsx, malgré la barre compacte. */}
      <button
        type="button"
        onClick={() => {
          // Quitter un duel classé EN COURS compte comme une défaite (sauf
          // adversaire déjà parti depuis 5+ min) — le serveur doit le savoir
          // AVANT qu'on ne coupe la connexion en changeant de page.
          if (ranked) leaveMatch();
          goHome();
        }}
        aria-label="Retour vers le menu"
        className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center text-[15px] font-bold text-organic-neutral-700 active:text-organic-accent-700"
      >
        ←
      </button>
      {/* Le chrono s'affiche dès qu'une fin est programmée : duel classé
          (10 min imposées) comme partie privée limitée par l'hôte. */}
      {secondesRestantes !== null && (
        <span
          className={`shrink-0 rounded-full px-2 py-1 font-display text-[11px] tabular-nums ${
            secondesRestantes <= 30
              ? 'bg-organic-accent-200 text-organic-accent-800'
              : 'bg-organic-neutral-200 text-organic-text'
          }`}
        >
          {Math.floor(secondesRestantes / 60)}:{String(secondesRestantes % 60).padStart(2, '0')}
        </span>
      )}
      {ranked ? null : (
        <>
          <span
            className={`shrink-0 rounded-full px-2 py-1 font-display text-[11px] ${
              dailyLabel ? 'bg-organic-accent-200 text-organic-accent-800' : 'bg-organic-neutral-200 text-organic-text'
            }`}
          >
            {dailyLabel ?? `#${round + 1}`}
          </span>
          {difficulty && (
            <span className="shrink-0 rounded-full bg-organic-accent2-200 px-2 py-1 font-display text-[11px] text-organic-accent2-900">
              {GRADE_LABELS[difficulty]}
            </span>
          )}
        </>
      )}

      {/* En partie par équipes, on affiche les TOTAUX de camp : c'est le score
          qui compte, celui de chacun n'étant qu'un détail. Le détail joueur
          par joueur, lui, est passé aux jauges sous la barre (PlayerGauges,
          maquette V2) — le répéter ici ne ferait que doubler l'information. */}
      {totals.length > 0 && (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          {totals.map((t) => (
            <span
              key={t.team}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold text-organic-text"
              style={{ backgroundColor: `${TEAM_COLORS[t.team] ?? '#A19786'}33` }}
              title={t.members.map((m) => (m.isMe ? 'Vous' : m.name)).join(', ')}
            >
              <span style={{ color: TEAM_COLORS[t.team] }}>{t.team}</span>
              <AnimatedNumber value={t.score} />
            </span>
          ))}
        </div>
      )}
      {totals.length === 0 && <span className="min-w-0 flex-1" />}

      {game.multiplayer && !solo && (
        <button
          type="button"
          onClick={copyLink}
          aria-label="Copier le lien d'invitation"
          className="shrink-0 rounded-full bg-organic-accent-500 px-3 py-1 font-display text-[11px] text-organic-bg shadow-sm active:bg-organic-accent-600"
        >
          {copied ? 'Copié' : 'Lien'}
        </button>
      )}

      {/* Réactions live : personne à qui les envoyer en solo ou contre un
          bot (voir la doc du prop `bot`) — le déclencheur y est donc omis. */}
      {game.multiplayer && !solo && !bot && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setReactionsOuvertes((v) => !v)}
            aria-label="Envoyer une réaction"
            aria-expanded={reactionsOuvertes}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-[16px] transition ${
              reactionsOuvertes ? 'bg-organic-accent-200' : 'active:bg-organic-neutral-200'
            }`}
          >
            😀
          </button>
          <AnimatePresence>
            {reactionsOuvertes && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-11 z-50 flex gap-1 rounded-full bg-organic-bg p-1.5 shadow-lg ring-1 ring-organic-divider"
              >
                {REACTION_CHOICES.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => {
                      game.sendReaction(r.emoji);
                      setReactionsOuvertes(false);
                    }}
                    aria-label={r.label}
                    title={r.label}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[19px] active:scale-90 active:bg-organic-neutral-200"
                  >
                    {r.emoji}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      <SoundToggle />
      {partiePrivee && <SessionMenu multiplayer={game.multiplayer} />}
    </div>
  );
}
