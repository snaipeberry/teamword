import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { fetchLeaderboard, type LeaderboardRow } from '../lib/roomClient';
import { activePlayerId } from '../lib/auth';

/**
 * Classement général (multijoueur) OU solo, au choix — deux économies de
 * points séparées (voir server/index.js), donc deux classements séparés.
 */
export function LeaderboardScreen({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'multi' | 'solo'>('multi');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const moi = activePlayerId();

  useEffect(() => {
    setRows(null);
    fetchLeaderboard(50, mode === 'solo' ? 'solo' : undefined)
      .then(setRows)
      .catch(() => setErreur(true));
  }, [mode]);

  return (
    <div className="flex min-h-0 w-full max-w-[380px] flex-1 flex-col gap-3 px-5 py-6">
      <h1 className="shrink-0 text-center font-display text-xl text-organic-text">Classement</h1>

      <div className="flex shrink-0 gap-1.5 rounded-full bg-organic-neutral-200 p-1">
        {(['multi', 'solo'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-full py-1.5 text-[12px] font-bold transition ${
              mode === m ? 'bg-organic-bg text-organic-accent-700 shadow' : 'text-organic-neutral-600'
            }`}
          >
            {m === 'multi' ? 'Multijoueur' : 'Solo'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {erreur && <p className="text-center text-[12px] text-organic-accent-700">Classement indisponible</p>}
        {rows?.length === 0 && (
          <p className="text-center text-[12px] text-organic-neutral-500">
            Personne n’a encore marqué. Soyez le premier !
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {rows?.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.025 }}
              className={`flex items-center gap-2 rounded-[20px] border px-3 py-2 ${
                r.id === moi
                  ? 'border-organic-accent2-300 bg-organic-accent2-200'
                  : 'border-organic-divider bg-organic-neutral-100'
              }`}
            >
              <span className="w-7 shrink-0 text-center font-display text-[13px] text-organic-neutral-600">
                {r.rank}
              </span>
              <Avatar name={r.name} color="#D67F48" src={r.avatar} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-organic-text">{r.name}</span>
                <span className="block truncate text-[10px] text-organic-neutral-500">{r.title}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-[14px] tabular-nums text-organic-text">
                  {r.points}
                </span>
                <span className="block text-[9px] text-organic-neutral-500">
                  {mode === 'solo' ? `${r.soloGrids} grilles` : `${r.wins} v.`}
                </span>
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-full bg-organic-neutral-200 py-2.5 font-display text-[14px] text-organic-text active:scale-95"
      >
        Retour
      </button>
    </div>
  );
}
