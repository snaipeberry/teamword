import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { fetchLeaderboard, type LeaderboardRow } from '../lib/roomClient';
import { getOrCreatePlayerId } from '../lib/playerName';

const MEDAL_BY_RANK: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Classement général, trié par points puis par mots trouvés. */
export function LeaderboardScreen({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const moi = getOrCreatePlayerId();

  useEffect(() => {
    fetchLeaderboard(50).then(setRows).catch(() => setErreur(true));
  }, []);

  return (
    <div className="flex min-h-0 w-full max-w-[380px] flex-1 flex-col gap-3 px-5 py-6">
      <h1 className="shrink-0 text-center font-display text-xl font-bold text-white/90">Classement</h1>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {erreur && <p className="text-center text-[12px] text-rose-300">Classement indisponible</p>}
        {rows?.length === 0 && (
          <p className="text-center text-[12px] text-white/40">
            Personne n’a encore marqué. Soyez le premier !
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {rows?.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
                r.id === moi
                  ? 'border-amber-300/50 bg-amber-400/20'
                  : 'border-white/15 bg-white/10'
              }`}
            >
              <span className="w-7 shrink-0 text-center font-display text-[13px] font-bold text-white/70">
                {MEDAL_BY_RANK[r.rank] ?? r.rank}
              </span>
              <Avatar name={r.name} color="#8E7CFF" src={r.avatar} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-white">{r.name}</span>
                <span className="block truncate text-[10px] text-white/50">{r.title}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-[14px] font-bold tabular-nums text-white">
                  {r.points}
                </span>
                <span className="block text-[9px] text-white/45">{r.wins} v.</span>
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-full bg-white/20 py-2.5 font-display text-[14px] font-bold text-white active:scale-95"
      >
        Retour
      </button>
    </div>
  );
}
