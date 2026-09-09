import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { connectRoom, fetchProfile, type Profile, type RoomConnection } from '../lib/roomClient';
import { activePlayerId, activePlayerName, activePlayerToken, currentSession } from '../lib/auth';
import { rememberReturnScreen } from '../lib/sessionCode';
import { Avatar } from './Avatar';

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
  const [profile, setProfile] = useState<Profile | null>(null);
  const connection = useRef<RoomConnection | null>(null);

  // Le bilan face aux derniers adversaires n'existe que pour un compte : un
  // invité change d'identité à chaque rechargement, il n'a par construction
  // aucun historique.
  useEffect(() => {
    if (!currentSession()) return;
    fetchProfile(activePlayerId()).then(setProfile).catch(() => {});
  }, []);

  useEffect(() => {
    // organic.accent2.500 (tailwind.config.js) — le violet précédent était un
    // reliquat de l'ancien thème "Aurora", jamais mis à jour au reskin.
    const moi = { id: activePlayerId(), name: activePlayerName(), color: '#8FA073', token: activePlayerToken() };
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
          // Mémorisé pour que le retour depuis la partie ramène ici à
          // « Multijoueur » (d'où le duel a été lancé), pas à l'accueil pur.
          rememberReturnScreen('multijoueur');
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
      {/* Deux cercles concentriques et, au centre, un bout de grille plutôt
          qu'un chronomètre : l'attente reste dans le vocabulaire du jeu — la
          troisième rangée de cases est encore inconnue, comme l'adversaire.
          (Maquette V2 « la grille est l'interface ».) */}
      <motion.div
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ repeat: Infinity, duration: 1.8 }}
        className="relative flex h-[200px] w-[200px] items-center justify-center"
      >
        <span className="absolute inset-0 rounded-full bg-organic-accent-100" />
        <span className="absolute inset-[26px] rounded-full bg-organic-accent-200" />
        <div className="relative flex flex-col overflow-hidden rounded-lg shadow-sm" aria-hidden="true">
          {[
            ['D', 'U', 'E'],
            ['', 'L', ''],
            ['?', '?', '?'],
          ].map((rangee, r) => (
            <div key={r} className="flex">
              {rangee.map((ch, c) => (
                <span
                  key={c}
                  className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center border-b border-r border-organic-text/10 text-[14px] font-bold ${
                    ch === '?'
                      ? 'bg-organic-neutral-200 text-organic-neutral-500'
                      : ch === ''
                        ? 'bg-organic-neutral-400 text-transparent'
                        : 'bg-organic-accent-500 text-white'
                  }`}
                >
                  {ch}
                </span>
              ))}
            </div>
          ))}
        </div>
      </motion.div>

      <h1 className="mt-6 font-display text-[26px] leading-[1.1] text-organic-text">
        Recherche d’un
        <br />
        adversaire
      </h1>
      {/* Le temps réellement écoulé, pas une moyenne inventée : la maquette
          annonçait « 14 secondes en moyenne », statistique qu'on ne mesure
          nulle part aujourd'hui. */}
      <p className="mt-2 text-[13px] leading-[1.5] text-organic-neutral-700">
        Vous serez placé dans une partie dès qu’un joueur est disponible.
        <br />
        <span className="font-bold tabular-nums">
          Recherche depuis {Math.floor(secondes / 60)}:{String(secondes % 60).padStart(2, '0')}
        </span>
      </p>

      {/* « Vos derniers adversaires » (maquette V2) : l'attente devient un
          moment où l'on revoit ses duels passés, plutôt qu'un écran vide.
          Le bilan est celui du duel classé uniquement — voir `recordOpponent`
          côté serveur. */}
      {profile && profile.recentOpponents.length > 0 && (
        <div className="mt-5 w-full rounded-[20px] bg-organic-surface px-4 py-3.5 text-left">
          <p className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Vos derniers adversaires
          </p>
          <div className="flex flex-col gap-2">
            {profile.recentOpponents.map((o) => (
              <div key={o.id} className="flex items-center gap-2.5">
                <Avatar name={o.name} color="#A19786" src={o.avatar} size={30} square />
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-organic-text">{o.name}</span>
                <span className="shrink-0 rounded-full bg-organic-neutral-200 px-3 py-1.5 text-[11px] font-bold tabular-nums text-organic-neutral-800">
                  {o.wins} – {o.losses}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {erreur && (
        <p className="mt-4 text-[12px] font-bold text-organic-accent-700">Connexion perdue — nouvelle tentative…</p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-8 w-full max-w-[260px] rounded-full border border-organic-neutral-300 py-3 font-display text-[13.5px] text-organic-text active:bg-organic-neutral-200"
      >
        Annuler
      </button>
    </div>
  );
}
