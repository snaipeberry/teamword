import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameState, useRound } from '../state/GameState';
import { fetchProfile, type Profile } from '../lib/roomClient';
import { activePlayerId } from '../lib/auth';
import { goHome, rememberReturnScreen } from '../lib/sessionCode';
import { screenShell } from '../lib/motion';
import { Avatar } from './Avatar';

/**
 * Écran de fin d'un duel classé (1v1 aléatoire) : le match dure 10 minutes
 * (voir server/websocket/index.js, `MATCH_DURATION_MS`) et se conclut soit
 * par le chrono, soit par l'abandon d'un des deux joueurs — jamais par
 * l'avancement des grilles, qui peuvent s'enchaîner plusieurs fois pendant
 * ces 10 minutes. Remplace entièrement l'écran de jeu (voir App.tsx,
 * `SessionRouter`), contrairement à RoundResults qui n'est qu'une pause
 * entre deux grilles.
 */
export function MatchEndScreen() {
  const game = useGameState();
  const {
    ranked, format, winnerId, forfeitedBy, requestRematch, rematchRequestedByMe, rematchRequestedByOpponent,
  } = useRound();
  const myId = activePlayerId();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    // Le classement/niveau affiché doit refléter CE match : le serveur a
    // déjà soldé les points/victoires au moment où cet écran apparaît (voir
    // `concludeRankedMatch`), un simple fetch suffit.
    fetchProfile(myId).then(setProfile).catch(() => {});
  }, [myId]);

  // En coopération, personne ne « gagne » contre personne : l'écran annonce
  // un résultat collectif plutôt qu'un vainqueur, sans quoi une partie entre
  // amis se terminerait par « Défaite » à celui qui a trouvé le moins de
  // mots — exactement le contraire de ce que le mode raconte.
  const cooperatif = !ranked && format === 'coop';
  const gagne = !cooperatif && winnerId === myId;
  const perdu = !cooperatif && winnerId !== null && winnerId !== myId;
  const adversaireAAbandonne = forfeitedBy !== null && forfeitedBy !== myId;
  const jaiAbandonne = forfeitedBy === myId;
  const motsTrouves = game.scoreboard.reduce((n, p) => n + p.score, 0);

  const titre = cooperatif ? 'Temps écoulé' : gagne ? 'Victoire !' : perdu ? 'Défaite' : 'Égalité';
  const sousTitre = jaiAbandonne
    ? 'Vous avez quitté la partie'
    : adversaireAAbandonne
      ? "L'adversaire a quitté la partie"
      : cooperatif
        ? `${motsTrouves} mot${motsTrouves === 1 ? '' : 's'} trouvé${motsTrouves === 1 ? '' : 's'} ensemble`
        : 'Le temps est écoulé';

  const nouvellePartie = () => {
    // Repart direct sur la recherche d'un nouvel adversaire au lieu du menu
    // « Multijoueur » — même ressort que le retour à l'accueil après une
    // partie (voir Home.tsx, `peekReturnScreen`).
    rememberReturnScreen('matchmaking');
    goHome();
  };

  const enAttenteRevanche = rematchRequestedByMe && !rematchRequestedByOpponent;

  return (
    <div className={`${screenShell} items-center justify-center text-center`}>
      <motion.p
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className={`font-display text-[13px] font-bold uppercase tracking-[0.12em] ${
          gagne ? 'text-organic-accent2-700' : perdu ? 'text-organic-accent-700' : 'text-organic-neutral-600'
        }`}
      >
        {ranked ? 'Duel terminé' : 'Partie terminée'}
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mt-1 font-display text-[34px] leading-none text-organic-text"
      >
        {titre}
      </motion.h1>
      <p className="mt-1.5 text-[13px] font-medium text-organic-neutral-600">{sousTitre}</p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-6 flex w-full max-w-[320px] flex-col gap-2"
      >
        {game.scoreboard.map((p) => (
          <div
            key={p.playerId}
            className={`flex items-center gap-2.5 rounded-[20px] border px-3.5 py-2.5 ${
              p.playerId === winnerId
                ? 'border-organic-accent2-300 bg-organic-accent2-200'
                : 'border-organic-divider bg-organic-neutral-100'
            }`}
          >
            <Avatar name={p.isMe ? 'Vous' : p.name} color={p.color} size={30} />
            <span className="min-w-0 flex-1 truncate text-left text-[14px] font-bold text-organic-text">
              {p.isMe ? 'Vous' : p.name}
            </span>
            <span className="font-display text-[19px] tabular-nums text-organic-text">{p.score}</span>
          </div>
        ))}
      </motion.div>

      {profile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="mt-4 flex items-center gap-2 text-[12.5px] font-bold text-organic-neutral-700"
        >
          <span aria-hidden="true">{profile.tier.icon}</span>
          <span>
            {profile.totalPoints} pts · {profile.rank ? `#${profile.rank} au classement` : 'non classé'}
          </span>
        </motion.div>
      )}

      <div className="mt-8 flex w-full max-w-[320px] flex-col gap-2.5">
        {/* Revanche et remise en file d'attente ne concernent que le duel
            classé : une partie privée limitée par le temps n'a pas
            d'adversaire attitré à qui la proposer, ni de file où retourner. */}
        {ranked && (
          <>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={requestRematch}
              disabled={enAttenteRevanche}
              className={`w-full rounded-full py-3.5 font-display text-[15px] shadow-md transition ${
                enAttenteRevanche
                  ? 'cursor-default bg-organic-neutral-200 text-organic-neutral-500'
                  : 'bg-organic-accent-500 text-organic-bg active:bg-organic-accent-600'
              }`}
            >
              {enAttenteRevanche
                ? 'En attente de l’adversaire…'
                : rematchRequestedByOpponent
                  ? "L'adversaire propose une revanche →"
                  : 'Demander une revanche'}
            </motion.button>
            <button
              type="button"
              onClick={nouvellePartie}
              className="w-full rounded-full border border-organic-divider bg-organic-neutral-100 py-3 font-display text-[14px] text-organic-text active:bg-organic-neutral-200"
            >
              Nouvelle partie
            </button>
          </>
        )}
        <button
          type="button"
          onClick={goHome}
          className="w-full py-2 text-[13px] font-bold text-organic-neutral-600 underline underline-offset-2"
        >
          Retour au menu
        </button>
      </div>
    </div>
  );
}
