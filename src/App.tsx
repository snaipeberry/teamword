import { useMemo } from 'react';
import {
  GameStateProvider,
  SessionProvider,
  hasLiveblocksKey,
  useRound,
} from './state/GameState';
import { CrosswordGrid } from './components/CrosswordGrid';
import { TopBar } from './components/TopBar';
import { AuroraBackground } from './components/AuroraBackground';
import { usePuzzle } from './hooks/usePuzzle';
import { getOrCreateSessionCode } from './lib/sessionCode';
import { seedFor } from './lib/puzzleApi';

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
function Round({ sessionId }: { sessionId: string }) {
  const { round } = useRound();
  const seed = seedFor(sessionId, round);
  const { puzzle, loading, error } = usePuzzle(seed);

  if (loading || !puzzle) return <LoadingScreen />;

  return (
    // `key` force un remontage complet au changement de grille : sinon la
    // sélection de case et les animations de la grille précédente
    // survivraient à l'arrivée de la nouvelle.
    <GameStateProvider key={puzzle.id} puzzle={puzzle}>
      <TopBar sessionId={sessionId} round={round} />
      {error && (
        <p className="mt-1 shrink-0 rounded-full bg-amber-400/20 px-3 py-0.5 text-[10px] text-amber-100">
          Serveur injoignable — grille de démonstration
        </p>
      )}
      <CrosswordGrid puzzle={puzzle} round={round} />
    </GameStateProvider>
  );
}

export default function App() {
  // Stable pour la durée de vie du composant : lit `?session=` dans l'URL ou
  // en génère un et l'y réécrit, de sorte que la barre d'adresse devienne le
  // lien d'invitation.
  const sessionId = useMemo(
    () => (hasLiveblocksKey ? getOrCreateSessionCode() : 'solo'),
    [],
  );

  return (
    // Hauteur d'écran FIXE (100dvh suit la barre d'URL mobile, contrairement
    // à 100vh) et `overflow-hidden` : la page ne défile plus, donc la grille
    // et le clavier tiennent ensemble à l'écran en permanence.
    <div className="flex h-[100dvh] flex-col items-center overflow-hidden">
      <AuroraBackground />
      <SessionProvider sessionId={sessionId}>
        <Round sessionId={sessionId} />
      </SessionProvider>
    </div>
  );
}
