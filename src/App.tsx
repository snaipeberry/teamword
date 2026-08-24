import { useMemo } from 'react';
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
import { Lobby, KickedScreen } from './components/Lobby';
import { BotPlayer } from './components/BotGame';
import { AuroraBackground } from './components/AuroraBackground';
import { usePuzzle } from './hooks/usePuzzle';
import { readSessionCode } from './lib/sessionCode';
import { dailyLabel, dailySeed, seedFor } from './lib/puzzleApi';
import { demoPuzzle } from './data/demoPuzzle';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-white">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
      <p className="text-sm font-semibold text-white/80">Chargement de la grille…</p>
    </div>
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
}: {
  sessionId: string;
  daily: boolean;
  bot: boolean;
}) {
  const { round, game } = useRound();
  // En mode « grille du jour », la graine ne dépend NI de la session NI du
  // numéro de grille : elle est commune à tous les joueurs du monde.
  const seed = daily ? dailySeed() : seedFor(sessionId, game, round);
  const { puzzle, loading, error } = usePuzzle(seed);

  if (loading || !puzzle) return <LoadingScreen />;

  return (
    // `key` force un remontage complet au changement de grille : sinon la
    // sélection de case et les animations de la grille précédente
    // survivraient à l'arrivée de la nouvelle.
    <GameStateProvider key={puzzle.id} puzzle={puzzle}>
      <TopBar sessionId={sessionId} round={round} dailyLabel={daily ? dailyLabel() : null} />
      {error && (
        <p className="mt-1 shrink-0 rounded-full bg-amber-400/20 px-3 py-0.5 text-[10px] text-amber-100">
          Serveur injoignable — grille de démonstration
        </p>
      )}
      {bot && <BotPlayer puzzle={puzzle} onScore={() => {}} />}
      <CrosswordGrid puzzle={puzzle} round={round} daily={daily} />
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
}: {
  sessionId: string;
  daily: boolean;
  bot: boolean;
}) {
  const { started, isKicked } = useRound();
  const game = useGameState();

  if (isKicked(game.myPlayerId)) return <KickedScreen />;
  // Grille du jour et partie contre un bot se jouent directement : il n'y a
  // personne à attendre dans un salon.
  if (!started && !daily && !bot) return <Lobby sessionId={sessionId} />;
  return <Round sessionId={sessionId} daily={daily} bot={bot} />;
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
}: {
  sessionId: string;
  daily: boolean;
  bot: boolean;
}) {
  return (
    <GameStateProvider puzzle={demoPuzzle}>
      <SessionRouter sessionId={sessionId} daily={daily} bot={bot} />
    </GameStateProvider>
  );
}

export default function App() {
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

  return (
    // Hauteur d'écran FIXE (100dvh suit la barre d'URL mobile, contrairement
    // à 100vh) et `overflow-hidden` : la page ne défile plus, donc la grille
    // et le clavier tiennent ensemble à l'écran en permanence.
    <div className="flex h-[100dvh] flex-col items-center overflow-hidden">
      <AuroraBackground />
      {sessionId === null ? (
        <Home />
      ) : (
        <SessionProvider sessionId={sessionId}>
          {hasMultiplayer ? (
            <SessionShell sessionId={sessionId} daily={daily} bot={bot} />
          ) : (
            <Round sessionId={sessionId} daily={daily} bot={bot} />
          )}
        </SessionProvider>
      )}
    </div>
  );
}
