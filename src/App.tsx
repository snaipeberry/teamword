import { useMemo, useState } from 'react';
import {
  GameStateProvider,
  SessionProvider,
  hasLiveblocksKey,
  useGameState,
  useRound,
} from './state/GameState';
import { CrosswordGrid } from './components/CrosswordGrid';
import { Scoreboard } from './components/Scoreboard';
import { SoundToggle } from './components/SoundToggle';
import { AuroraBackground } from './components/AuroraBackground';
import { usePuzzle } from './hooks/usePuzzle';
import { buildInviteUrl, getOrCreateSessionCode } from './lib/sessionCode';
import { seedFor } from './lib/puzzleApi';

function GameHeader({ title, round }: { title: string; round: number }) {
  const game = useGameState();
  return (
    <header className="flex w-full max-w-[480px] animate-pop-in flex-col items-center gap-1 px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
      <div className="flex w-full items-center justify-between">
        <span className="w-9" aria-hidden="true" />
        <h1 className="bg-gradient-to-r from-amber-200 via-orange-100 to-rose-200 bg-clip-text text-center font-display text-2xl font-semibold tracking-wide text-transparent drop-shadow-sm">
          {title}
        </h1>
        <SoundToggle />
      </div>
      <p className="flex items-center gap-2 text-xs font-semibold text-white/70">
        <span className="rounded-full bg-white/15 px-2 py-0.5">Grille {round + 1}</span>
        <span>{game.multiplayer ? '🟢 En direct' : 'Mode local'}</span>
      </p>
    </header>
  );
}

function SessionInviteBar({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    // Surtout pas window.location.href : sur une preview Vercel, cette URL
    // est protégée et forcerait l'invité à se connecter à Vercel.
    await navigator.clipboard.writeText(buildInviteUrl(sessionId));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="my-3 flex animate-pop-in items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white/90 shadow-lg backdrop-blur-md"
      style={{ animationDelay: '0.06s' }}
    >
      <span>
        Partie <strong className="tracking-[0.2em]">{sessionId}</strong>
      </span>
      <button
        type="button"
        onClick={copyLink}
        className="rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber px-3 py-1 font-semibold text-white shadow-sm transition active:scale-95"
      >
        {copied ? '✓ Copié !' : '🔗 Inviter'}
      </button>
    </div>
  );
}

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
      <GameHeader title={puzzle.title} round={round} />
      {hasLiveblocksKey && <SessionInviteBar sessionId={sessionId} />}
      {error && (
        <p className="mb-2 rounded-full bg-amber-400/20 px-3 py-1 text-xs text-amber-100">
          Serveur de grilles injoignable — grille de démonstration
        </p>
      )}
      <Scoreboard />
      <CrosswordGrid puzzle={puzzle} />
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
    <div className="flex min-h-screen flex-col items-center pb-10">
      <AuroraBackground />
      <SessionProvider sessionId={sessionId}>
        <Round sessionId={sessionId} />
      </SessionProvider>
    </div>
  );
}
