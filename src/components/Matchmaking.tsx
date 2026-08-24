import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { connectRoom, type RoomConnection } from '../lib/roomClient';
import { getOrCreatePlayerId, getOrCreatePlayerName } from '../lib/playerName';

/**
 * File d'attente du 1v1 aléatoire.
 *
 * On ouvre une connexion SANS rejoindre de partie : le serveur apparie deux
 * joueurs en attente, crée une partie déjà lancée et renvoie son code aux
 * deux. On n'y entre qu'ensuite.
 */
export function Matchmaking({ onClose }: { onClose: () => void }) {
  const [secondes, setSecondes] = useState(0);
  const [erreur, setErreur] = useState(false);
  const connection = useRef<RoomConnection | null>(null);

  useEffect(() => {
    const conn = connectRoom(
      null,
      { id: getOrCreatePlayerId(), name: getOrCreatePlayerName(), color: '#8E7CFF' },
      {
        onState: () => {},
        onPresence: () => {},
        onBroadcast: () => {},
        onStatus: (connected) => {
          if (connected) conn.send({ t: 'queue' });
          else setErreur(true);
        },
        onMatched: (room) => {
          // Partie déjà démarrée côté serveur : on saute le salon.
          const url = new URL(window.location.href);
          url.searchParams.set('session', room);
          url.searchParams.delete('daily');
          window.location.href = url.toString();
        },
      },
    );
    connection.current = conn;

    const tick = setInterval(() => setSecondes((s) => s + 1), 1000);
    return () => {
      clearInterval(tick);
      conn.send({ t: 'unqueue' });
      conn.close();
    };
  }, []);

  return (
    <div className="flex min-h-0 w-full max-w-[340px] flex-1 flex-col items-center justify-center gap-5 px-5 text-center">
      <motion.span
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ repeat: Infinity, duration: 1.6 }}
        className="text-5xl"
        aria-hidden="true"
      >
        🌍
      </motion.span>
      <h1 className="font-display text-xl font-bold text-white">Recherche d’un adversaire…</h1>
      <p className="text-[13px] text-white/55">
        Vous serez placé dans une partie dès qu’un joueur est disponible.
      </p>
      <p className="font-display text-2xl font-bold tabular-nums text-white/80">
        {Math.floor(secondes / 60)}:{String(secondes % 60).padStart(2, '0')}
      </p>
      {erreur && <p className="text-[12px] font-bold text-rose-300">Connexion perdue — nouvelle tentative…</p>}
      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-white/20 px-5 py-2.5 font-display text-[14px] font-bold text-white active:scale-95"
      >
        Annuler
      </button>
    </div>
  );
}
