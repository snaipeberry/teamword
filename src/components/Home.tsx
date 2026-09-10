import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { clearReturnScreen, generateSessionCode, peekReturnScreen, rememberReturnScreen } from '../lib/sessionCode';
import { activePlayerId, activePlayerName, currentSession } from '../lib/auth';
import { dailyLabel } from '../lib/puzzleApi';
import { fetchFriends, fetchProfile, type FriendState, type Profile } from '../lib/roomClient';
import { PRESENCE_PING_MS } from '../lib/presence';
import { playStreakSound, playTapSound, playTickSound, playTierUpSound, playWrongSound, unlockAudio } from '../lib/sounds';
/**
 * Écrans secondaires chargés à la demande.
 *
 * Ils partaient dans le paquet principal alors qu'on atterrit presque
 * toujours sur l'accueil : leur code — classement, profil, amis, recherche
 * d'adversaire — était téléchargé avant le premier pixel, pour n'être utilisé
 * que si l'on y va. Séparés, l'accueil s'affiche avec ce dont il a besoin.
 */
const Matchmaking = lazy(() => import('./Matchmaking').then((m) => ({ default: m.Matchmaking })));
const ProfileScreen = lazy(() => import('./Profile').then((m) => ({ default: m.ProfileScreen })));
const LeaderboardScreen = lazy(() => import('./Leaderboard').then((m) => ({ default: m.LeaderboardScreen })));
const FriendsScreen = lazy(() => import('./Friends').then((m) => ({ default: m.FriendsScreen })));

/** Repli le temps du chargement : la même ossature d'écran, pour que rien ne
 *  saute quand le vrai contenu arrive. */
function EcranEnAttente() {
  return (
    <div className={screenShell} aria-busy="true">
      <div className="mt-12 h-6 w-32 animate-pulse rounded-full bg-organic-neutral-200" />
      <div className="mt-5 flex flex-col gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[52px] animate-pulse rounded-[20px] bg-organic-neutral-100" />
        ))}
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
import { Avatar } from './Avatar';
import { screenClassName, screenShell, screenTransition, screenVariants } from '../lib/motion';
import { useDialog } from '../hooks/useDialog';
import { announce } from '../lib/announce';

/**
 * Accueil — mise en page V2 (maquette Claude Design
 * d9d2c198-ef37-47f9-b49d-9fef1d81f767, « la grille est l'interface »).
 *
 * Le principe : la case carrée sert de brique partout. La grille du jour est
 * un vrai fragment de grille qui déborde du bord droit, les modes forment une
 * mosaïque asymétrique (Duel en grand) au lieu de trois boutons alignés, et
 * la série se lit comme une frise de cases.
 *
 * Le sous-écran « Multijoueur » a disparu : Duel, Entre amis et Rejoindre
 * sont désormais directement sur l'accueil, ce qui retire un niveau de
 * navigation. Solo et Contre un bot gardent leur place en bas de la mosaïque
 * — la maquette ne les montrait pas, mais ce sont des modes existants qu'il
 * n'y avait aucune raison de retirer au passage.
 *
 * Rejoindre passe par un rechargement plutôt qu'un simple changement d'état :
 * le code de partie détermine la room, fixée au montage du provider.
 * Réécrire l'URL sans recharger laisserait l'app connectée à l'ancienne room.
 */
type Ecran = 'accueil' | 'matchmaking' | 'profil' | 'classement' | 'amis';

const ECRANS_VALIDES: Ecran[] = ['accueil', 'matchmaking', 'profil', 'classement', 'amis'];

/**
 * Fragment de grille décoratif de la carte « Grille du jour ».
 *
 * Volontairement figé plutôt que tiré de la vraie grille du jour : celle-ci
 * n'est chargée qu'une fois la partie ouverte, et la réclamer ici ajouterait
 * un aller-retour réseau au premier écran pour une vignette de 132px.
 */
