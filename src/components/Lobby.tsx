import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { NameField } from './NameField';
import { buildInviteUrl } from '../lib/sessionCode';

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

/**
 * Salon d'attente : code à partager, liste des joueurs, départ.
 *
 * L'exclusion n'est proposée qu'à l'hôte — mais le contrôle réel est dans la
 * mutation `kickPlayer`, masquer le bouton ne protégeant de rien.
 */
export function Lobby({ sessionId }: { sessionId: string }) {
  const game = useGameState();
  const { hostId, startGame, kickPlayer, isKicked } = useRound();
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

  return (
    <div className="flex min-h-0 w-full max-w-[380px] flex-1 flex-col items-center justify-center gap-4 px-5">
      <h1 className="font-display text-xl font-bold text-white/90">Salon</h1>

      {/* Code de la partie */}
      <div className="w-full rounded-3xl border border-white/20 bg-white/10 p-4 text-center backdrop-blur-md">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">Code de la partie</p>
        <p className="my-1.5 font-display text-3xl font-bold tracking-[0.3em] text-white">{sessionId}</p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => copier('code')}
            className="rounded-full bg-white/20 px-3 py-1.5 text-[12px] font-bold text-white active:scale-95"
          >
            {copied === 'code' ? '✓ Copié' : 'Copier le code'}
          </button>
          <button
            type="button"
            onClick={() => copier('lien')}
            className="rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber px-3 py-1.5 text-[12px] font-bold text-white active:scale-95"
          >
            {copied === 'lien' ? '✓ Copié' : '🔗 Lien'}
          </button>
        </div>
      </div>

      {/* Votre nom */}
      <div className="w-full">
        <label className="mb-1 block text-center text-[11px] font-bold uppercase tracking-wider text-white/50">
          Votre nom
        </label>
        <NameField value={game.myName} onChange={game.renameMe} />
      </div>

      {/* Joueurs */}
      <div className="w-full">
        <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-white/50">
          {presents.length} joueur{presents.length > 1 ? 's' : ''}
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
                className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-3 py-2"
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[10px] font-semibold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {initials(p.isMe ? game.myName : p.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
                  {p.isMe ? game.myName : p.name}
                  {p.isMe && <span className="ml-1 text-[10px] font-medium text-white/50">(vous)</span>}
                </span>
                {hostId === p.playerId && (
                  <span className="shrink-0 text-[10px]" title="Hôte">👑</span>
                )}
                {jeSuisHote && !p.isMe && (
                  <button
                    type="button"
                    onClick={() => kickPlayer(p.playerId)}
                    aria-label={`Exclure ${p.name}`}
                    title={`Exclure ${p.name}`}
                    className="shrink-0 rounded-full bg-rose-500/25 px-2 py-1 text-[11px] font-bold text-rose-100 active:scale-95"
                  >
                    Exclure
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {jeSuisHote ? (
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={startGame}
          className="w-full rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber py-3 font-display text-[15px] font-bold text-white shadow-xl"
        >
          Commencer
        </motion.button>
      ) : (
        <p className="text-center text-[12px] font-semibold text-white/50">
          En attente du lancement par l’hôte…
        </p>
      )}
    </div>
  );
}

/** Écran affiché au joueur exclu : il ne doit pas pouvoir revenir tout seul. */
export function KickedScreen() {
  return (
    <div className="flex min-h-0 w-full max-w-[340px] flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
      <span className="text-4xl" aria-hidden="true">👋</span>
      <h1 className="font-display text-xl font-bold text-white">Vous avez quitté la partie</h1>
      <p className="text-[13px] text-white/60">L’hôte vous a retiré du salon.</p>
      <button
        type="button"
        onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('session');
          window.location.href = url.toString();
        }}
        className="rounded-full bg-white/20 px-5 py-2.5 font-display text-[14px] font-bold text-white active:scale-95"
      >
        Retour à l’accueil
      </button>
    </div>
  );
}
