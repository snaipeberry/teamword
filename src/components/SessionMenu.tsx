import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRound } from '../state/GameState';
import { startNewSession } from '../lib/sessionCode';

/**
 * Menu de gestion de la partie.
 *
 * Deux actions volontairement distinctes, parce qu'elles n'ont pas du tout
 * les mêmes conséquences pour les autres joueurs :
 *
 * - « Recommencer » remet la partie à zéro EN GARDANT la session : le code
 *   ne change pas, les autres joueurs restent connectés et voient la remise
 *   à zéro immédiatement.
 * - « Nouvelle session » crée un code neuf, donc QUITTE la partie en cours ;
 *   les autres y restent, seuls, avec l'ancien lien.
 *
 * Les deux détruisent des scores, d'où la confirmation en deux temps : le
 * bouton demande à être confirmé avant d'agir.
 */
type Pending = 'restart' | 'new' | null;

export function SessionMenu({ multiplayer }: { multiplayer: boolean }) {
  const { resetSession } = useRound();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Referme au clic extérieur et à Échap : sans cela le menu resterait
  // ouvert par-dessus la grille et intercepterait les appuis.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setPending(null);
  };

  const confirm = (action: Exclude<Pending, null>) => {
    if (pending !== action) {
      setPending(action);
      return;
    }
    close();
    if (action === 'restart') resetSession();
    else startNewSession();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Menu de la partie"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition active:scale-90"
      >
        <span className="text-base leading-none" aria-hidden="true">⋯</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-white/20 bg-[#3D1F63]/95 p-1.5 shadow-2xl backdrop-blur-lg"
          >
            <button
              type="button"
              onClick={() => confirm('restart')}
              className={`w-full rounded-xl px-3 py-2 text-left text-[12px] font-bold transition ${
                pending === 'restart'
                  ? 'bg-amber-400 text-neutral-900'
                  : 'text-white active:bg-white/15'
              }`}
            >
              {pending === 'restart' ? '⚠️ Confirmer la remise à zéro' : '↻ Recommencer la partie'}
              <span className="mt-0.5 block text-[10px] font-medium opacity-70">
                {pending === 'restart'
                  ? 'Scores et grilles effacés pour tout le monde'
                  : multiplayer
                    ? 'Garde la session et les joueurs'
                    : 'Retour à la grille 1'}
              </span>
            </button>

            {multiplayer && (
              <button
                type="button"
                onClick={() => confirm('new')}
                className={`mt-1 w-full rounded-xl px-3 py-2 text-left text-[12px] font-bold transition ${
                  pending === 'new'
                    ? 'bg-amber-400 text-neutral-900'
                    : 'text-white active:bg-white/15'
                }`}
              >
                {pending === 'new' ? '⚠️ Confirmer' : '✦ Nouvelle session'}
                <span className="mt-0.5 block text-[10px] font-medium opacity-70">
                  {pending === 'new'
                    ? 'Vous quitterez la partie en cours'
                    : 'Nouveau code — les autres restent sur l’ancien'}
                </span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
