import { useState } from 'react';
import { motion } from 'framer-motion';
import { NameField } from './NameField';
import { getOrCreatePlayerName, setPlayerName } from '../lib/playerName';
import { generateSessionCode } from '../lib/sessionCode';

/**
 * Accueil : choisir son nom, puis créer une partie ou en rejoindre une.
 *
 * Rejoindre passe par un rechargement plutôt qu'un simple changement d'état :
 * le code de partie détermine la room Liveblocks, fixée au montage du
 * provider. Réécrire l'URL sans recharger laisserait l'app connectée à
 * l'ancienne room.
 */
export function Home() {
  const [name, setName] = useState(getOrCreatePlayerName);
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const go = (session: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('session', session);
    window.location.href = url.toString();
  };

  const rejoindre = () => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) {
      setErreur('Code trop court');
      return;
    }
    go(clean);
  };

  return (
    <div className="flex min-h-0 w-full max-w-[380px] flex-1 flex-col items-center justify-center gap-5 px-5">
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-amber-200 via-orange-100 to-rose-200 bg-clip-text text-center font-display text-3xl font-bold text-transparent drop-shadow"
      >
        Mots fléchés
      </motion.h1>

      <div className="w-full">
        <label className="mb-1 block text-center text-[11px] font-bold uppercase tracking-wider text-white/50">
          Votre nom
        </label>
        <NameField value={name} onChange={(n) => setName(setPlayerName(n))} />
      </div>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => go(generateSessionCode())}
        className="w-full rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber py-3 font-display text-[15px] font-bold text-white shadow-xl"
      >
        Créer une partie
      </motion.button>

      <div className="flex w-full items-center gap-3 text-[11px] font-bold uppercase text-white/30">
        <span className="h-px flex-1 bg-white/20" /> ou <span className="h-px flex-1 bg-white/20" />
      </div>

      <div className="w-full">
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setErreur(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') rejoindre();
              e.stopPropagation();
            }}
            maxLength={8}
            aria-label="Code de la partie"
            placeholder="CODE"
            className="min-w-0 flex-1 rounded-full border border-white/25 bg-white/15 px-4 py-2.5 text-center font-display text-[15px] font-bold tracking-[0.25em] text-white placeholder:tracking-normal placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
          />
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={rejoindre}
            className="shrink-0 rounded-full bg-white/20 px-5 py-2.5 font-display text-[14px] font-bold text-white"
          >
            Rejoindre
          </motion.button>
        </div>
        {erreur && <p className="mt-1.5 text-center text-[11px] font-bold text-rose-300">{erreur}</p>}
      </div>
    </div>
  );
}
