import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { connectRoom, type RoomConnection } from '../lib/roomClient';
import { activePlayerId, activePlayerName, activePlayerToken } from '../lib/auth';

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
    const moi = { id: activePlayerId(), name: activePlayerName(), color: '#8E7CFF', token: activePlayerToken() };
    const conn = connectRoom(
      null,
      moi,
      {
        onState: () => {},
        onPresence: () => {},
        onStatus: (connected) => {
          // Identité transmise ICI (pas seulement à `join`, jamais envoyé en
          // file d'attente) : le serveur doit savoir qui demande un
          // adversaire pour pouvoir vérifier les blocages avant d'apparier.
          if (connected) conn.send({ t: 'queue', player: moi });
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
    <div className="flex min-h-0 w-full max-w-[340px] flex-1 flex-col items-center justify-center gap-0 px-5 text-center">
      <motion.div
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ repeat: Infinity, duration: 1.6 }}
        className="flex h-[186px] w-[186px] items-center justify-center rounded-full bg-organic-accent-100"
      >
        <div className="flex h-[132px] w-[132px] items-center justify-center rounded-full bg-organic-accent-200">
          <div className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-organic-accent-500 font-display text-[19px] text-organic-bg">
            {Math.floor(secondes / 60)}:{String(secondes % 60).padStart(2, '0')}
          </div>
        </div>
      </motion.div>
      <h1 className="mt-6 font-display text-2xl leading-tight text-organic-text">Recherche d’un adversaire</h1>
      <p className="mt-2 text-[13.5px] text-organic-neutral-700">
        Vous serez placé dans une partie dès qu’un joueur est disponible.
      </p>
      <div className="mt-5 flex gap-1.5">
        <span className="h-[9px] w-[9px] rounded-full bg-organic-accent-500" />
        <span className="h-[9px] w-[9px] rounded-full bg-organic-accent-300" />
        <span className="h-[9px] w-[9px] rounded-full bg-organic-neutral-300" />
      </div>
      {erreur && (
        <p className="mt-4 text-[12px] font-bold text-organic-accent-700">Connexion perdue — nouvelle tentative…</p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-8 rounded-full border border-organic-divider px-7 py-3 font-display text-[14px] text-organic-text active:bg-organic-neutral-200"
      >
        Annuler
      </button>
    </div>
  );
}
