import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { fetchLeaderboard, type LeaderboardRow } from '../lib/roomClient';
import { activePlayerId, currentSession } from '../lib/auth';
import { screenShell } from '../lib/motion';
import { BackButton } from './BackButton';

/**
 * Classement — un seul barème pour tout le monde.
 *
 * Il n'y a plus de classement « solo » d'un côté et « multijoueur » de
 * l'autre : les points des deux modes s'additionnent (voir `totalPointsOf`
 * côté serveur), de sorte qu'un joueur exclusivement solo puisse atteindre le
 * même rang qu'un gros joueur multijoueur. Les onglets ne découpent donc plus
 * par MODE mais par PÉRIODE — sauf « Amis », qui filtre par relation.
 */
type Onglet = 'semaine' | 'amis' | 'global';

export function LeaderboardScreen({ onClose }: { onClose: () => void }) {
  const [onglet, setOnglet] = useState<Onglet>('semaine');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const moi = activePlayerId();
  const estInvite = !currentSession();

  useEffect(() => {
    // Un invité n'a pas d'amis (son identité change à chaque visite) :
    // interroger le serveur renverrait une liste vide, autant l'annoncer.
    if (onglet === 'amis' && estInvite) {
      setRows([]);
      return;
    }
    setRows(null);
    setErreur(false);
    // « Amis » restreint le classement au cercle du joueur — d'où l'`id`,
    // que les deux autres portées n'utilisent pas.
    fetchLeaderboard(50, onglet, onglet === 'amis' ? moi : undefined)
      .then(setRows)
      .catch(() => setErreur(true));
  }, [onglet, moi, estInvite]);

  // Podium : les trois premiers, réordonnés 2 – 1 – 3 pour que la marche du
  // vainqueur soit au centre et la plus haute (maquette V2).
  const podium = rows && rows.length >= 3 ? [rows[1], rows[0], rows[2]] : null;
  const reste = podium ? rows!.slice(3) : (rows ?? []);

  return (
    <div className={screenShell}>
      <BackButton onClick={onClose} />
      <h1 className="mt-1.5 shrink-0 font-display text-[30px] leading-none text-organic-text">Classement</h1>

      <div className="mt-3 flex shrink-0 gap-1 rounded-full bg-organic-surface p-1">
        {([
          ['semaine', 'Semaine'],
          ['amis', 'Amis'],
          ['global', 'Global'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setOnglet(k)}
            aria-pressed={onglet === k}
            className={`flex-1 rounded-full py-2 font-display text-[12.5px] transition ${
              onglet === k ? 'bg-organic-bg text-organic-text shadow-sm' : 'text-organic-neutral-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-3.5">
        {erreur && <p className="text-center text-[12px] text-organic-accent-700">Classement indisponible</p>}

        {rows?.length === 0 && (
          <p className="text-center text-[12.5px] leading-[1.5] text-organic-neutral-600">
            {onglet === 'amis'
              ? estInvite
                ? 'Les amis sont rattachés à un compte.'
                : 'Ajoutez des amis pour vous comparer à eux.'
              : onglet === 'semaine'
                ? 'Personne n’a encore marqué cette semaine. Soyez le premier !'
                : 'Personne n’a encore marqué. Soyez le premier !'}
          </p>
        )}

        {rows === null && !erreur && (
          <div className="flex flex-col gap-1.5" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-[52px] animate-pulse rounded-[20px] bg-organic-neutral-100" />
            ))}
          </div>
        )}

        {podium && (
          <div className="mb-4 flex items-end justify-center gap-2.5">
            {podium.map((p) => {
              const taille = p.rank === 1 ? 74 : p.rank === 2 ? 58 : 44;
              return (
                <div key={p.id} className="flex flex-1 flex-col items-center gap-1.5">
                  <Avatar
                    name={p.name}
                    color={p.id === moi ? '#8FA073' : '#A19786'}
                    src={p.avatar}
                    size={taille}
                  />
                  <span className="text-center text-[11.5px] font-bold text-organic-text">{p.name}</span>
                  <span
                    className={`flex w-full items-center justify-center rounded-t-xl font-display text-[15px] text-organic-neutral-800 ${
                      p.rank === 1 ? 'h-[42px] bg-organic-accent2-300' : 'bg-organic-neutral-200'
                    } ${p.rank === 2 ? 'h-[30px]' : p.rank === 3 ? 'h-[22px]' : ''}`}
                  >
                    {p.rank}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {reste.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.025 }}
              className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2 ${
                r.id === moi
                  ? 'border-organic-accent2-300 bg-organic-accent2-200'
                  : 'border-organic-neutral-300 bg-organic-neutral-100'
              }`}
            >
              <span className="w-[18px] shrink-0 text-center font-display text-[13px] text-organic-neutral-700">
                {r.rank}
              </span>
              <Avatar name={r.name} color={r.id === moi ? '#8FA073' : '#A19786'} src={r.avatar} size={28} square />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-organic-text">{r.name}</span>
                <span className="block truncate text-[10.5px] text-organic-neutral-600">{r.title}</span>
              </span>
              <span className="shrink-0 font-display text-[15px] tabular-nums text-organic-text">{r.points}</span>
            </motion.div>
          ))}
        </div>

        {estInvite && onglet !== 'amis' && rows !== null && (
          <p className="mt-4 text-center text-[11px] font-bold text-organic-neutral-600">
            Créez un compte pour apparaître au classement.
          </p>
        )}
      </div>
    </div>
  );
}
