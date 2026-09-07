import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  GameStateProvider,
  SessionProvider,
  hasMultiplayer,
  useGameState,
  useRound,
} from './state/GameState';
import { CrosswordGrid } from './components/CrosswordGrid';
import { TopBar } from './components/TopBar';
import { Home } from './components/Home';
import { LoginGate } from './components/LoginGate';
import { Lobby, KickedScreen } from './components/Lobby';
import { BotPlayer } from './components/BotGame';
import { AuroraBackground } from './components/AuroraBackground';
import { usePuzzle } from './hooks/usePuzzle';
import { useSoloProfile } from './hooks/useSoloProfile';
import { readSessionCode } from './lib/sessionCode';
import { activePlayerId, currentSession, shouldSkipGate } from './lib/auth';
import { dailyLabel, dailySeed, seedFor } from './lib/puzzleApi';
import { demoPuzzle } from './data/demoPuzzle';
import { screenClassName, screenTransition, screenVariants } from './lib/motion';
import { multiplayerDistribution, soloDistribution, soloGrade } from './lib/difficulty';

function LoadingScreen() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3"
    >
      <motion.div
        animate={{ scale: [1, 1.25, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
        className="h-3 w-3 rounded-full bg-organic-accent-500"
      />
      <p className="text-sm font-semibold text-organic-neutral-600">Chargement de la grille…</p>
    </motion.div>
  );
}

/**
 * Sous la session : la manche partagée détermine quelle grille charger, donc
 * ce composant doit vivre à l'intérieur du provider de session.
 */
function Round({
  sessionId,
  daily,
  bot,
  solo,
}: {
  sessionId: string;
  daily: boolean;
  bot: boolean;
  solo: boolean;
}) {
  const { round, game, grade, ranked } = useRound();
  // En mode « grille du jour », la graine ne dépend NI de la session NI du
  // numéro de grille : elle est commune à tous les joueurs du monde. En solo,
  // `sessionId` est déjà propre au joueur (`solo-<playerId>`) : `seedFor`
  // suffit à produire une graine stable par joueur ET par numéro de grille.
  const seed = daily ? dailySeed() : seedFor(sessionId, game, round);

  // Solo et quotidien partagent la même économie de points/ampoules — voir
  // useSoloProfile. Remonté ici (plutôt que dans CrosswordGrid) car le rang
  // dans la rotation (soloGrids/dailies) détermine la répartition des
  // indices AVANT même de savoir quelle grille demander.
  const soloScored = solo || daily;
  const soloProfile = useSoloProfile(activePlayerId(), soloScored);

  // Le service de remplissage est sans état : c'est ici qu'on décide QUI voit
  // quels indices. Le serveur applique les poids reçus tels quels, sauf pour
  // la grille du jour qu'il fixe lui-même (5 % facile / 15 % moyen / 80 %
  // difficile, identique pour tout le monde) — envoyer `undefined` laisse ce
  // choix au serveur plutôt que de le dupliquer côté client.
  const hints = daily
    ? undefined
    : solo
      ? (soloProfile.profile ? soloDistribution(soloProfile.profile.soloGrids, soloProfile.profile.dailies) : undefined)
      : multiplayerDistribution(grade);
  // Niveau de COMPLEXITÉ des mots retenus — distinct de `hints`, qui ne
  // choisit que la formulation des définitions. Non transmis en quotidien :
  // le serveur y impose « difficile » pour tout le monde.
  const difficulty = daily
    ? undefined
    : solo
      ? (soloProfile.profile ? soloGrade(soloProfile.profile.soloGrids, soloProfile.profile.dailies) : undefined)
      : grade;
  // En solo, le niveau dépend de la rotation (soloGrids/dailies) : pas la
  // peine de demander une grille avant de la connaître, elle partirait avec
  // la mauvaise proportion.
  const puzzleReady = !solo || soloProfile.profile !== null;
  const { puzzle, loading, error } = usePuzzle(seed, { hints, difficulty, ready: puzzleReady });
  // Pour l'affichage (TopBar) : `difficulty` est `undefined` en quotidien
  // (volontairement, voir plus haut — le serveur ne doit pas le recevoir du
  // client) mais le joueur doit quand même voir le niveau réellement
  // appliqué, qui y est toujours fixe à « difficile ».
  const displayDifficulty = difficulty ?? 'difficile';

  if (loading || !puzzle) return <LoadingScreen />;

  return (
    // `key` force un remontage complet au changement de grille : sinon la
    // sélection de case et les animations de la grille précédente
    // survivraient à l'arrivée de la nouvelle.
    <GameStateProvider key={puzzle.id} puzzle={puzzle}>
      {/* Partie privée = créée depuis « Multijoueur › Partie privée » : ni
          solo, ni quotidienne, ni contre un bot, ni duel classé. Seule à
          proposer le menu « ⋯ » (recommencer / nouveau code). */}
      <TopBar
        sessionId={sessionId}
        round={round}
        dailyLabel={daily ? dailyLabel() : null}
        partiePrivee={!daily && !bot && !solo && !ranked}
        difficulty={displayDifficulty}
      />
      {error && (
        <p className="mt-1 shrink-0 rounded-full bg-amber-400/20 px-3 py-0.5 text-[10px] text-amber-100">
          Serveur injoignable — grille de démonstration
        </p>
      )}
      {bot && <BotPlayer puzzle={puzzle} sessionId={sessionId} />}
      <CrosswordGrid
        puzzle={puzzle}
        round={round}
        daily={daily}
        solo={solo}
        soloProfile={soloProfile}
      />
    </GameStateProvider>
  );
}

/**
 * Aiguillage à l'intérieur de la session : salon tant que l'hôte n'a pas
 * lancé, jeu ensuite — et écran d'adieu pour un joueur exclu.
 *
 * Il faut être CONNECTÉ pour savoir lequel afficher (l'état est partagé),
 * d'où ce composant sous SessionProvider plutôt qu'au-dessus.
 */
function SessionRouter({
  sessionId,
  daily,
  bot,
  solo,
}: {
  sessionId: string;
  daily: boolean;
  bot: boolean;
  solo: boolean;
}) {
  const { started, isKicked } = useRound();
  const game = useGameState();

  // Grille du jour, partie contre un bot et solo se jouent directement : il
  // n'y a personne à attendre dans un salon (le solo n'a même qu'un joueur).
  const key = isKicked(game.myPlayerId) ? 'kicked' : !started && !daily && !bot && !solo ? 'lobby' : 'round';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        variants={screenVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={screenTransition}
        className={screenClassName}
      >
        {key === 'kicked' ? (
          <KickedScreen />
        ) : key === 'lobby' ? (
          <Lobby sessionId={sessionId} />
        ) : (
          <Round sessionId={sessionId} daily={daily} bot={bot} solo={solo} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Le salon a besoin de la liste des joueurs, qui vient de GameStateApi — or
 * ce provider réclame une grille. On lui en donne une factice : elle n'est
 * jamais affichée avant le lancement, et cela évite de dupliquer toute la
 * logique de présence pour le seul salon.
 */
function SessionShell({
  sessionId,
  daily,
  bot,
  solo,
}: {
  sessionId: string;
  daily: boolean;
  bot: boolean;
  solo: boolean;
}) {
  return (
    <GameStateProvider puzzle={demoPuzzle}>
      <SessionRouter sessionId={sessionId} daily={daily} bot={bot} solo={solo} />
    </GameStateProvider>
  );
}

export default function App() {
  // Montré une fois par onglet (voir shouldSkipGate) tant qu'il n'y a pas de
  // compte connecté. L'identité invité, elle, continue de se régénérer à
  // chaque rechargement — seule la question « avez-vous déjà choisi ? » est
  // retenue, pas les données du choix invité lui-même.
  const [identityChosen, setIdentityChosen] = useState(() => currentSession() !== null || shouldSkipGate());

  // Stable pour la durée de vie du composant : lit `?session=` dans l'URL ou
  // en génère un et l'y réécrit, de sorte que la barre d'adresse devienne le
  // lien d'invitation.
  // Plus de création automatique : sans `?session=`, on affiche l'accueil.
  // En solo (aucune clé Liveblocks) il n'y a ni salon ni invitation, donc on
  // court-circuite directement vers le jeu.
  const sessionId = useMemo(() => (hasMultiplayer ? readSessionCode() : 'solo'), []);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const daily = useMemo(() => params.get('daily') === '1', [params]);
  const bot = useMemo(() => params.get('bot') === '1', [params]);
  const solo = useMemo(() => params.get('solo') === '1', [params]);
  // Fixe le mode de la salle à sa création côté serveur (voir join dans
  // server/index.js) — priorité au solo si jamais les deux étaient présents.
  const mode = solo ? 'solo' : daily ? 'daily' : undefined;

  return (
    // Hauteur d'écran FIXE (100dvh suit la barre d'URL mobile, contrairement
    // à 100vh) et `overflow-hidden` : la page ne défile plus, donc la grille
    // et le clavier tiennent ensemble à l'écran en permanence.
    //
    // Zones sûres centralisées ICI plutôt que dispersées par écran : avant,
    // seuls TopBar (haut) et Keyboard (bas) en tenaient compte — tous les
    // écrans SANS les deux (accueil, salon, portail, profil, classement,
    // matchmaking) n'avaient AUCUNE marge contre l'encoche/l'indicateur
    // d'accueil. `AuroraBackground` est `fixed inset-0`, donc ce padding ne
    // le concerne pas : le fond continue de couvrir tout l'écran, seul le
    // CONTENU en tient compte.
    <div className="flex h-[100dvh] flex-col items-center overflow-hidden pt-[max(env(safe-area-inset-top),6px)] pb-[max(env(safe-area-inset-bottom),6px)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <AuroraBackground />
      <AnimatePresence mode="wait">
        {!identityChosen ? (
          <motion.div
            key="gate"
            variants={screenVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={screenTransition}
            className={screenClassName}
          >
            <LoginGate onDone={() => setIdentityChosen(true)} />
          </motion.div>
        ) : sessionId === null ? (
          <motion.div
            key="home"
            variants={screenVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={screenTransition}
            className={screenClassName}
          >
            <Home />
          </motion.div>
        ) : (
          <motion.div
            key="session"
            variants={screenVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={screenTransition}
            className={screenClassName}
          >
            <SessionProvider sessionId={sessionId} mode={mode}>
              {hasMultiplayer ? (
                <SessionShell sessionId={sessionId} daily={daily} bot={bot} solo={solo} />
              ) : (
                <Round sessionId={sessionId} daily={daily} bot={bot} solo={solo} />
              )}
            </SessionProvider>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
