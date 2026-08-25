import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { generateSessionCode } from '../lib/sessionCode';
import { activePlayerId, activePlayerName, currentSession } from '../lib/auth';
import { dailyLabel } from '../lib/puzzleApi';
import { Matchmaking } from './Matchmaking';
import { ProfileScreen } from './Profile';
import { LeaderboardScreen } from './Leaderboard';
import { BackButton } from './BackButton';
import { screenClassName, screenShell, screenTransition, screenVariants } from '../lib/motion';

/**
 * Accueil : choisir son nom, puis Solo / Multijoueur / Grille du jour.
 *
 * Rejoindre passe par un rechargement plutôt qu'un simple changement d'état :
 * le code de partie détermine la room, fixée au montage du provider.
 * Réécrire l'URL sans recharger laisserait l'app connectée à l'ancienne room.
 */
type Ecran = 'accueil' | 'multijoueur' | 'matchmaking' | 'profil' | 'classement';

export function Home() {
  const name = activePlayerName();
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [ecran, setEcran] = useState<Ecran>('accueil');
  // Solo et grille du jour n'ont de sens qu'avec une progression qui
  // survit : inutile de les proposer à un invité dont l'identité disparaît
  // au prochain rechargement — ça ne ferait que promettre une "progression
  // infinie" qui repart de zéro à chaque visite.
  const estInvite = !currentSession();

  const go = (session: string, opts: { daily?: boolean; bot?: boolean; solo?: boolean } = {}) => {
    const url = new URL(window.location.href);
    url.searchParams.set('session', session);
    for (const [param, actif] of [
      ['daily', opts.daily],
      ['bot', opts.bot],
      ['solo', opts.solo],
    ] as const) {
      if (actif) url.searchParams.set(param, '1');
      else url.searchParams.delete(param);
    }
    window.location.href = url.toString();
  };

  // Code déterministe, pas aléatoire : rouvrir Solo doit rejoindre la MÊME
  // salle et reprendre la progression, pas en démarrer une nouvelle. Le
  // serveur refuse d'ailleurs qu'un autre joueur la rejoigne (voir join dans
  // server/index.js) — c'est ce code qui fait office d'autorisation.
  const jouerSolo = () => go(`solo-${activePlayerId()}`, { solo: true });

  const rejoindre = () => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) {
      setErreur('Code trop court');
      return;
    }
    go(clean);
  };

  let screen: React.ReactNode;
  if (ecran === 'matchmaking') {
    screen = <Matchmaking onClose={() => setEcran('multijoueur')} />;
  } else if (ecran === 'profil') {
    screen = <ProfileScreen onClose={() => setEcran('accueil')} />;
  } else if (ecran === 'classement') {
    screen = <LeaderboardScreen onClose={() => setEcran('accueil')} />;
  } else if (ecran === 'multijoueur') {
    screen = (
      <div className={screenShell}>
        <BackButton onClick={() => setEcran('accueil')} />
        <h1 className="mt-1.5 font-display text-[30px] leading-none text-organic-text">Multijoueur</h1>

        {/* Mêmes cartes que le menu d'accueil : les quatre façons de jouer à
            plusieurs se lisent d'un coup d'œil, au lieu d'un bouton principal
            suivi de pastilles secondaires de tailles différentes. */}
        <div className="mt-5 flex flex-col gap-3">
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => setEcran('matchmaking')}
            className="relative w-full overflow-hidden rounded-[28px] bg-organic-accent-500 py-4 text-left shadow-md active:bg-organic-accent-600"
          >
            <span className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15" />
            <span className="relative block px-5 font-display text-[21px] text-organic-bg">Duel aléatoire</span>
            <span className="relative mt-0.5 block px-5 text-[12.5px] font-semibold text-organic-bg/80">
              Contre un joueur au hasard — partie classée
            </span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => go(generateSessionCode())}
            className="relative w-full overflow-hidden rounded-[28px] bg-organic-accent2-300 py-4 text-left text-organic-accent2-900 active:bg-organic-accent2-400"
          >
            <span className="pointer-events-none absolute -bottom-7 -right-5 h-[88px] w-[88px] rounded-full bg-white/35" />
            <span className="relative block px-5 font-display text-[21px]">Partie privée</span>
            <span className="relative mt-0.5 block px-5 text-[12.5px] font-semibold text-organic-accent2-800">
              Coop ou équipes, sur invitation
            </span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => go(generateSessionCode(), { bot: true })}
            className="w-full rounded-[28px] border border-organic-divider bg-organic-neutral-100 px-5 py-4 text-left text-organic-text active:bg-organic-neutral-200"
          >
            <span className="block font-display text-[19px]">Contre un bot</span>
            <span className="mt-0.5 block text-[12.5px] font-semibold text-organic-neutral-700">
              Pour s’entraîner — hors classement
            </span>
          </motion.button>
        </div>

        {/* Rejoindre : une action de saisie, pas un choix de mode — d'où la
            séparation visuelle plutôt qu'une quatrième carte. */}
        <div className="mt-6 w-full">
          <label
            htmlFor="code-partie"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600"
          >
            Rejoindre une partie
          </label>
          <div className="flex gap-2.5">
            <input
              id="code-partie"
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
              className="min-w-0 flex-1 rounded-full border border-organic-neutral-300 bg-organic-neutral-100 px-4 py-3 text-center font-display text-[15px] tracking-[0.25em] text-organic-text placeholder:tracking-normal placeholder:text-organic-neutral-500 focus:outline-none focus:ring-2 focus:ring-organic-accent-500"
            />
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={rejoindre}
              className="shrink-0 rounded-full bg-organic-neutral-200 px-5 py-3 font-display text-[14px] text-organic-text active:bg-organic-neutral-300"
            >
              Rejoindre
            </motion.button>
          </div>
          {erreur && <p className="mt-1.5 text-[11px] font-bold text-organic-accent-700">{erreur}</p>}
        </div>
      </div>
    );
  } else {
    screen = (
      <div className={screenShell}>
      <motion.p
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-[11px] font-bold uppercase tracking-[0.12em] text-organic-accent-700"
      >
        Mots fléchés à plusieurs
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-0.5 font-display text-[40px] leading-none text-organic-text"
      >
        TeamWords
      </motion.h1>

      {/* Nom fixe dans les deux cas (pseudo du compte, ou nom généré pour
          l'invité) : plus aucune UI ne permet de le changer, voir auth.ts.
          Un compte le connaît déjà (c'est son pseudo de connexion) — inutile
          de le réafficher ici ; l'invité, lui, ne le découvre que là. */}
      {estInvite && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mt-5 flex items-center gap-2.5 rounded-full border border-organic-neutral-300 bg-organic-neutral-100 py-2 pl-4 pr-2"
        >
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-organic-neutral-600">Nom</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-organic-text">{name}</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-organic-accent2-500 text-[12px] font-bold text-white">
            {name.replace(/^Guest/, '').slice(0, 2).toUpperCase()}
          </span>
        </motion.div>
      )}

      <div className="mt-[18px] flex flex-col gap-3">
      <motion.button
        type="button"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setEcran('multijoueur')}
        className="relative w-full overflow-hidden rounded-[28px] bg-organic-accent-500 py-4 text-left shadow-md active:bg-organic-accent-600"
      >
        <span className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15" />
        <span className="relative block px-5 font-display text-[21px] text-organic-bg">Multijoueur</span>
        <span className="relative mt-0.5 block px-5 text-[12.5px] font-semibold text-organic-bg/80">
          Duel aléatoire, partie privée ou contre un bot
        </span>
      </motion.button>

      <motion.button
        type="button"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        whileTap={estInvite ? undefined : { scale: 0.96 }}
        disabled={estInvite}
        onClick={jouerSolo}
        title={estInvite ? 'Créez un compte pour jouer en solo' : undefined}
        className={`relative w-full overflow-hidden rounded-[28px] bg-organic-accent2-300 py-4 text-left text-organic-accent2-900 ${
          estInvite ? 'opacity-50' : ''
        }`}
      >
        <span className="pointer-events-none absolute -bottom-7 -right-5 h-[88px] w-[88px] rounded-full bg-white/35" />
        <span className="relative block px-5 font-display text-[21px]">Solo</span>
        <span className="relative mt-0.5 block px-5 text-[12.5px] font-semibold text-organic-accent2-800">
          {estInvite ? 'Nécessite un compte — progression sans lui' : 'Progression infinie — points, paliers et ampoules'}
        </span>
      </motion.button>

      <motion.button
        type="button"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        whileTap={estInvite ? undefined : { scale: 0.96 }}
        disabled={estInvite}
        onClick={() => go(generateSessionCode(), { daily: true })}
        title={estInvite ? 'Créez un compte pour jouer la grille du jour' : undefined}
        className={`w-full rounded-[28px] border border-organic-divider bg-organic-neutral-100 px-5 py-4 text-left text-organic-text active:bg-organic-neutral-200 ${
          estInvite ? 'opacity-50' : ''
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[19px]">Grille du jour</span>
          {!estInvite && (
            <span className="text-[11px] font-bold uppercase tracking-wide text-organic-accent-700">{dailyLabel()}</span>
          )}
        </span>
        <span className="mt-0.5 block text-[12.5px] font-semibold text-organic-neutral-700">
          {estInvite ? 'Nécessite un compte' : 'La même pour tous · plus difficile'}
        </span>
      </motion.button>
      </div>

      {estInvite && (
        <button
          type="button"
          onClick={() => setEcran('profil')}
          className="mt-3.5 text-left text-[11px] font-bold text-organic-neutral-600 underline underline-offset-2"
        >
          Vous jouez en invité — créer un compte pour tout débloquer
        </button>
      )}

      {/* Collé au bas du cadre (maquette Organic) plutôt que flottant sous
          les boutons : c'est ce qui donne à l'écran sa tenue d'application. */}
      <div className="mt-auto flex w-full gap-2.5 pb-3.5 pt-4">
        <button
          type="button"
          onClick={() => setEcran('profil')}
          className="flex-1 rounded-full border border-organic-neutral-300 py-2.5 font-display text-[13px] text-organic-text active:bg-organic-neutral-200"
        >
          Profil
        </button>
        <button
          type="button"
          onClick={() => setEcran('classement')}
          className="flex-1 rounded-full border border-organic-neutral-300 py-2.5 font-display text-[13px] text-organic-text active:bg-organic-neutral-200"
        >
          Classement
        </button>
      </div>
    </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={ecran}
        variants={screenVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={screenTransition}
        className={screenClassName}
      >
        {screen}
      </motion.div>
    </AnimatePresence>
  );
}