const HERO_BLANKS = new Set(['0-0', '5-0', '5-5', '6-5']);
const HERO_CLUES = new Set(['0-1', '0-2', '0-3', '0-4', '0-5', '1-0', '6-0']);
const HERO_LETTRES: Record<string, string> = {
  '1-1': 'C', '1-2': 'A', '1-3': 'F', '1-4': 'E', '2-1': 'H', '3-1': 'I',
};

/** Alphabet réel des codes de partie (voir `generateSessionCode`) : ni I, ni
 *  L, ni O, ni 0/1 — on ne les met donc pas sur le pavé. */
const PAVE_CODE = [
  ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'P'],
  ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'M'],
  ['W', 'X', 'C', 'V', 'B', 'N'],
  ['2', '3', '4', '5', '6', '7', '8', '9'],
];

const CASES_CODE = 6;

/** Dernière série connue, pour repérer une prolongation d'une visite à
 *  l'autre — le retour de la grille du jour recharge la page. */
const SERIE_CONNUE_KEY = 'mf_serie_connue';

/** Dernier palier connu, même principe : c'est en revenant d'une partie
 *  qu'on l'a franchi, et la page a été rechargée entre-temps. */
const PALIER_CONNU_KEY = 'mf_palier_connu';

export function Home() {
  const name = activePlayerName();
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [rejoindreOuvert, setRejoindreOuvert] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [amis, setAmis] = useState<FriendState | null>(null);
  // Rejoindre une partie force un rechargement complet (voir `go`), qui
  // efface cet état — sans quoi le bouton retour d'un salon ou d'une grille
  // renverrait toujours à l'accueil pur, même quand on venait d'ailleurs.
  //
  // `peekReturnScreen` (SANS effet de bord) plutôt qu'une lecture qui efface
  // en même temps : `Home` n'est monté que si `App.tsx` a décidé qu'il n'y a
  // PAS de session dans l'URL — quand on atterrit sur `?session=…` juste
  // après un `go()`, ce composant n'existe même pas, donc rien ne doit
  // consommer le repère à ce moment-là. Seul l'effet ci-dessous, qui ne
  // s'exécute QUE si `Home` monte réellement, l'efface — une fois utilisé.
  const [ecran, setEcran] = useState<Ecran>(() => {
    const restored = peekReturnScreen();
    return (ECRANS_VALIDES as string[]).includes(restored ?? '') ? (restored as Ecran) : 'accueil';
  });
  useEffect(() => {
    clearReturnScreen();
  }, []);
  // Solo et grille du jour n'ont de sens qu'avec une progression qui
  // survit : inutile de les proposer à un invité dont l'identité disparaît
  // au prochain rechargement — ça ne ferait que promettre une "progression
  // infinie" qui repart de zéro à chaque visite.
  const estInvite = !currentSession();

  // Série, rang du jour et titre viennent du profil serveur. Un invité n'en a
  // pas de significatif : on ne le demande donc pas, et les sections qui en
  // dépendent ne s'affichent tout simplement pas.
  useEffect(() => {
    if (estInvite) return;
    fetchProfile(activePlayerId()).then(setProfile).catch(() => {});
  }, [estInvite]);

  // La liste d'amis, elle, se relit en boucle : « en ligne » change sans
  // qu'on touche à rien, et une pastille qui n'est juste qu'au chargement de
  // la page ne vaut pas mieux que pas de pastille du tout. Même cadence que
  // le battement de présence, à l'arrêt quand l'onglet n'est pas à l'écran.
  useEffect(() => {
    if (estInvite) return;
    const charger = () => void fetchFriends(activePlayerId()).then(setAmis).catch(() => {});
    // Le premier chargement n'est PAS conditionné à la visibilité : une page
    // ouverte en arrière-plan (onglet restauré, application relancée) doit
    // avoir ses données prêtes quand on y arrive, pas commencer à les
    // chercher à ce moment-là. Seules les relectures suivantes s'économisent.
    charger();
    const relire = () => {
      if (document.visibilityState === 'visible') charger();
    };
    const minuteur = window.setInterval(relire, PRESENCE_PING_MS);
    document.addEventListener('visibilitychange', relire);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener('visibilitychange', relire);
    };
  }, [estInvite]);

  const moinsDeMouvement = useReducedMotion();
  // La feuille « Rejoindre » n'était qu'un calque : rien ne s'y focalisait,
  // Échap ne la fermait pas, et la tabulation continuait derrière elle.
  const feuilleRef = useDialog<HTMLDivElement>(rejoindreOuvert, () => setRejoindreOuvert(false));
  // Rejoindre provoque un rechargement complet : sans état d'attente, le
  // bouton restait muet pendant tout le temps de la navigation.
  const [rejoint, setRejoint] = useState(false);

  /**
   * La série vient-elle d'être prolongée ?
   *
   * Revenir de la grille du jour passe par un rechargement complet : il n'y a
   * aucun état en mémoire à comparer. On garde donc la dernière valeur connue
   * d'une visite à l'autre — c'est le seul moment où la série se voit
   * grandir, et il tombait jusqu'ici dans le vide.
   */
  const [serieProlongee, setSerieProlongee] = useState(false);
  useEffect(() => {
    if (!profile) return;
    const avant = Number(localStorage.getItem(SERIE_CONNUE_KEY) ?? '-1');
    localStorage.setItem(SERIE_CONNUE_KEY, String(profile.streak));
    if (avant < 0 || profile.streak <= avant) return;
    setSerieProlongee(true);
    playStreakSound();
    const t = setTimeout(() => setSerieProlongee(false), 1400);
    return () => clearTimeout(t);
  }, [profile]);

  /**
   * Palier franchi.
   *
   * Le serveur le détecte déjà et offre cinq indices en plus (voir
   * `soloGridDone`), mais le joueur n'en savait rien : un chiffre avait
   * changé, voilà tout. C'est une récompense déjà gagnée qui passait
   * inaperçue — de loin la plus grosse perte de la liste.
   */
  const [palierAtteint, setPalierAtteint] = useState<string | null>(null);
  useEffect(() => {
    if (!profile) return;
    const avant = localStorage.getItem(PALIER_CONNU_KEY);
    localStorage.setItem(PALIER_CONNU_KEY, profile.tier.id);
    if (!avant || avant === profile.tier.id) return;
    setPalierAtteint(profile.tier.label);
    playTierUpSound();
    const t = setTimeout(() => setPalierAtteint(null), 4200);
    return () => clearTimeout(t);
  }, [profile]);

  const go = (session: string, opts: { daily?: boolean; bot?: boolean; solo?: boolean } = {}) => {
    // Premier geste de la visite : c'est ici qu'iOS autorise enfin le son.
    unlockAudio();
    playTapSound();
    // Voir la déclaration de `ecran` ci-dessus : mémorisé pour que le retour
    // depuis la partie qu'on rejoint ici nous ramène ICI, pas à l'accueil.
    rememberReturnScreen(ecran);
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
      // Action refusée — surtout pas le même son qu'une mauvaise lettre :
      // ce jeu ne juge jamais la saisie, il constate qu'il manque des cases.
      playWrongSound();
      announce('Code trop court : il faut au moins quatre caractères.', 'erreur');
      return;
    }
    setRejoint(true);
    announce(`Connexion au salon ${clean}…`);
    go(clean);
  };

  const taper = (ch: string) => {
    setErreur(null);
    unlockAudio();
    playTickSound();
    setCode((c) => (c.length >= CASES_CODE ? c : c + ch));
  };

  /**
   * Une case de la vignette du jour s'éclaire faiblement, à intervalle
   * irrégulier et jamais deux fois la même d'affilée. L'accueil vit sans
   * faire de bruit ni demander quoi que ce soit — c'est le seul effet de
   * cette liste qui n'attend aucune action du joueur.
   */
  const [caseEveillee, setCaseEveillee] = useState<string | null>(null);
  useEffect(() => {
    if (ecran !== 'accueil' || moinsDeMouvement) return;
    let minuteur: number;
    const suivante = () => {
      const r = Math.floor(Math.random() * 7);
      const c = Math.floor(Math.random() * 6);
      setCaseEveillee(`${r}-${c}`);
      window.setTimeout(() => setCaseEveillee(null), 900);
      minuteur = window.setTimeout(suivante, 1600 + Math.random() * 2600);
    };
    minuteur = window.setTimeout(suivante, 1200);
    return () => window.clearTimeout(minuteur);
  }, [ecran, moinsDeMouvement]);

  const celebrationPalier = palierAtteint && profile && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-organic-neutral-900/35 backdrop-blur-[2px] px-6"
    >
      <motion.div
        initial={{ scale: 0.8, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="flex w-full max-w-[300px] flex-col items-center gap-1 rounded-[28px] bg-organic-bg px-6 py-7 text-center shadow-xl"
      >
        <span className="text-[38px]" aria-hidden="true">{profile.tier.icon}</span>
        <p className="mt-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-organic-neutral-600">
          Nouveau palier
        </p>
        <p className="font-display text-[26px] leading-none text-organic-text">{palierAtteint}</p>
        <p className="mt-2 text-[12.5px] font-bold text-organic-accent2-800">+5 indices</p>
      </motion.div>
    </motion.div>
  );

  let screen: React.ReactNode;
  if (ecran === 'matchmaking') {
    screen = <Matchmaking onClose={() => setEcran('accueil')} />;
  } else if (ecran === 'profil') {
    screen = <ProfileScreen onClose={() => setEcran('accueil')} />;
  } else if (ecran === 'classement') {
    screen = <LeaderboardScreen onClose={() => setEcran('accueil')} />;
  } else if (ecran === 'amis') {
    screen = <FriendsScreen onClose={() => setEcran('accueil')} />;
  } else {
    screen = (
      <div className={`${screenShell} overflow-y-auto`}>
        {/* En-tête : la vignette est carrée à coins doux, comme une case de
            grille — c'est le motif que le V2 décline partout. */}
        <div className="flex shrink-0 items-center gap-2.5">
          <Avatar name={name} color="#728157" src={profile?.avatar} size={30} square />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-bold leading-tight text-organic-text">{name}</p>
            {/* Le PALIER fait office de rang, et les points sont le total
                tous modes : un joueur qui ne fait que du solo affiche le même
                genre de rang qu'un joueur multijoueur (voir `totalPointsOf`
                côté serveur). */}
            <p className="mt-px text-[10.5px] font-bold uppercase tracking-[0.05em] text-organic-accent-700">
              {profile ? `${profile.tier.label} · ${profile.totalPoints}` : estInvite ? 'Invité' : '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEcran('profil')}
            aria-label="Profil"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-organic-neutral-300 text-[14px] font-bold text-organic-neutral-700 active:bg-organic-neutral-200"
          >
            ›
          </button>
        </div>

        {/* Grille du jour : un vrai bout de grille qui déborde du bord droit,
            plutôt qu'une carte illustrée. */}
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={estInvite ? undefined : { scale: 0.98 }}
          disabled={estInvite}
          onClick={() => go(generateSessionCode(), { daily: true })}
          className={`relative mt-3.5 w-full shrink-0 overflow-hidden rounded-[28px] bg-organic-accent2-200 text-left ${
            estInvite ? 'opacity-40' : ''
          }`}
        >
          <span className="pointer-events-none absolute -bottom-10 -left-[30px] h-[110px] w-[110px] rounded-full bg-white/30" />
          <span className="relative flex items-stretch">
            <span className="min-w-0 flex-1 py-4 pl-[18px]">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-accent2-800">
                {dailyLabel()}
              </span>
              <span className="mt-0.5 block font-display text-[26px] leading-[1.05] text-organic-accent2-900">
                Grille
                <br />
                du jour
              </span>
              <span className="mt-2 block text-[11.5px] font-bold text-organic-accent2-800">
                {estInvite
                  ? 'Nécessite un compte'
                  : profile?.dailyDone
                    ? 'Déjà terminée aujourd’hui'
                    : 'La même pour tous · plus difficile'}
              </span>
              <span className="mt-3 inline-block rounded-full bg-organic-accent2-800 px-[18px] py-[9px] font-display text-[13px] text-white">
                {profile?.dailyDone ? 'Rejouer' : 'Jouer'}
              </span>
            </span>
            <span className="flex w-[132px] shrink-0 items-center overflow-hidden" aria-hidden="true">
              <span className="ml-1.5 flex flex-col overflow-hidden rounded-[6px]">
                {Array.from({ length: 7 }, (_, r) => (
                  <span key={r} className="flex">
                    {Array.from({ length: 6 }, (_, c) => {
                      const id = `${r}-${c}`;
                      const lettre = HERO_LETTRES[id];
                      const fond = HERO_BLANKS.has(id)
                        ? 'bg-organic-accent2-400 text-transparent'
                        : HERO_CLUES.has(id)
                          ? 'bg-organic-accent2-300 text-organic-accent2-900'
                          : lettre
                            ? 'bg-organic-accent2-500 text-white'
                            : 'bg-organic-neutral-100 text-organic-text';
                      return (
                        <span
                          key={c}
                          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center border-b border-r border-organic-text/10 text-[10px] font-bold transition-[filter,opacity] duration-700 ${fond} ${
                            caseEveillee === id ? 'brightness-125 opacity-100' : ''
                          }`}
                        >
                          {lettre ?? ''}
                        </span>
                      );
                    })}
                  </span>
                ))}
              </span>
            </span>
          </span>
        </motion.button>

        {/* Mosaïque asymétrique : Duel en grand, le reste en satellites. */}
        <div className="mt-2.5 grid shrink-0 grid-cols-2 gap-[9px]">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setEcran('matchmaking')}
            className="relative row-span-2 overflow-hidden rounded-[28px] bg-organic-accent-500 p-4 text-left text-white shadow-md active:bg-organic-accent-600"
          >
            <span className="pointer-events-none absolute -right-6 -top-6 h-[88px] w-[88px] rounded-full bg-white/[0.16]" />
            <span className="relative block font-display text-[22px] leading-none">Duel</span>
            <span className="relative mt-1 block text-[11.5px] font-semibold leading-[1.35] text-white/85">
              Course sur la
              <br />
              même grille
            </span>
            {profile && profile.games > 0 && (
              <>
                <span className="relative mt-3.5 flex gap-[3px]">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span
                      key={i}
                      className={`block h-[5px] w-3 rounded-full ${
                        i < Math.round((profile.wins / profile.games) * 5) ? 'bg-white/95' : 'bg-white/35'
                      }`}
                    />
                  ))}
                </span>
                <span className="relative mt-1.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-white/80">
                  {profile.wins} victoire{profile.wins === 1 ? '' : 's'} · {profile.games} partie
                  {profile.games === 1 ? '' : 's'}
                </span>
              </>
            )}
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => go(generateSessionCode())}
            className="rounded-[28px] bg-organic-accent-200 px-3.5 py-[13px] text-left text-organic-accent-900 active:bg-organic-accent-300"
          >
            <span className="block font-display text-[16px] leading-[1.05]">Entre amis</span>
            <span className="mt-0.5 block text-[11px] font-semibold text-organic-accent-800">Coop ou équipes</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              setCode('');
              setErreur(null);
              setRejoindreOuvert(true);
            }}
            className="rounded-[28px] border border-organic-neutral-300 bg-organic-neutral-100 px-3.5 py-[13px] text-left text-organic-text active:bg-organic-neutral-200"
          >
            <span className="block font-display text-[16px] leading-[1.05]">Rejoindre</span>
            <span className="mt-0.5 block text-[11px] font-semibold text-organic-neutral-700">Avec un code</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={estInvite ? undefined : { scale: 0.97 }}
            disabled={estInvite}
            onClick={jouerSolo}
            className={`rounded-[28px] border border-organic-neutral-300 bg-organic-neutral-100 px-3.5 py-[13px] text-left text-organic-text active:bg-organic-neutral-200 ${
              estInvite ? 'opacity-40' : ''
            }`}
          >
            <span className="block font-display text-[16px] leading-[1.05]">Solo</span>
            <span className="mt-0.5 block text-[11px] font-semibold text-organic-neutral-700">
              {estInvite ? 'Nécessite un compte' : 'Progression infinie'}
            </span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => go(generateSessionCode(), { bot: true })}
            className="rounded-[28px] border border-organic-neutral-300 bg-organic-neutral-100 px-3.5 py-[13px] text-left text-organic-text active:bg-organic-neutral-200"
          >
            <span className="block font-display text-[16px] leading-[1.05]">Contre un bot</span>
            <span className="mt-0.5 block text-[11px] font-semibold text-organic-neutral-700">Pour s’entraîner</span>
          </motion.button>
        </div>

        {/* « En ligne » : savoir qui est là maintenant, pour inviter au bon
            moment. La pastille du lien Amis compte les demandes reçues —
            c'est le seul endroit où elles se signalent.
            L'en-tête s'affiche pour TOUT compte, même sans un seul ami : c'est
            le seul chemin vers l'écran Amis, le cacher tant qu'on n'a personne
            rendrait la fonctionnalité introuvable pour qui en a le plus besoin.
            Un invité en est exclu — son identité ne survit pas à la visite. */}
        {!estInvite && (
          <>
            <div className="mt-3.5 flex shrink-0 items-baseline justify-between">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
                {amis && amis.friends.length > 0 ? 'En ligne' : 'Amis'}
              </p>
              <button
                type="button"
                onClick={() => setEcran('amis')}
                className="flex items-center gap-1.5 text-[11.5px] font-bold text-organic-accent-700 active:text-organic-accent-500"
              >
                {amis && amis.friends.length > 0 ? 'Amis' : 'Ajouter'}
                {!!amis?.incoming.length && (
                  <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-organic-accent-500 px-1.5 text-[10px] font-bold text-white">
                    {amis.incoming.length}
                  </span>
                )}
              </button>
            </div>
            {amis && amis.friends.length > 0 ? (
              <div className="mt-2 flex shrink-0 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {amis.friends.slice(0, 6).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setEcran('amis')}
                    className="relative shrink-0 text-center"
                  >
                    <span className={a.online ? '' : 'opacity-40'}>
                      <Avatar name={a.name} color="#A19786" src={a.avatar} size={44} square />
                    </span>
                    <span className="mt-1 block max-w-[46px] truncate text-[9.5px] font-bold text-organic-neutral-700">
                      {a.name}
                    </span>
                    <span
                      className={`absolute -right-0.5 -top-0.5 h-[11px] w-[11px] rounded-full ring-[2.5px] ring-organic-bg ${
                        a.online ? 'bg-organic-accent2-600' : 'bg-organic-neutral-400'
                      }`}
                    />
                  </button>
                ))}
              </div>
            ) : (
              // Tant que la liste charge (`amis === null`), on affiche déjà
              // l'invitation : elle occupe la même place que la rangée
              // d'avatars, donc rien ne saute quand la réponse arrive.
              <button
                type="button"
                onClick={() => setEcran('amis')}
                className="mt-2 shrink-0 rounded-[20px] border border-dashed border-organic-neutral-400 px-3.5 py-3 text-left text-[11.5px] font-semibold leading-[1.45] text-organic-neutral-700 active:bg-organic-neutral-100"
              >
                {amis?.incoming.length
                  ? 'Quelqu’un veut vous ajouter. Répondez à la demande.'
                  : 'Ajoutez un ami par son pseudo pour l’inviter en partie.'}
              </button>
            )}
          </>
        )}

        <div className="mt-3.5 flex shrink-0 items-baseline justify-between">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Grille du jour · votre rang
          </p>
          <button
            type="button"
            onClick={() => setEcran('classement')}
            className="text-[11.5px] font-bold text-organic-accent-700 active:text-organic-accent-500"
          >
            Classement
          </button>
        </div>

        {/* Rang du jour : une position parmi les joueurs du jour, pas un score
            absolu — c'est ce qui donne une échelle au résultat. */}
        {profile?.dailyRank ? (
          <div className="mt-2 shrink-0">
            <div className="relative h-2.5 rounded-full bg-organic-neutral-200">
              <span
                className="absolute bottom-0 left-0 top-0 rounded-full bg-organic-accent2-500"
                style={{ width: `${Math.max(2, 100 - (profile.dailyRank / Math.max(1, profile.dailyTotal)) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] font-bold text-organic-neutral-700">
              {profile.dailyRank}
              <span className="text-[9px]">{profile.dailyRank === 1 ? 'er' : 'e'}</span> sur {profile.dailyTotal} joueur
              {profile.dailyTotal === 1 ? '' : 's'} aujourd’hui
            </p>
          </div>
        ) : (
          <p className="mt-2 shrink-0 text-[11px] font-bold text-organic-neutral-600">
            {estInvite ? 'Créez un compte pour être classé' : 'Faites la grille du jour pour entrer au classement'}
          </p>
        )}

        {/* Série : trois semaines en vingt-et-une cases. */}
        {profile && (
          <div className="mt-4 shrink-0 pb-3.5">
            <div className="flex items-baseline justify-between">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">Série</p>
              <p className="font-display text-[14px] text-organic-accent2-800">
                {profile.streak} jour{profile.streak === 1 ? '' : 's'}
              </p>
            </div>
            <div className="mt-[7px] flex gap-[3px]">
              {profile.dailyHistory.map((fait, i) => {
                // La dernière case est celle d'aujourd'hui : c'est la seule
                // qui a une raison de sauter, et seulement le jour où la
                // série vient d'être prolongée.
                const aujourdhui = i === profile.dailyHistory.length - 1;
                return (
                  <motion.span
                    key={i}
                    // Une série se regarde se construire : les vingt-et-une
                    // cases se remplissent de gauche à droite plutôt que
                    // d'être déjà là quand l'écran s'affiche.
                    initial={moinsDeMouvement ? false : { opacity: 0, scaleY: 0.25 }}
                    animate={
                      serieProlongee && aujourdhui && !moinsDeMouvement
                        ? { opacity: 1, scaleY: [0.25, 1.35, 1] }
                        : { opacity: 1, scaleY: 1 }
                    }
                    transition={{
                      delay: moinsDeMouvement ? 0 : Math.min(i, 20) * 0.022,
                      duration: 0.32,
                      ease: 'easeOut',
                    }}
                    className={`block h-4 flex-1 rounded-[4px] ${
                      fait ? 'bg-organic-accent2-500' : 'bg-organic-neutral-200'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {estInvite && (
          <button
            type="button"
            onClick={() => setEcran('profil')}
            className="mt-auto shrink-0 pt-3 text-left text-[11px] font-bold text-organic-neutral-600 underline underline-offset-2"
          >
            Vous jouez en invité — créer un compte pour tout débloquer
          </button>
        )}

        {/* Identifiant du build, minuscule et en pied de page : c'est le seul
            moyen de dire d'un coup d'œil QUELLE version tourne réellement —
            un déploiement qui traîne, un cache de service worker périmé (voir
            lib/pwa.ts). Rien à comprendre pour un joueur, tout pour un
            rapport de bug. */}
        <p className={`${estInvite ? 'mt-2' : 'mt-auto pt-3'} mb-2 shrink-0 text-[9px] font-medium text-organic-neutral-500`}>
          {__APP_VERSION__}
        </p>
      </div>
    );
  }

  return (
    <>
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
          <Suspense fallback={<EcranEnAttente />}>{screen}</Suspense>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>{celebrationPalier}</AnimatePresence>

      {/* Feuille « Rejoindre » : le code s'écrit dans des cases, comme une
          réponse de grille, et le pavé ne propose que l'alphabet réel des
          codes — pas de I/L/O ni de 0/1, qu'on confond à l'oral. */}
      <AnimatePresence>
        {rejoindreOuvert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRejoindreOuvert(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-organic-neutral-900/50"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
              ref={feuilleRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="titre-rejoindre"
              tabIndex={-1}
              className="w-full max-w-[440px] rounded-t-[28px] bg-organic-bg px-5 pb-4 pt-[22px] shadow-lg"
            >
              <div className="flex items-baseline justify-between">
                <p id="titre-rejoindre" className="font-display text-[22px] leading-none text-organic-text">
                  Rejoindre un salon
                </p>
                <button
                  type="button"
                  onClick={() => setRejoindreOuvert(false)}
                  className="text-[13px] font-bold text-organic-neutral-600 active:text-organic-text"
                >
                  Fermer
                </button>
              </div>
              <p className="mt-[5px] text-[12.5px] leading-[1.45] text-organic-neutral-700">
                Saisissez le code donné par l’hôte.
              </p>

              <p className="sr-only" aria-live="polite">
                {erreur ?? `Code : ${code.split('').join(' ') || 'vide'}, ${code.length} caractère${
                  code.length === 1 ? '' : 's'
                } sur ${CASES_CODE}`}
              </p>
              <div className="mt-4 flex justify-center gap-[7px]" aria-hidden="true">
                {Array.from({ length: CASES_CODE }, (_, i) => {
                  const ch = code[i] ?? '';
                  const courant = i === code.length;
                  return (
                    <motion.span
                      // La clé porte le caractère : la tuile se remonte donc à
                      // chaque changement, et rebondit à l'instant où elle se
                      // remplit. Six cases, six petites satisfactions.
                      key={`${i}-${ch}`}
                      initial={ch && !moinsDeMouvement ? { scale: 0.82 } : false}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 17 }}
                      className={`flex h-[50px] w-[44px] shrink-0 items-center justify-center rounded-lg font-display text-[24px] ${
                        erreur
                          ? 'border border-organic-accent-500 bg-organic-accent-200 text-organic-accent-900'
                          : ch
                            ? 'border border-organic-accent2-400 bg-organic-accent2-200 text-organic-accent2-900'
                            : 'border border-organic-neutral-300 bg-organic-neutral-100 text-organic-text'
                      }`}
                      style={courant && !erreur ? { boxShadow: 'inset 0 0 0 2px #d67f48' } : undefined}
                    >
                      {ch}
                    </motion.span>
                  );
                })}
              </div>
              <p
                className={`mt-2 text-center text-[11.5px] font-bold ${
                  erreur ? 'text-organic-accent-700' : 'text-organic-neutral-600'
                }`}
              >
                {erreur ?? 'Le code fait six caractères.'}
              </p>

              <div className="mt-3 flex flex-col gap-[5px]">
                {PAVE_CODE.map((rangee, i) => (
                  <div key={i} className="flex justify-center gap-1">
                    {rangee.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => taper(k)}
                        className="h-10 min-w-0 flex-1 rounded-[9px] border border-organic-neutral-300 bg-organic-neutral-100 font-grid text-[15px] font-bold text-organic-text active:bg-organic-accent-200"
                      >
                        {k}
                      </button>
                    ))}
                    {i === PAVE_CODE.length - 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setErreur(null);
                          setCode((c) => c.slice(0, -1));
                        }}
                        aria-label="Effacer"
                        className="h-10 flex-[1.7] rounded-[9px] bg-organic-surface text-[15px] font-bold text-organic-neutral-800 active:bg-organic-neutral-300"
                      >
                        ⌫
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={rejoindre}
                disabled={code.length < 4 || rejoint}
                className={`mt-3.5 w-full rounded-full py-3.5 font-display text-[15.5px] ${
                  code.length >= 4 && !rejoint
                    ? 'bg-organic-accent-500 text-white active:bg-organic-accent-600'
                    : 'cursor-default bg-organic-neutral-300 text-organic-neutral-600'
                }`}
              >
                {rejoint ? 'Connexion…' : 'Rejoindre'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
