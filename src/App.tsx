import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  GameStateProvider,
  SessionProvider,
  hasMultiplayer,
  useGameState,
  useRound,
} from './state/GameState';
/**
 * Le jeu lui-même, chargé à la demande.
 *
 * Grille, clavier, écrans de fin et célébration formaient à eux seuls le gros
 * du paquet principal — téléchargés même par quelqu'un qui ouvre l'accueil et
 * consulte son classement. Ici, leur chargement se superpose à celui de la
 * grille (voir `LoadingScreen` ci-dessous), qui est de toute façon plus long :
 * le découpage ne coûte donc aucune attente supplémentaire.
 */
const CrosswordGrid = lazy(() =>
  import('./components/CrosswordGrid').then((m) => ({ default: m.CrosswordGrid })),
);
import { TopBar } from './components/TopBar';
import { Home } from './components/Home';
import { LoginGate } from './components/LoginGate';
import { KickedScreen } from './components/Lobby';
const Lobby = lazy(() => import('./components/Lobby').then((m) => ({ default: m.Lobby })));
import { playCountdownGoSound, playCountdownTick } from './lib/sounds';
import { Announcer } from './components/Announcer';
import { MatchEndScreen } from './components/MatchEndScreen';
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
  // Au-delà de quelques secondes, un point qui pulse ne dit plus rien : on
  // passe la main au texte pour confirmer que ça travaille toujours.
  const [longue, setLongue] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLongue(true), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-busy="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3"
    >
      <motion.div
        animate={{ scale: [1, 1.25, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
        className="h-3 w-3 rounded-full bg-organic-accent-500"
      />
      <p className="max-w-[260px] text-center text-[13px] font-semibold text-organic-neutral-600">
        {longue ? 'La grille se fabrique, c’est un peu long…' : 'Chargement de la grille…'}
      </p>
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

  /**
   * Rang de la grille en cours dans la rotation solo.
   *
   * Le NUMÉRO DE MANCHE, et non le compteur de grilles du profil. Celui-ci
   * augmente à l'instant où la grille est déclarée terminée, donc pendant que
   * l'écran de résultats s'affiche encore : le niveau changeait à ce
   * moment-là, `usePuzzle` repartait chercher une autre grille, l'écran de
   * chargement remplaçait toute la partie, et les résultats disparaissaient
   * avant d'avoir été lus. Le joueur atterrissait sur une grille neuve sans
   * jamais voir ses points ni pouvoir appuyer sur « Grille suivante » — le
   * numéro de manche restait donc bloqué à 1.
   *
   * La salle solo est propre au joueur et persistante : son `round` compte
   * exactement ses grilles solo, sans jamais bouger EN COURS de manche. La
   * grille demandée ne dépend ainsi plus que de (session, partie, manche),
   * ce qui rend le tout déterministe : recharger après avoir terminé
   * redemande la MÊME grille, retrouve les lettres enregistrées, et réaffiche
   * les résultats au lieu d'une grille neuve à moitié remplie de travers.
   */
  const rangSolo = round;

  // Le service de remplissage est sans état : c'est ici qu'on décide QUI voit
  // quels indices. Le serveur applique les poids reçus tels quels, sauf pour
  // la grille du jour qu'il fixe lui-même (5 % facile / 15 % moyen / 80 %
  // difficile, identique pour tout le monde) — envoyer `undefined` laisse ce
  // choix au serveur plutôt que de le dupliquer côté client.
  const hints = daily
    ? undefined
    : solo
      ? soloDistribution(rangSolo)
      : multiplayerDistribution(grade);
  // Niveau de COMPLEXITÉ des mots retenus — distinct de `hints`, qui ne
  // choisit que la formulation des définitions. Non transmis en quotidien :
  // le serveur y impose « difficile » pour tout le monde.
  const difficulty = daily
    ? undefined
    : solo
      ? soloGrade(rangSolo)
      : grade;
  // En solo, le niveau dépend de la rotation (soloGrids/dailies) : pas la
  // peine de demander une grille avant de la connaître, elle partirait avec
  // la mauvaise proportion.
  // Plus rien à attendre en solo : le niveau se déduit du numéro de manche,
  // donc la grille peut partir sans le profil — un aller-retour de moins
  // avant la première grille.
  const puzzleReady = true;
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
        solo={solo}
        bot={bot}
      />
      {error && (
        <p className="mt-1 shrink-0 rounded-full bg-amber-400/20 px-3 py-0.5 text-[10px] text-amber-100">
          Serveur injoignable — grille de démonstration
        </p>
      )}
      {bot && <BotPlayer puzzle={puzzle} sessionId={sessionId} />}
      <Suspense fallback={<LoadingScreen />}>
        <CrosswordGrid
          puzzle={puzzle}
          round={round}
          daily={daily}
          solo={solo}
          soloProfile={soloProfile}
        />
      </Suspense>
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
  const { started, isKicked, matchOver } = useRound();
  const game = useGameState();

  /**
   * Décompte de départ, quand la partie est lancée depuis un salon.
   *
   * Une partie qui commence doit commencer, pas apparaître. Le décompte se
   * superpose à la grille au lieu de la remplacer : les trois secondes
   * servent au chargement, elles ne le rallongent pas.
   *
   * Uniquement sur la TRANSITION salon → grille : un duel classé démarre
   * déjà lancé, et un rechargement en pleine partie ne doit rien recompter.
   */
  const [compte, setCompte] = useState<number | null>(null);
  const demarreAvant = useRef(started);
  useEffect(() => {
    const avant = demarreAvant.current;
    demarreAvant.current = started;
    if (avant || !started || daily || solo) return;
    setCompte(3);
  }, [started, daily, solo]);

  useEffect(() => {
    if (compte === null) return;
    if (compte === 0) {
      playCountdownGoSound();
      const fin = setTimeout(() => setCompte(null), 420);
      return () => clearTimeout(fin);
    }
    playCountdownTick();
    const t = setTimeout(() => setCompte((n) => (n === null ? null : n - 1)), 700);
    return () => clearTimeout(t);
  }, [compte]);

  // Grille du jour et solo se jouent directement : il n'y a personne à
  // attendre dans un salon (le solo n'a même qu'un joueur). Une partie
  // contre un bot, elle, passe par le salon comme une partie privée — pas
  // pour attendre quelqu'un (le bot ne s'y montre pas, il ne rejoint qu'au
  // lancement), mais pour choisir la difficulté avant de commencer, comme
  // n'importe quelle partie à plusieurs. Voir Lobby.tsx pour ce que ça
  // change côté affichage (pas de code à partager).
  //
  // Une partie CHRONOMÉTRÉE (duel classé, ou partie privée à laquelle l'hôte
  // a fixé une limite) se conclut par son chrono plutôt que par l'avancement
  // des grilles — `matchOver` prime donc sur tout le reste dès qu'il est vrai.
  const key = matchOver
    ? 'matchEnd'
    : isKicked(game.myPlayerId)
      ? 'kicked'
      : !started && !daily && !solo
        ? 'lobby'
        : 'round';

  return (
    <>
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
        {key === 'matchEnd' ? (
          <MatchEndScreen />
        ) : key === 'kicked' ? (
          <KickedScreen />
        ) : key === 'lobby' ? (
          <Suspense fallback={<LoadingScreen />}>
            <Lobby sessionId={sessionId} bot={bot} />
          </Suspense>
        ) : (
          <Round sessionId={sessionId} daily={daily} bot={bot} solo={solo} />
        )}
      </motion.div>
      </AnimatePresence>

      {/* HORS de l'AnimatePresence ci-dessus : en mode « wait » elle n'accepte
          qu'un seul enfant, et un seul écran doit s'y échanger à la fois. */}
      <AnimatePresence>{compte !== null && <Countdown valeur={compte} />}</AnimatePresence>
    </>
  );
}

/** Trois, deux, un — puis la grille. Le chiffre est une case de grille
 *  agrandie : même brique que partout ailleurs. */
function Countdown({ valeur }: { valeur: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-organic-bg/80 backdrop-blur-[2px]"
    >
      <motion.span
        key={valeur}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 1.4, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 20 }}
        className="flex h-[104px] w-[104px] items-center justify-center rounded-[20px] bg-organic-accent-500 font-display text-[46px] text-organic-bg shadow-lg"
      >
        {valeur === 0 ? '▶' : valeur}
      </motion.span>
    </motion.div>
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
      {/* Monté une fois, à la racine : les régions live doivent exister dans
          le document avant que leur contenu ne change (voir Announcer). */}
      <Announcer />
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
