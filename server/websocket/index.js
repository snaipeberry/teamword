import { createServer } from 'node:http';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { pool, ensureSchema } from './db.js';
import { verifyGoogleIdToken, verifyAppleIdToken } from './oauth.js';

/**
 * Serveur temps réel des parties — remplace Liveblocks.
 *
 * MODÈLE : le serveur fait autorité. Les clients n'écrivent jamais l'état
 * directement, ils envoient des INTENTIONS ; le serveur les applique et
 * rediffuse. C'est plus simple qu'un CRDT et cela supprime toute une classe
 * de désynchronisations : il n'existe qu'une seule vérité.
 *
 * Il rediffuse l'état COMPLET à chaque changement plutôt que des deltas. La
 * partie tient en quelques kilo-octets et le rythme d'un mots fléchés est
 * d'une frappe par seconde : le gain d'un protocole delta serait invisible,
 * son coût en bugs bien réel.
 *
 * Le serveur ignore tout des grilles. Le score est calculé côté client, qui
 * seul connaît les mots — exactement le même niveau de confiance qu'avec les
 * mutations Liveblocks, qui s'exécutaient elles aussi chez le client.
 */

const PORT = process.env.PORT || 8080;
const SNAPSHOT_EVERY_MS = 10_000;
// Une partie sans personne pendant ce délai est oubliée, pour ne pas garder
// indéfiniment en mémoire des salons abandonnés.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** Durée de validité d'une session. Au-delà, il faut se reconnecter. */
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Réactions live en partie — un ensemble fermé plutôt qu'un texte libre :
 * pas de modération à faire sur quatre émojis fixes, contrairement à un
 * champ de saisie ouvert.
 */
const REACTIONS = new Set(['👏', '😮', '💡', '🎉']);
const REACTION_COOLDOWN_MS = 1_200;

/**
 * "Se connecter avec…" : identifiants PUBLICS des applications OAuth
 * (Client ID Google, Services ID Apple) — pas des secrets, ils vont dans le
 * jeton `aud` que Google/Apple signent, exactement comme ils sont déjà
 * visibles dans le code du client. Aucun jeton ne sera accepté tant qu'ils
 * ne sont pas renseignés (voir .env.example) : `verifyXIdToken` échoue sur
 * un `aud` vide, ce qui ferme le flux plutôt que de l'accepter à l'aveugle.
 */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const APPLE_AUDIENCE = process.env.APPLE_SERVICES_ID || '';

/**
 * Médailles : dérivées des compteurs, jamais stockées telles quelles.
 * Recalculées à chaque mise à jour, ce qui rend l'ajout d'une médaille
 * rétroactif sans migration.
 */
const MEDALS = [
  { id: 'first_win', label: 'Première victoire', icon: '🥉', reason: '1 victoire', test: (p) => p.wins >= 1 },
  { id: 'win_10', label: 'Habitué du podium', icon: '🥈', reason: '10 victoires', test: (p) => p.wins >= 10 },
  { id: 'win_50', label: 'Champion', icon: '🥇', reason: '50 victoires', test: (p) => p.wins >= 50 },
  { id: 'words_100', label: 'Centurion', icon: '💯', reason: '100 mots trouvés', test: (p) => p.words >= 100 },
  { id: 'words_1000', label: 'Verbicruciste', icon: '📚', reason: '1 000 mots trouvés', test: (p) => p.words >= 1000 },
  { id: 'daily_7', label: 'Assidu', icon: '🔥', reason: '7 grilles du jour', test: (p) => p.dailies >= 7 },
  { id: 'no_hint', label: 'Sans filet', icon: '🎯', reason: '5 grilles sans indice', test: (p) => p.cleanGrids >= 5 },
  // Le solo avait sa propre économie (soloPoints/soloGrids) mais aucune
  // médaille dédiée ; les trois suivantes sont aussi des paliers au-dessus
  // d'une médaille existante, pour qui la dépasse largement.
  { id: 'ermite', label: 'Ermite', icon: '🌱', reason: '50 grilles solo jouées', test: (p) => p.soloGrids >= 50 },
  { id: 'increvable', label: 'Increvable', icon: '⏳', reason: '100 parties jouées', test: (p) => p.games >= 100 },
  { id: 'perfectionniste', label: 'Perfectionniste', icon: '🏹', reason: '25 grilles sans indice', test: (p) => p.cleanGrids >= 25 },
  { id: 'fidele', label: 'Fidèle', icon: '☀️', reason: '30 grilles du jour', test: (p) => p.dailies >= 30 },
  { id: 'encyclopediste', label: 'Encyclopédiste', icon: '🗂️', reason: '5 000 mots trouvés', test: (p) => p.words >= 5000 },
];

/** Titre affiché : la médaille la plus haute obtenue. */
function titleFor(profile) {
  const gagnees = MEDALS.filter((m) => m.test(profile));
  return gagnees.length ? gagnees[gagnees.length - 1].label : 'Débutant';
}

/**
 * Points d'un joueur, TOUS MODES CONFONDUS — solo et multijoueur additionnés.
 *
 * Les deux économies restent stockées séparément (`points` pour le classé,
 * `soloPoints` pour le solo) : ça évite une migration des profils existants
 * et permet de garder le détail. Mais tout ce qui CLASSE un joueur — palier,
 * classement, appariement — se fait sur ce total, de sorte qu'un joueur
 * exclusivement solo puisse atteindre le même rang qu'un gros joueur
 * multijoueur.
 */
function totalPointsOf(profile) {
  return (profile.points ?? 0) + (profile.soloPoints ?? 0);
}

/**
 * Paliers de progression, sur le total tous modes confondus
 * (`totalPointsOf`).
 *
 * Seuils volontairement élevés (~30 grilles pour Argent, ×2 à ×3 par palier
 * ensuite) : la progression est annoncée comme théoriquement infinie, elle
 * doit rester un vrai horizon et non se vider en une soirée.
 */
const SOLO_TIERS = [
  { id: 'bronze', label: 'Bronze', icon: '🥉', min: 0 },
  { id: 'argent', label: 'Argent', icon: '🥈', min: 4_200 },
  { id: 'or', label: 'Or', icon: '🥇', min: 12_600 },
  { id: 'platine', label: 'Platine', icon: '💎', min: 30_000 },
  { id: 'diamant', label: 'Diamant', icon: '💠', min: 70_000 },
  { id: 'maitre', label: 'Maître', icon: '🔮', min: 150_000 },
  { id: 'grand_maitre', label: 'Grand Maître', icon: '⚡', min: 300_000 },
  { id: 'sorcier', label: 'Sorcier', icon: '🧙', min: 600_000 },
  { id: 'archimage', label: 'Archimage', icon: '🌌', min: 1_200_000 },
];

/** Index du palier courant dans SOLO_TIERS, à partir d'un total de points. */
function soloTierIndex(points) {
  let i = 0;
  for (let n = 0; n < SOLO_TIERS.length; n++) {
    if (points >= SOLO_TIERS[n].min) i = n;
  }
  return i;
}

/** Palier courant + progression vers le suivant, sur le total tous modes. */
function soloTierFor(profile) {
  const total = totalPointsOf(profile);
  const i = soloTierIndex(total);
  const suivant = SOLO_TIERS[i + 1] ?? null;
  return {
    tier: SOLO_TIERS[i],
    next: suivant,
    pointsToNext: suivant ? suivant.min - total : null,
  };
}

function emptyRoom() {
  return {
    round: 0,
    game: 0,
    hostId: null,
    started: false,
    kicked: {},
    letters: {},
    revealed: {},
    scores: {},
    hints: {},
    ready: {},
    players: {},
    teams: {},
    // 'solo' | 'daily' | undefined (undefined = multijoueur classique,
    // comportement inchangé). Fixé au premier join, jamais réattribué.
    mode: undefined,
    // Répartition facile/moyen/difficile des indices — voir lib/difficulty.ts
    // côté client. Choisi par l'hôte dans le salon ; 'moyen' par défaut pour
    // les parties sans salon (bot), qui n'ont aucun moment de configuration.
    // Le duel classé (ranked) l'écrase lui-même à chaque grille — voir
    // `tryMatch` et l'intent `advance`.
    grade: 'moyen',
    touchedAt: Date.now(),

    /**
     * Format d'une partie privée, choisi par l'hôte dans le salon :
     * 'coop' (tout le monde ensemble, aucune équipe), 'equipes' (chacun
     * choisit son camp) ou '1v1' (deux joueurs, camps attribués d'office).
     * Pilote `teams` — voir l'intent `format`.
     */
    /**
     * Chronologie de la manche EN COURS : dans quel ordre les mots sont
     * tombés, par qui, et au bout de combien de temps. Alimentée par les
     * intents `letter` (multijoueur classique, le client indique quels mots
     * il vient de compléter) et `solveWord` (duel classé). Remise à zéro à
     * chaque nouvelle grille, comme les lettres.
     *
     * Le serveur ignore tout du contenu des grilles (voir l'en-tête) : il ne
     * stocke donc que des identifiants de mots, à charge du client de les
     * retraduire en réponses — il a déjà la grille sous la main.
     */
    timeline: [],
    roundStartedAt: Date.now(),
    format: 'coop',
    /**
     * Limite de temps de la partie, en minutes — `null` = illimité (défaut,
     * comportement historique). Le chrono ne part qu'au lancement, pas à la
     * création du salon : voir l'intent `start`.
     */
    timeLimitMin: null,

    // ---------- duel classé (1v1 aléatoire) ----------
    // Rien de tout ceci n'est utilisé hors ranked — laissé à sa valeur par
    // défaut ailleurs, sans effet sur les parties privées/bot/solo/quotidien.

    /** Horodatage de fin de match (Date.now() + 10 min), posé par `tryMatch`. */
    matchEndsAt: null,
    /** Le match est-il conclu (temps écoulé ou abandon) ? */
    matchOver: false,
    /** Vainqueur une fois `matchOver` — `null` si égalité parfaite. */
    winnerId: null,
    /** Si conclu par abandon plutôt que par le chrono : qui a abandonné. */
    forfeitedBy: null,
    /** playerId -> dernier horodatage de déconnexion — sert la règle
     *  d'abandon (quitter n'est pas pénalisé si l'adversaire est déjà parti
     *  depuis 5+ minutes). */
    disconnectedAt: {},
    /** wordId -> playerId qui l'a trouvé. Un mot résolu devient visible et
     *  verrouillé pour LES DEUX joueurs (voir intent `solveWord`). */
    solvedWords: {},
    /** playerId -> { cellId: lettre } — frappes en cours, PRIVÉES : jamais
     *  révélées à l'adversaire tant que le mot correspondant n'est pas
     *  résolu (voir `broadcastState`, qui n'envoie à chacun que les
     *  siennes). */
    playerLetters: {},
    /** playerId -> true : les DEUX doivent la demander pour relancer un
     *  duel avec le même adversaire (voir le handler `rematchRequest`). */
    rematchRequestedBy: {},
  };
}

/** rooms: code -> état ; sockets: code -> Set<ws> */
const rooms = new Map();
const sockets = new Map();

/**
 * Profils persistants, indexés par playerId.
 *
 * ATTENTION : le playerId vient du localStorage du navigateur, il n'y a pas
 * de véritable compte. Un profil ne suit donc pas d'un appareil à l'autre et
 * reste falsifiable — acceptable pour un classement convivial, à remplacer
 * par une authentification si le classement devient un enjeu.
 */
const profiles = new Map();

function emptyProfile(id) {
  return {
    id,
    name: 'Joueur',
    avatar: null,
    points: 0,
    words: 0,
    wins: 0,
    games: 0,
    dailies: 0,
    cleanGrids: 0,
    // Économie solo : séparée du classement général (`points`) — voir
    // l'intent `soloGridDone` et l'intent `letter` (qui n'incrémente PAS
    // `points` en salle solo/quotidienne).
    soloPoints: 0,
    soloGrids: 0,
    hintBalance: 3,
    /**
     * Grille du jour, date (UTC, `YYYY-MM-DD`) -> points marqués ce jour-là.
     * `dailies` ne comptait qu'un total, d'où l'impossibilité d'en tirer une
     * série ou un classement du jour — c'est ce que cette carte débloque
     * (voir `dailyStatsFor`). Élaguée à DAILY_KEEP_DAYS pour ne pas gonfler
     * l'instantané indéfiniment.
     */
    dailyScores: {},
    /**
     * Points gagnés par jour (UTC), TOUS MODES CONFONDUS — c'est ce qui rend
     * le classement « Semaine » possible : `points`/`soloPoints` ne sont que
     * des totaux cumulés, sans notion de quand. Élagué comme `dailyScores`.
     */
    pointsHistory: {},
    /**
     * Bilan face à chaque adversaire déjà rencontré en duel classé :
     * `{ [id]: { v, d, n, at } }` — victoires, défaites, nuls, dernière
     * rencontre. Alimente « Vos derniers adversaires » sur l'écran de
     * recherche.
     */
    opponents: {},
    /**
     * Les mots trouvés le plus vite, du plus rapide au plus lent (3 au plus).
     * `answer`/`clue` viennent du CLIENT — le serveur ne connaît pas les
     * grilles (voir l'en-tête du fichier) et ne peut donc pas les déduire.
     */
    bestWords: [],
    /**
     * Cumul servant le « temps moyen par mot » du profil. Deux compteurs
     * plutôt qu'une moyenne stockée : une moyenne ne peut pas être mise à
     * jour sans savoir sur combien de mots elle porte.
     */
    wordTimeMs: 0,
    wordTimeCount: 0,
    /**
     * Relations. Une amitié est SYMÉTRIQUE : accepter écrit dans les deux
     * profils, il n'y a donc jamais à croiser deux listes pour savoir si
     * deux joueurs sont amis.
     */
    friends: [],
    /** Demandes reçues, en attente de réponse (ids). */
    reqIn: [],
    /** Demandes envoyées, en attente chez l'autre (ids). */
    reqOut: [],
    /** Dernière fois que ce joueur s'est connecté à une partie — sert le
     *  « Vu il y a 2 h » de la liste d'amis. */
    lastSeenAt: 0,
    updatedAt: Date.now(),
  };
}

/** Combien de mots ce joueur garde en vitrine sur son profil. */
const BEST_WORDS_KEEP = 3;
/**
 * En dessous, on ne retient pas le mot.
 *
 * Une seule frappe peut compléter DEUX mots croisés d'un coup : le second
 * est alors « trouvé » en quelques millisecondes, ce qui n'a rien d'une
 * performance et squatterait le podium à vie. Un vrai mot rapide se trouve
 * en quelques secondes, pas en un centième.
 */
const BEST_WORD_MIN_MS = 1000;
/**
 * Au-delà, on ne compte pas le mot dans la moyenne : personne ne « cherche »
 * deux minutes d'affilée. Un tel écart veut dire que la grille est restée
 * ouverte pendant une pause — c'est du temps mort, pas du temps de
 * réflexion, et il ferait exploser la moyenne.
 */
const WORD_TIME_MAX_MS = 120_000;

/**
 * Alimente le « temps moyen par mot » du profil.
 *
 * Deux compteurs plutôt qu'une moyenne : une moyenne seule ne peut pas être
 * mise à jour. Mêmes bornes que les meilleurs mots — un mot croisé complété
 * par la même frappe n'est pas une trouvaille, et une pause n'est pas une
 * recherche.
 */
function recordWordTime(profile, ms) {
  if (!Number.isFinite(ms) || ms < BEST_WORD_MIN_MS || ms > WORD_TIME_MAX_MS) return;
  profile.wordTimeMs = (profile.wordTimeMs ?? 0) + Math.round(ms);
  profile.wordTimeCount = (profile.wordTimeCount ?? 0) + 1;
}

/**
 * Retient un mot trouvé s'il fait partie des plus rapides du joueur.
 * Dédoublonné sur la réponse : retrouver deux fois ÉTOILE ne doit pas
 * occuper deux lignes, seul le meilleur temps compte.
 */
function recordBestWord(profile, { answer, clue, ms }) {
  if (typeof answer !== 'string' || !answer.trim() || !Number.isFinite(ms)) return;
  if (ms < BEST_WORD_MIN_MS) return;
  const mot = {
    answer: answer.trim().slice(0, 24).toUpperCase(),
    clue: typeof clue === 'string' ? clue.trim().slice(0, 60) : '',
    ms: Math.round(ms),
  };
  if (!Array.isArray(profile.bestWords)) profile.bestWords = [];
  // Purge des entrées trop rapides enregistrées avant ce seuil : sans ça
  // elles resteraient en tête à vie, aucun vrai mot ne pouvant les battre.
  profile.bestWords = profile.bestWords.filter((m) => m.ms >= BEST_WORD_MIN_MS);
  const existant = profile.bestWords.find((m) => m.answer === mot.answer);
  if (existant) {
    if (mot.ms >= existant.ms) return;
    existant.ms = mot.ms;
    existant.clue = mot.clue || existant.clue;
  } else {
    profile.bestWords.push(mot);
  }
  profile.bestWords.sort((a, b) => a.ms - b.ms);
  profile.bestWords = profile.bestWords.slice(0, BEST_WORDS_KEEP);
}

/**
 * Solde une rencontre de duel classé dans les deux profils concernés.
 * `issue` vaut 'v', 'd' ou 'n' du point de vue du premier joueur.
 */
function recordOpponent(profile, adversaireId, issue) {
  if (!adversaireId) return;
  if (!profile.opponents) profile.opponents = {};
  const bilan = profile.opponents[adversaireId] ?? { v: 0, d: 0, n: 0, at: 0 };
  bilan[issue] = (bilan[issue] ?? 0) + 1;
  bilan.at = Date.now();
  profile.opponents[adversaireId] = bilan;
}

/**
 * Ajoute des mots à la chronologie de la manche, sans doublon : deux clients
 * peuvent parfaitement signaler le même mot (frappe croisée, renvoi réseau),
 * et c'est le PREMIER arrivé qui fait foi — comme pour le score.
 */
function recordTimeline(state, mots, playerId) {
  if (!Array.isArray(state.timeline)) state.timeline = [];
  // Salle créée avant l'existence de ce champ (instantané restauré), ou
  // partie qui n'est jamais passée par `start` (solo, quotidien) : sans
  // origine de temps, toutes les durées vaudraient zéro.
  if (!state.roundStartedAt) state.roundStartedAt = Date.now();
  for (const brut of mots) {
    // Le client peut envoyer un simple identifiant, ou un objet portant en
    // plus la réponse et la définition (pour « Vos meilleurs mots »).
    const mot = typeof brut === 'string' ? { id: brut } : (brut ?? {});
    if (typeof mot.id !== 'string' || !mot.id) continue;
    if (state.timeline.some((e) => e.wordId === mot.id)) continue;

    const depuisDebut = Date.now() - (state.roundStartedAt ?? Date.now());
    // Temps de résolution = depuis la trouvaille PRÉCÉDENTE de ce joueur (ou
    // le début de la grille pour son premier mot). C'est une mesure de
    // rythme, la seule que la chronologie permette : on ne sait pas quand le
    // joueur a commencé à réfléchir à CE mot en particulier.
    const precedent = [...state.timeline].reverse().find((e) => e.playerId === playerId);
    const ms = depuisDebut - (precedent ? precedent.at : 0);

    state.timeline.push({ wordId: mot.id.slice(0, 64), playerId, at: depuisDebut });
    const profile = getProfile(playerId);
    // La moyenne compte TOUS les mots trouvés, même ceux qui n'entrent pas au
    // palmarès — elle décrit le rythme habituel, pas les exploits.
    recordWordTime(profile, ms);
    if (mot.answer) recordBestWord(profile, { answer: mot.answer, clue: mot.clue, ms });
  }
}

/**
 * Enregistre des points gagnés MAINTENANT, pour les classements par période.
 * À appeler partout où `points` ou `soloPoints` augmente — c'est le seul
 * endroit qui sait de quel jour il s'agit.
 */
function recordPoints(profile, gagnes) {
  if (!gagnes) return;
  if (!profile.pointsHistory) profile.pointsHistory = {};
  const jour = dayKey();
  profile.pointsHistory[jour] = (profile.pointsHistory[jour] ?? 0) + gagnes;
  for (const k of Object.keys(profile.pointsHistory)) {
    if (k < shiftDay(-DAILY_KEEP_DAYS)) delete profile.pointsHistory[k];
  }
}

/** Points gagnés sur les `jours` derniers jours (aujourd'hui compris). */
function pointsSince(profile, jours) {
  const depuis = shiftDay(-(jours - 1));
  let total = 0;
  for (const [k, v] of Object.entries(profile.pointsHistory ?? {})) {
    if (k >= depuis) total += v;
  }
  return total;
}

/** Même découpage de journée que le client (`dailySeed`, en UTC) : sans ça,
 *  la grille « du jour » et la série ne changeraient pas au même instant. */
function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Au-delà, une journée ne sert plus ni à la série ni à l'historique affiché. */
const DAILY_KEEP_DAYS = 60;
/** Nombre de cases de la frise « Série » côté accueil (voir Home.tsx). */
const DAILY_HISTORY_DAYS = 21;

function shiftDay(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return dayKey(d);
}

/**
 * Série, historique et rang du jour d'un profil.
 *
 * La série tolère que la grille du jour ne soit pas ENCORE faite aujourd'hui
 * (on repart alors d'hier) : sinon elle afficherait 0 tous les matins, ce qui
 * en ferait un compteur de culpabilité plutôt qu'une récompense.
 */
function dailyStatsFor(profile) {
  const scores = profile.dailyScores ?? {};

  let streak = 0;
  for (let i = scores[dayKey()] != null ? 0 : 1; ; i++) {
    if (scores[shiftDay(-i)] == null) break;
    streak += 1;
  }

  const history = [];
  for (let i = DAILY_HISTORY_DAYS - 1; i >= 0; i--) history.push(scores[shiftDay(-i)] != null);

  // Rang du jour : calculé à la volée sur les profils ayant joué aujourd'hui.
  // Quelques centaines de profils au plus, et seulement à l'ouverture d'un
  // écran — pas de quoi justifier un index maintenu en permanence.
  const today = dayKey();
  const mine = scores[today];
  let dailyRank = null;
  let dailyTotal = 0;
  for (const p of profiles.values()) {
    const s = (p.dailyScores ?? {})[today];
    if (s == null) continue;
    dailyTotal += 1;
    if (mine != null && s > mine) dailyRank = (dailyRank ?? 0) + 1;
  }
  if (mine != null) dailyRank = (dailyRank ?? 0) + 1; // 0 devant = 1er

  return { streak, dailyHistory: history, dailyRank, dailyTotal, dailyDone: mine != null };
}

function getProfile(id) {
  if (!profiles.has(id)) profiles.set(id, emptyProfile(id));
  return profiles.get(id);
}

function publicProfile(id) {
  const p = getProfile(id);
  return {
    ...p,
    medals: MEDALS.filter((m) => m.test(p)).map(({ id, label, icon }) => ({ id, label, icon })),
    // Catalogue COMPLET (obtenues et non obtenues), pour que l'écran profil
    // puisse montrer les verrouillées en aperçu grisé plutôt que les omettre
    // — `medals` ci-dessus reste la liste filtrée (obtenues seulement), pour
    // ne rien casser chez qui l'utilisait déjà pour le compte "x/7".
    allMedals: MEDALS.map(({ id, label, icon, reason, test }) => ({ id, label, icon, reason, earned: test(p) })),
    title: titleFor(p),
    /** Solo + multijoueur : c'est CE total qui classe (voir `totalPointsOf`).
     *  `points` et `soloPoints` restent exposés pour le détail. */
    totalPoints: totalPointsOf(p),
    /** Points gagnés sur les 7 derniers jours — onglet « Semaine ». */
    weekPoints: pointsSince(p, 7),
    /** Points par jour sur 30 jours, du plus ancien au plus récent — la
     *  frise d'activité du profil (maquette V2). */
    activity: Array.from({ length: 30 }, (_, i) => (p.pointsHistory ?? {})[shiftDay(-(29 - i))] ?? 0),
    /** Derniers adversaires rencontrés en duel classé, du plus récent au
     *  plus ancien — les noms sont résolus ici, jamais dupliqués dans le
     *  bilan lui-même (un joueur peut se renommer). */
    recentOpponents: Object.entries(p.opponents ?? {})
      .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, 5)
      .map(([id, bilan]) => ({
        id,
        name: profiles.get(id)?.name ?? 'Joueur',
        avatar: profiles.get(id)?.avatar ?? null,
        wins: bilan.v ?? 0,
        losses: bilan.d ?? 0,
        draws: bilan.n ?? 0,
      })),
    bestWords: p.bestWords ?? [],
    /** Temps moyen pour trouver un mot, en ms — `null` tant qu'aucun mot
     *  n'a été mesuré (voir `recordWordTime`). */
    avgWordMs: p.wordTimeCount > 0 ? Math.round(p.wordTimeMs / p.wordTimeCount) : null,
    ...soloTierFor(p),
    // Série, frise des 21 derniers jours et rang du jour — voir l'accueil
    // (maquette V2), qui en fait ses deux dernières sections.
    ...dailyStatsFor(p),
    // Jamais renvoyées telles quelles : les cartes complètes date par date
    // n'ont d'intérêt que pour les calculs ci-dessus, et grossissent sans fin.
    dailyScores: undefined,
    pointsHistory: undefined,
    // Le bilan brut n'a d'intérêt que pour `recentOpponents` ci-dessus, qui
    // en donne déjà la version lisible.
    opponents: undefined,
  };
}

// ---------- comptes ----------
//
// Mots de passe hachés avec scrypt (présent dans Node, aucune dépendance) :
// une fonction de dérivation à coût réglable, contrairement à un SHA brut qui
// se force en masse. Sel aléatoire par compte, comparaison à temps constant.

/** clé = pseudo en minuscules ; permet un pseudo insensible à la casse. */
const accounts = new Map();
/** clé = "provider:providerId" ; retrouver un compte Google/Apple à la
 *  reconnexion sans reparcourir tous les comptes. Reconstruit au chargement
 *  (voir loadAccounts), tenu à jour à chaque création. */
const accountsByProvider = new Map();
/** token -> { id, expiresAt } */
const tokens = new Map();
/** Limitation des tentatives, par adresse : ip -> { count, resetAt } */
const attempts = new Map();
/**
 * Blocages en duel aléatoire : playerId -> Set<playerId bloqué>. Un invité
 * (id éphémère, régénéré à chaque rechargement — voir auth.ts côté client)
 * bloque quand même pour la session en cours, juste sans effet au
 * rechargement suivant — cohérent avec le reste du modèle invité.
 */
const blocks = new Map();

function blockedIds(id) {
  return blocks.get(id) ?? new Set();
}

function isBlockedPair(a, b) {
  return blockedIds(a).has(b) || blockedIds(b).has(a);
}

// ---------- amis ----------

/**
 * Joueurs actuellement connectés à une partie.
 *
 * Reconstruit à chaque connexion/déconnexion plutôt que déduit des salles :
 * un même joueur peut avoir plusieurs onglets ouverts, et on veut savoir
 * s'il en reste AU MOINS un. Volontairement en mémoire seule — une présence
 * ne survit pas à un redémarrage, par définition.
 */
const onlineCounts = new Map();

function markOnline(playerId) {
  onlineCounts.set(playerId, (onlineCounts.get(playerId) ?? 0) + 1);
  const p = getProfile(playerId);
  p.lastSeenAt = Date.now();
}

function markOffline(playerId) {
  const n = (onlineCounts.get(playerId) ?? 0) - 1;
  if (n > 0) onlineCounts.set(playerId, n);
  else onlineCounts.delete(playerId);
  const p = profiles.get(playerId);
  if (p) p.lastSeenAt = Date.now();
}

function isOnline(playerId) {
  return (onlineCounts.get(playerId) ?? 0) > 0;
}

/** Retrouve un joueur par son PSEUDO DE COMPTE — c'est ce que l'autre tape
 *  pour l'ajouter, et c'est unique, contrairement au nom de profil. */
function findAccountByUsername(username) {
  const cherche = String(username ?? '').trim().toLowerCase();
  if (!cherche) return null;
  for (const compte of accounts.values()) {
    if (compte.username.toLowerCase() === cherche) return compte;
  }
  return null;
}

/** Retire une valeur d'un tableau de profil, sans trou ni doublon. */
function retirer(liste, valeur) {
  return (liste ?? []).filter((x) => x !== valeur);
}

/**
 * Défait une amitié ET toute demande en cours, DANS LES DEUX SENS.
 *
 * Appelé aussi bien par « retirer un ami » que par un blocage : bloquer
 * quelqu'un tout en restant son ami n'aurait aucun sens, et laisserait la
 * personne bloquée apparaître au classement « Amis ».
 */
function defaireRelation(idA, idB) {
  for (const [a, b] of [[idA, idB], [idB, idA]]) {
    const p = profiles.get(a);
    if (!p) continue;
    p.friends = retirer(p.friends, b);
    p.reqIn = retirer(p.reqIn, b);
    p.reqOut = retirer(p.reqOut, b);
    p.updatedAt = Date.now();
  }
}

/** Vue lisible d'une relation, pour l'écran Amis. */
function vueAmi(id) {
  const p = profiles.get(id);
  return {
    id,
    name: accounts.get(id)?.username ?? p?.name ?? 'Joueur',
    avatar: p?.avatar ?? null,
    online: isOnline(id),
    lastSeenAt: p?.lastSeenAt ?? 0,
    tier: p ? soloTierFor(p).tier.label : null,
    points: p ? totalPointsOf(p) : 0,
  };
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

async function createAccount(username, password) {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  const account = {
    id: `acc_${randomBytes(12).toString('hex')}`,
    username,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    provider: null,
    providerId: null,
    email: null,
    createdAt: Date.now(),
  };
  accounts.set(username.toLowerCase(), account);
  markDirty();
  return account;
}

async function verifyPassword(account, password) {
  const attendu = Buffer.from(account.hash, 'hex');
  const fourni = await hashPassword(password, Buffer.from(account.salt, 'hex'));
  // timingSafeEqual exige des longueurs égales, sinon il lève.
  return attendu.length === fourni.length && timingSafeEqual(attendu, fourni);
}

/**
 * Dérive un pseudo valide (règles de USERNAME_RE) et disponible à partir
 * d'un indice — nom ou email renvoyé par Google/Apple, parfois absent
 * (Apple ne le fournit qu'au tout premier consentement). Ni Google ni Apple
 * ne garantissent un format compatible (espaces, accents, longueur libre) :
 * on ne peut donc jamais utiliser l'indice tel quel.
 */
function pickUsername(hint) {
  const base = String(hint ?? '')
    .split('@')[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents décomposés (NFD) -> lettre nue
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 16);
  const racine = base.length >= 3 ? base : `Joueur${base}`;

  let candidat = racine.slice(0, 20);
  let n = 1;
  while (accounts.has(candidat.toLowerCase())) {
    n += 1;
    candidat = `${racine}${n}`.slice(0, 20);
  }
  return candidat;
}

/**
 * Compte lié à Google ou Apple ("Se connecter avec…") — pas de mot de passe
 * ici, `sub` (l'identifiant stable du fournisseur) en tient lieu de secret :
 * seul Google/Apple peut le prouver, via la signature du jeton (voir
 * oauth.js), donc pas besoin de scrypt ici.
 */
/**
 * Reprise de la progression jouée sans compte — commune à la création par
 * mot de passe (/register) et par Google/Apple (/oauth/callback), les deux
 * créant un compte de la même façon derrière des identités différentes.
 *
 * `claimed` garantit qu'un profil anonyme ne peut être revendiqué qu'UNE
 * fois : sans cela, quelqu'un qui devinerait l'identifiant d'un autre
 * joueur pourrait s'approprier ses points.
 */
function migrateAnonymousProgress(profile, accountId, migrateFrom) {
  const depuis = String(migrateFrom ?? '');
  if (!depuis || !profiles.has(depuis)) return;

  const ancien = profiles.get(depuis);
  if (ancien.claimed || ancien.id.startsWith('acc_')) return;

  profile.points += ancien.points;
  profile.words += ancien.words;
  profile.wins += ancien.wins;
  profile.games += ancien.games;
  profile.dailies += ancien.dailies;
  profile.cleanGrids += ancien.cleanGrids;
  profile.soloPoints += ancien.soloPoints;
  profile.soloGrids += ancien.soloGrids;
  // La monnaie d'indices s'ajoute (pas de remplacement) : le solde de
  // départ du nouveau profil ne doit pas être perdu.
  profile.hintBalance += ancien.hintBalance;
  if (!profile.avatar) profile.avatar = ancien.avatar;
  ancien.claimed = true;

  // La salle solo elle-même doit suivre : sans ce transfert, la progression
  // de points migre mais le numéro de grille repart de zéro (la salle solo
  // du nouveau compte est encore vierge).
  const salleAnonyme = `solo-${depuis}`;
  if (rooms.has(salleAnonyme) && !rooms.has(`solo-${accountId}`)) {
    const salle = rooms.get(salleAnonyme);
    rooms.delete(salleAnonyme);
    sockets.delete(salleAnonyme);
    rooms.set(`solo-${accountId}`, salle);
  }
}

function createOAuthAccount(provider, providerId, email, username) {
  const account = {
    id: `acc_${randomBytes(12).toString('hex')}`,
    username,
    salt: null,
    hash: null,
    provider,
    providerId,
    email,
    createdAt: Date.now(),
  };
  accounts.set(username.toLowerCase(), account);
  accountsByProvider.set(`${provider}:${providerId}`, account);
  markDirty();
  return account;
}

function issueToken(id) {
  const token = randomBytes(32).toString('hex');
  tokens.set(token, { id, expiresAt: Date.now() + TOKEN_TTL_MS });
  markDirty();
  return token;
}

function resolveToken(token) {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    tokens.delete(token);
    return null;
  }
  return entry.id;
}

/**
 * Vérifie qu'un id revendiqué comme COMPTE (`acc_…`) correspond bien au
 * jeton de session fourni, avant de le laisser agir sous ce nom.
 *
 * Jusqu'ici `player.id` (join/queue) et `id` (profile-update, block,
 * unblock) étaient acceptés tels quels : n'importe qui connaissant l'id
 * d'un compte — visible partout, classement compris — pouvait s'en servir
 * pour accumuler des points en son nom, changer son avatar, ou manipuler
 * ses blocages. Un id invité (`guest-…`) n'a par nature aucun secret à
 * vérifier (pas de mot de passe) : il reste falsifiable entre invités (rien
 * de précieux n'y est attaché — exclu du classement, voir /leaderboard),
 * mais ne peut plus se faire passer pour un compte réel.
 *
 * Renvoie l'id si la revendication est légitime (ou n'avait rien à
 * prouver), `null` si elle doit être rejetée.
 */
function verifiedId(claimedId, token) {
  const id = String(claimedId ?? '').slice(0, 64);
  if (!id) return null;
  if (!id.startsWith('acc_')) return id;
  return resolveToken(token ?? '') === id ? id : null;
}

/** Renvoie true si l'appelant a droit à une tentative supplémentaire. */
function allowAttempt(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 10;
}

/** File d'attente du 1v1 aléatoire. Volontairement non persistée. */
const queue = [];

// ---------- persistance (Postgres — voir db.js) ----------
// Sans elle, un simple redémarrage effacerait toutes les parties en cours —
// or reprendre une partie plus tard fait partie des attentes du jeu.
//
// Toujours pas de fichiers : les Map en mémoire (rooms/profiles/accounts/
// tokens/blocks) restent la source de vérité PENDANT que le process tourne
// — chaque intent continue de les muter directement, aucun appelant
// n'attend une écriture DB pour progresser. Seule la PERSISTANCE change de
// support : chargée depuis Postgres au démarrage, réécrite dedans par
// snapshot périodique (`saveSnapshot`, identique dans son principe à
// l'ancien `writeJsonAtomic`, juste vers une table plutôt qu'un fichier).

async function loadSnapshot() {
  try {
    const { rows } = await pool.query('SELECT code, data FROM rooms');
    const now = Date.now();
    for (const { code, data } of rows) {
      // Une salle solo n'expire jamais : la progression (numéro de grille en
      // cours) doit survivre indéfiniment, pas seulement les points/ampoules
      // déjà pérennes sur le profil.
      if (data.mode === 'solo' || now - (data.touchedAt ?? 0) < ROOM_TTL_MS) {
        rooms.set(code, data);
      }
    }
    console.log(`[boot] ${rooms.size} partie(s) restaurée(s)`);
  } catch (err) {
    console.log('[boot] aucune partie restaurée —', err.message);
  }
}

async function loadProfiles() {
  try {
    const { rows } = await pool.query('SELECT id, data FROM profiles');
    for (const { id, data } of rows) profiles.set(id, { ...emptyProfile(id), ...data });
    console.log(`[boot] ${profiles.size} profil(s) restauré(s)`);
  } catch (err) {
    console.log('[boot] aucun profil restauré —', err.message);
  }
}

async function loadAccounts() {
  try {
    const { rows: comptes } = await pool.query(
      'SELECT id, username, salt, hash, provider, provider_id, email, created_at FROM accounts',
    );
    for (const a of comptes) {
      const account = {
        id: a.id, username: a.username, salt: a.salt, hash: a.hash,
        provider: a.provider, providerId: a.provider_id, email: a.email,
        createdAt: Number(a.created_at),
      };
      accounts.set(a.username.toLowerCase(), account);
      if (a.provider && a.provider_id) accountsByProvider.set(`${a.provider}:${a.provider_id}`, account);
    }

    const now = Date.now();
    const { rows: sessions } = await pool.query(
      'SELECT token, account_id, expires_at FROM sessions WHERE expires_at > $1',
      [now],
    );
    for (const s of sessions) tokens.set(s.token, { id: s.account_id, expiresAt: Number(s.expires_at) });

    const { rows: blocages } = await pool.query('SELECT blocker_id, blocked_id FROM blocks');
    for (const b of blocages) {
      if (!blocks.has(b.blocker_id)) blocks.set(b.blocker_id, new Set());
      blocks.get(b.blocker_id).add(b.blocked_id);
    }

    console.log(`[boot] ${accounts.size} compte(s), ${tokens.size} session(s)`);
  } catch (err) {
    console.log('[boot] aucun compte restauré —', err.message);
  }
}

/**
 * Remplace intégralement le contenu d'une table par les lignes fournies,
 * DANS la transaction du client donné — un `DELETE` + `INSERT` en masse
 * plutôt qu'un UPSERT ligne à ligne : ce qui est en mémoire EST la vérité
 * complète du moment (une suppression en mémoire — compte supprimé, salle
 * expirée — doit disparaître de la table aussi), exactement le même
 * principe que l'ancien fichier réécrit en entier à chaque instantané.
 * `table` est toujours un littéral appelé ci-dessous, jamais une entrée
 * utilisateur : l'interpoler dans la requête est sûr ici.
 */
async function bulkReplace(client, table, columns, rows) {
  await client.query(`DELETE FROM ${table}`);
  if (!rows.length) return;
  const placeholders = rows
    .map((row, i) => `(${row.map((_, j) => `$${i * columns.length + j + 1}`).join(',')})`)
    .join(',');
  await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`, rows.flat());
}

// Un instantané complet sur 5 tables à chaque cycle, même quand rien n'a
// bougé (aucune partie active), gaspille des écritures Postgres pour rien —
// à la différence d'un fichier local, celles-ci ont un coût réseau et
// comptent contre les quotas de l'hébergeur. `markDirty()` est appelé à
// chaque mutation connue (intent de salle, connexion, compte, blocage) ;
// `saveSnapshot` n'écrit que si quelque chose a changé depuis la dernière
// fois — `force` (utilisé à l'extinction) contourne ce filtre.
let dirty = false;
function markDirty() {
  dirty = true;
}

async function saveSnapshot(force = false) {
  if (!dirty && !force) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bulkReplace(client, 'rooms', ['code', 'data'],
      [...rooms].map(([code, state]) => [code, JSON.stringify(state)]));
    await bulkReplace(client, 'profiles', ['id', 'data'],
      [...profiles].map(([id, p]) => [id, JSON.stringify(p)]));
    await bulkReplace(client, 'accounts', ['id', 'username', 'salt', 'hash', 'provider', 'provider_id', 'email', 'created_at'],
      [...accounts.values()].map((a) => [
        a.id, a.username, a.salt ?? null, a.hash ?? null,
        a.provider ?? null, a.providerId ?? null, a.email ?? null, a.createdAt,
      ]));
    await bulkReplace(client, 'sessions', ['token', 'account_id', 'expires_at'],
      [...tokens].map(([token, entry]) => [token, entry.id, entry.expiresAt]));
    await bulkReplace(client, 'blocks', ['blocker_id', 'blocked_id'],
      [...blocks].flatMap(([blocker, set]) => [...set].map((blocked) => [blocker, blocked])));
    await client.query('COMMIT');
    // Effacé seulement après succès CONFIRMÉ : un échec laisse `dirty` à
    // true pour que le cycle suivant réessaie, plutôt que de perdre le
    // changement silencieusement.
    dirty = false;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[snapshot] échec', err.message);
  } finally {
    client.release();
  }
}

function pruneRooms() {
  const now = Date.now();
  let retire = false;

  for (const [code, state] of rooms) {
    if (state.mode === 'solo') continue; // jamais oubliée, voir loadSnapshot
    const vivants = sockets.get(code);
    if ((!vivants || vivants.size === 0) && now - state.touchedAt > ROOM_TTL_MS) {
      rooms.delete(code);
      sockets.delete(code);
      retire = true;
    }
  }

  // Un jeton expiré n'était jusqu'ici retiré qu'à sa PROCHAINE consultation
  // (voir resolveToken) — une session ouverte puis jamais réutilisée restait
  // en mémoire (et en base) indéfiniment. Le même passage périodique que les
  // salles s'en charge maintenant.
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) {
      tokens.delete(token);
      retire = true;
    }
  }

  if (retire) markDirty();
}

// ---------- diffusion ----------
function peers(code) {
  return sockets.get(code) ?? new Set();
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcastState(code) {
  const state = rooms.get(code);
  if (!state) return;

  // Duel classé : `playerLetters` porte les frappes PRIVÉES des deux joueurs
  // (voir emptyRoom) — un envoi identique à tout le monde les rendrait
  // visibles à l'adversaire, exactement ce que le mode est censé empêcher.
  // Chaque destinataire ne reçoit donc que les siennes ; le reste de l'état
  // (scores, mots résolus, chrono…) reste partagé tel quel.
  if (state.ranked && state.playerLetters) {
    for (const ws of peers(code)) {
      if (ws.readyState !== ws.OPEN || !ws.player) continue;
      const sanitized = {
        ...state,
        playerLetters: { [ws.player.id]: state.playerLetters[ws.player.id] ?? {} },
      };
      ws.send(JSON.stringify({ t: 'state', state: sanitized }));
    }
    return;
  }

  const message = JSON.stringify({ t: 'state', state });
  for (const ws of peers(code)) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

function broadcastPresence(code) {
  const list = [...peers(code)]
    .filter((ws) => ws.player)
    .map((ws) => ({ ...ws.player, connectionId: ws.connectionId }));
  const message = JSON.stringify({ t: 'presence', players: list });
  for (const ws of peers(code)) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

// ---------- intentions ----------
// Chaque entrée reçoit (state, payload, playerId) et renvoie true si l'état a
// changé — c'est ce qui décide de rediffuser ou non.
const INTENTS = {
  letter(state, { cellId, letter, scored = 0, wordIds, words }, playerId) {
    if (typeof cellId !== 'string') return false;
    if (letter) state.letters[cellId] = String(letter).slice(0, 1);
    else delete state.letters[cellId];
    // Quels mots viennent d'être complétés — le serveur ne peut pas le
    // déduire seul (il ne connaît pas les réponses), c'est donc le client
    // qui les nomme, au même niveau de confiance que `scored`. `words` porte
    // en plus la réponse et la définition ; `wordIds` reste accepté pour un
    // client resté sur l'ancienne version (cache de service worker).
    const trouves = Array.isArray(words) ? words : Array.isArray(wordIds) ? wordIds : null;
    if (trouves?.length) recordTimeline(state, trouves.slice(0, 4), playerId);
    if (scored > 0) {
      state.scores[playerId] = (state.scores[playerId] ?? 0) + scored;
      // Les points de profil suivent les mots trouvés, pas les grilles : c'est
      // immédiat et cela récompense aussi les parties abandonnées en cours.
      const profile = getProfile(playerId);
      // Le classement général ne doit refléter QUE le duel aléatoire classé
      // (state.ranked, posé uniquement par tryMatch) : le solo/quotidien a
      // son propre système de points (soloGridDone), et le bot comme les
      // parties privées n'ont aucune valeur compétitive — les y compter
      // permettrait de gonfler son classement en s'entraînant contre un bot
      // ou entre amis complices.
      if (state.ranked === true) {
        profile.points += scored;
        recordPoints(profile, scored);
      }
      profile.words += scored;
      profile.updatedAt = Date.now();
    }
    return true;
  },

  reveal(state, { cellId, letter }, playerId) {
    if (typeof cellId !== 'string') return false;

    // Duel classé : indice PRIVÉ, comme la frappe (voir `letterPrivate`) —
    // jamais dans la carte partagée `letters`/`revealed`, qui révélerait la
    // case à l'adversaire. Pas de monnaie ici non plus, un plafond fixe (3)
    // comme en multijoueur classique.
    if (state.ranked) {
      if ((state.hints[playerId] ?? 0) >= 3) return false;
      if (!state.playerLetters[playerId]) state.playerLetters[playerId] = {};
      const clean = String(letter).slice(0, 1);
      // Redemande sur une case déjà révélée par CE joueur : ne pas refacturer.
      if (state.playerLetters[playerId][cellId] === clean) return false;
      state.playerLetters[playerId][cellId] = clean;
      state.hints[playerId] = (state.hints[playerId] ?? 0) + 1;
      return true;
    }

    // Le serveur ignore tout des grilles (voir l'en-tête du fichier) : il ne
    // peut pas savoir si une case était déjà correcte AVANT cette demande —
    // seul le client, qui connaît la réponse, peut décider de ne pas
    // demander d'indice sur une case déjà juste (voir CrosswordGrid.tsx,
    // `hintTarget`). Il peut en revanche détecter une redemande sur une case
    // qu'IL a déjà révélée lui-même, et ne pas facturer deux fois pour ça
    // (retente réseau, ou double-clic).
    if (state.revealed[cellId] === true) return false;

    if (state.mode === 'solo' || state.mode === 'daily') {
      // Monnaie persistante (« ampoules ») : gagnée en jouant, dépensée ici.
      const profile = getProfile(playerId);
      if (profile.hintBalance <= 0) return false;
      profile.hintBalance -= 1;
      profile.updatedAt = Date.now();
    } else {
      // Multijoueur classique : pas de monnaie, un plafond fixe par salle
      // (state.hints n'est jamais remis à zéro entre les manches d'une même
      // salle — donc 3 indices pour toute la partie, pas 3 par grille).
      if ((state.hints[playerId] ?? 0) >= 3) return false;
    }

    state.letters[cellId] = String(letter).slice(0, 1);
    state.revealed[cellId] = true;
    // Volontairement SANS point : une lettre donnée par l'aide ne doit pas
    // faire gagner le mot.
    state.hints[playerId] = (state.hints[playerId] ?? 0) + 1;
    return true;
  },

  ready(state, { round }, playerId) {
    state.ready[playerId] = round;
    return true;
  },

  advance(state, { fromRound }) {
    // Fin de grille : on solde les compteurs de profil avant de repartir.
    const teams = state.teams ?? {};
    // Un joueur n'entre dans `scores` qu'en marquant. S'en tenir à cette clé
    // priverait de sa victoire l'équipier qui n'a rien trouvé — alors que
    // c'est le camp qui gagne. On réunit donc les deux sources.
    const joueurs = [...new Set([...Object.keys(state.scores), ...Object.keys(teams)])];
    // Duel classé : la victoire se joue sur les 10 minutes du MATCH, pas
    // grille par grille — voir `concludeRankedMatch`, appelé une seule fois
    // à la fin (chrono ou abandon). Compter une victoire ici aussi aurait
    // gonflé le total à chaque grille d'un même match.
    if (joueurs.length > 0 && !state.ranked) {
      const camps = [...new Set(Object.values(teams))];

      /**
       * En partie par ÉQUIPES, la victoire revient au camp, pas au meilleur
       * marqueur : un joueur peut très bien gagner en ayant moins de points
       * qu'un adversaire, si ses coéquipiers ont porté l'équipe.
       */
      let gagnants;
      if (camps.length > 1) {
        const totaux = camps.map((c) => ({
          camp: c,
          total: joueurs
            .filter((id) => teams[id] === c)
            .reduce((n, id) => n + (state.scores[id] ?? 0), 0),
        }));
        const meilleur = Math.max(...totaux.map((t) => t.total));
        // Égalité : on ne départage pas, tous les camps à égalité gagnent.
        const campsGagnants = totaux.filter((t) => t.total === meilleur).map((t) => t.camp);
        gagnants = new Set(joueurs.filter((id) => campsGagnants.includes(teams[id])));
      } else {
        const meilleur = Math.max(...joueurs.map((id) => state.scores[id] ?? 0));
        gagnants = new Set(
          joueurs.length > 1 ? joueurs.filter((id) => (state.scores[id] ?? 0) === meilleur) : [],
        );
      }

      for (const id of joueurs) {
        const profile = getProfile(id);
        profile.games += 1;
        if (gagnants.has(id)) profile.wins += 1;
        if (!state.hints[id]) profile.cleanGrids += 1;
        profile.updatedAt = Date.now();
      }
    }

    // Idempotent : tous les clients détectent « tout le monde est prêt » au
    // même instant et émettent en même temps. Sans cette garde on sauterait
    // plusieurs grilles d'un coup.
    if (fromRound !== undefined && state.round !== fromRound) return false;
    state.round += 1;
    state.letters = {};
    state.revealed = {};
    // Nouvelle grille : la chronologie repart de zéro, et son horloge aussi.
    state.timeline = [];
    state.roundStartedAt = Date.now();
    if (state.ranked) {
      // Une difficulté différente à chaque grille plutôt qu'une seule fixée
      // pour tout le match — jamais 'difficile' : un duel se joue vite, la
      // grille du dessus le réserve déjà. Progression et frappes privées
      // remises à zéro : nouvelle grille, personne n'a encore rien trouvé.
      state.grade = Math.random() < 0.5 ? 'facile' : 'moyen';
      state.solvedWords = {};
      state.playerLetters = {};
    }
    return true;
  },

  reset(state) {
    // Nouvelle partie : la graine change (via `game`), donc grille NEUVE et
    // non celle déjà jouée.
    state.game += 1;
    state.round = 0;
    state.letters = {};
    state.revealed = {};
    state.scores = {};
    state.hints = {};
    state.ready = {};
    state.timeline = [];
    state.roundStartedAt = Date.now();
    return true;
  },

  start(state) {
    state.started = true;
    // Le chrono d'une partie limitée démarre à l'ouverture de la grille, pas
    // à la création du salon : sinon le temps passé à régler le format et à
    // attendre les joueurs serait décompté de la partie.
    if (state.timeLimitMin) state.matchEndsAt = Date.now() + state.timeLimitMin * 60 * 1000;
    // La chronologie compte à partir de l'ouverture de la grille, pas de la
    // création du salon — sinon le premier mot afficherait le temps passé à
    // attendre les autres joueurs.
    state.roundStartedAt = Date.now();
    state.timeline = [];
    return true;
  },

  /**
   * Format d'une partie privée. C'est lui qui décide de la signification de
   * `teams`, donc il les réécrit au passage plutôt que de laisser un état
   * incohérent (des camps résiduels en coop, par exemple).
   */
  format(state, { format }, playerId) {
    if (state.hostId !== playerId) return false;
    if (!['coop', 'equipes', '1v1'].includes(format)) return false;
    state.format = format;
    if (format === 'coop') {
      state.teams = {};
    } else if (format === '1v1') {
      // Camps attribués d'office : en 1v1 il n'y a rien à choisir, et laisser
      // deux joueurs atterrir dans le même camp n'aurait aucun sens.
      const ids = Object.keys(state.players);
      state.teams = {};
      ids.slice(0, 2).forEach((id, i) => { state.teams[id] = i === 0 ? 'A' : 'B'; });
    }
    return true;
  },

  /** Limite de temps du salon — `null`/0 pour illimité. */
  timeLimit(state, { minutes }, playerId) {
    if (state.hostId !== playerId) return false;
    const n = Number(minutes);
    if (minutes !== null && ![5, 10, 15, 30].includes(n)) return false;
    state.timeLimitMin = minutes === null ? null : n;
    return true;
  },

  /**
   * Signale une grille solo ou quotidienne terminée : `points` (pondérés par
   * la complexité des mots) est calculé côté client, qui seul connaît les
   * mots — même niveau de confiance que `scored` sur l'intent `letter`.
   */
  soloGridDone(state, { points, daily = false }, playerId) {
    const profile = getProfile(playerId);
    const gagne = Math.max(0, Math.floor(Number(points) || 0));

    // Le palier se calcule sur le TOTAL tous modes (voir `totalPointsOf`) :
    // franchir un palier grâce à des points multijoueur doit récompenser
    // pareil que le franchir en solo.
    const avant = soloTierIndex(totalPointsOf(profile));
    profile.soloPoints += gagne;
    recordPoints(profile, gagne);
    profile.soloGrids += 1;
    const apres = soloTierIndex(totalPointsOf(profile));

    // +1 ampoule à chaque grille, +5 de plus si on vient de franchir un
    // palier — la progression solo doit se sentir, pas juste s'afficher.
    profile.hintBalance += 1 + (apres > avant ? 5 : 0);

    if (daily) {
      profile.dailies += 1;
      // Le meilleur score du jour fait foi : rejouer la même grille ne doit
      // pas pouvoir faire BAISSER son rang du jour.
      if (!profile.dailyScores) profile.dailyScores = {};
      const jour = dayKey();
      profile.dailyScores[jour] = Math.max(profile.dailyScores[jour] ?? 0, gagne);
      for (const k of Object.keys(profile.dailyScores)) {
        if (k < shiftDay(-DAILY_KEEP_DAYS)) delete profile.dailyScores[k];
      }
    }
    profile.updatedAt = Date.now();
    return false; // rien de partagé au niveau salle ne change
  },

  kick(state, { playerId: cible }, playerId) {
    // Contrôle côté SERVEUR : masquer le bouton chez le client ne protège de
    // rien, le message restant forgeable.
    if (state.hostId !== playerId) return false;
    if (cible === playerId) return false;
    state.kicked[cible] = true;
    return true;
  },

  /** Photo et pseudo. La photo est une vignette base64 envoyée par le client. */
  profile(state, { name, avatar }, playerId) {
    const profile = getProfile(playerId);
    if (typeof name === 'string' && name.trim()) {
      const clean = name.trim().slice(0, 16);
      profile.name = clean;
      const existant = state.players[playerId] ?? {};
      state.players[playerId] = { ...existant, name: clean };
    }
    if (typeof avatar === 'string') {
      // Plafond volontaire : la vignette est réduite côté client à 96 px, ce
      // qui tient largement sous cette limite. Au-delà, on refuse plutôt que
      // de laisser gonfler l'instantané.
      profile.avatar = avatar.length <= 40_000 ? avatar : null;
    } else if (avatar === null) {
      profile.avatar = null;
    }
    profile.updatedAt = Date.now();
    return true;
  },

  /** Équipe choisie dans le salon (matchmaking privé 2v2 / 3v3). */
  team(state, { team }, playerId) {
    if (!state.teams) state.teams = {};
    if (team === null) delete state.teams[playerId];
    else state.teams[playerId] = String(team).slice(0, 1).toUpperCase();
    return true;
  },

  /**
   * Grade choisi dans le salon — répartition des indices de la partie.
   * Contrôle côté serveur comme `kick` : seul l'hôte peut le changer, un
   * client qui masquerait le bouton ne protégerait de rien.
   */
  grade(state, { grade }, playerId) {
    if (state.hostId !== playerId) return false;
    if (!['facile', 'moyen', 'difficile'].includes(grade)) return false;
    state.grade = grade;
    return true;
  },

  /**
   * Frappe PRIVÉE d'un duel classé — l'équivalent de `letter`, mais jamais
   * partagée : seul son auteur la reçoit (voir `broadcastState`). Un mot
   * entier se révèle par `solveWord`, pas ici.
   */
  letterPrivate(state, { cellId, letter }, playerId) {
    if (!state.ranked || typeof cellId !== 'string') return false;
    if (!state.playerLetters[playerId]) state.playerLetters[playerId] = {};
    if (letter) state.playerLetters[playerId][cellId] = String(letter).slice(0, 1);
    else delete state.playerLetters[playerId][cellId];
    return true;
  },

  /**
   * Un joueur vient de compléter un mot entier (vérifié côté client, qui
   * seul connaît la réponse — même confiance que `scored` sur `letter`).
   * Premier arrivé : le mot devient PUBLIC (visible et verrouillé pour les
   * deux, teinté de la couleur du trouveur) et rapporte le point.
   */
  solveWord(state, { wordId, answer, clue }, playerId) {
    if (!state.ranked || typeof wordId !== 'string' || !wordId) return false;
    if (state.solvedWords[wordId]) return false; // déjà pris — l'autre a été plus rapide
    state.solvedWords[wordId] = playerId;
    recordTimeline(state, [{ id: wordId, answer, clue }], playerId);
    state.scores[playerId] = (state.scores[playerId] ?? 0) + 1;
    const profile = getProfile(playerId);
    profile.points += 1;
    recordPoints(profile, 1);
    profile.words += 1;
    profile.updatedAt = Date.now();
    return true;
  },

  /**
   * Quitte un duel classé EN COURS. Compte comme une défaite pour qui
   * quitte — sauf si l'adversaire est déjà déconnecté depuis 5 minutes ou
   * plus, auquel cas c'est LUI qui a abandonné, et partir ne coûte rien.
   */
  leaveMatch(state, _msg, playerId) {
    if (!state.ranked || state.matchOver) return false;
    const opponentId = otherPlayerId(state, playerId);
    const opponentGoneLongEnough =
      opponentId != null &&
      state.disconnectedAt[opponentId] != null &&
      Date.now() - state.disconnectedAt[opponentId] >= FORFEIT_GRACE_MS;
    concludeRankedMatch(state, {
      forfeitedBy: opponentGoneLongEnough ? opponentId : playerId,
    });
    return true;
  },

  rename(state, { name }, playerId) {
    const clean = String(name ?? '').trim().slice(0, 16);
    if (!clean) return false;
    const existant = state.players[playerId] ?? {};
    state.players[playerId] = { ...existant, name: clean };
    return true;
  },
};

// ---------- appariement 1v1 aléatoire ----------

function randomCode(length = 6) {
  // Mêmes caractères que côté client : on évite ceux qu'on confond à l'oral.
  const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += CHARS[Math.floor(Math.random() * CHARS.length)];
  return out;
}

function leaveQueue(ws) {
  const i = queue.indexOf(ws);
  if (i >= 0) queue.splice(i, 1);
}

/** Un duel classé dure ce temps-là, quel que soit l'avancement de la grille
 *  en cours au moment où il s'écoule — voir le balayage périodique plus bas. */
const MATCH_DURATION_MS = 10 * 60 * 1000;
/** Délai de grâce d'une déconnexion avant que PARTIR ne coûte plus rien à
 *  l'autre joueur — voir l'intent `leaveMatch`. */
const FORFEIT_GRACE_MS = 5 * 60 * 1000;

/** Jamais 'difficile' : un duel classé se joue vite, la grille au-dessus le
 *  réserve déjà — voir `tryMatch` et l'intent `advance`. */
function rankedGrade() {
  return Math.random() < 0.5 ? 'facile' : 'moyen';
}

/** Le seul autre joueur qu'on ait jamais vu dans cette salle — un duel
 *  classé n'en a jamais plus de deux. */
function otherPlayerId(state, playerId) {
  return Object.keys(state.players).find((id) => id !== playerId) ?? null;
}

/**
 * Conclut un duel classé UNE SEULE FOIS — par le chrono (`concludeRankedMatch(state)`,
 * vainqueur = meilleur score, `null` si égalité) ou par abandon
 * (`{ forfeitedBy }`, l'AUTRE joueur gagne). Solde alors les statistiques de
 * profil pour tout le match — pas grille par grille, voir l'intent `advance`.
 */
function concludeRankedMatch(state, { forfeitedBy } = {}) {
  // Duel classé OU partie privée arrivée au bout de sa limite de temps : les
  // deux se terminent de la même façon (écran de fin, vainqueur au score).
  // Seul le duel classé solde des statistiques de profil — voir plus bas.
  if (state.matchOver) return;
  if (!state.ranked && !state.timeLimitMin) return;
  state.matchOver = true;
  state.forfeitedBy = forfeitedBy ?? null;

  if (forfeitedBy) {
    state.winnerId = otherPlayerId(state, forfeitedBy);
  } else {
    const ids = Object.keys(state.players);
    const meilleur = Math.max(0, ...ids.map((id) => state.scores[id] ?? 0));
    const gagnants = ids.filter((id) => (state.scores[id] ?? 0) === meilleur);
    // Égalité parfaite (y compris 0-0) : pas de vainqueur.
    state.winnerId = gagnants.length === 1 ? gagnants[0] : null;
  }

  // Uniquement en classé : une partie privée compte déjà ses grilles une par
  // une dans l'intent `advance`, les recompter ici les doublerait.
  if (!state.ranked) return;
  for (const id of Object.keys(state.players)) {
    const profile = getProfile(id);
    profile.games += 1;
    if (id === state.winnerId) profile.wins += 1;
    // Bilan face à cet adversaire précis — « Vos derniers adversaires ».
    const adversaire = otherPlayerId(state, id);
    if (adversaire) {
      recordOpponent(profile, adversaire, state.winnerId === null ? 'n' : state.winnerId === id ? 'v' : 'd');
    }
    profile.updatedAt = Date.now();
  }
}

/**
 * Écart de points toléré entre deux adversaires, qui s'élargit avec
 * l'attente.
 *
 * Le but est d'apparier des joueurs de niveau proche SANS JAMAIS bloquer :
 * sur une base de joueurs encore petite, exiger un écart strict laisserait
 * des gens seuls dans la file indéfiniment. Au bout d'une trentaine de
 * secondes la fenêtre dépasse donc n'importe quel écart réel, et
 * l'appariement redevient « le premier venu ».
 */
const RANGE_BASE = 300;
const RANGE_PAR_SECONDE = 250;

function toleranceDe(ws) {
  const attente = (Date.now() - (ws.queuedAt ?? Date.now())) / 1000;
  return RANGE_BASE + attente * RANGE_PAR_SECONDE;
}

function tryMatch() {
  // Un joueur peut s'être déconnecté en attendant : le laisser tomber plutôt
  // que de l'apparier dans le vide.
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].readyState !== queue[i].OPEN) queue.splice(i, 1);
  }

  // Pas un simple shift/shift : deux joueurs qui se sont mutuellement
  // bloqués ne doivent jamais se retrouver appariés. On cherche la PREMIÈRE
  // paire valide dans la file plutôt que de perdre les autres en attente —
  // la file reste minuscule en pratique, le O(n²) est hors de propos.
  let apparie = true;
  while (apparie) {
    apparie = false;
    outer: for (let i = 0; i < queue.length; i++) {
      for (let j = i + 1; j < queue.length; j++) {
        const a = queue[i];
        const b = queue[j];
        if (!a.player || !b.player || isBlockedPair(a.player.id, b.player.id)) continue;

        // Niveau proche de préférence — la tolérance du plus PATIENT des deux
        // s'applique, pour qu'un joueur qui attend depuis longtemps débloque
        // la situation même face à un arrivant très mal classé.
        const ecart = Math.abs(totalPointsOf(getProfile(a.player.id)) - totalPointsOf(getProfile(b.player.id)));
        if (ecart > Math.max(toleranceDe(a), toleranceDe(b))) continue;

        queue.splice(j, 1);
        queue.splice(i, 1);

        const code = randomCode();
        const state = emptyRoom();
        // Partie déjà lancée : en 1v1 aléatoire, il n'y a personne à
        // attendre ni rien à régler dans un salon.
        state.started = true;
        state.ranked = true;
        state.matchEndsAt = Date.now() + MATCH_DURATION_MS;
        state.grade = rankedGrade();
        rooms.set(code, state);

        for (const ws of [a, b]) send(ws, { t: 'matched', room: code });

        apparie = true;
        break outer;
      }
    }
  }
}

// Le chrono d'un duel classé s'écoule même si personne n'agit sur la salle
// entre-temps (aucune frappe, aucun `advance`) : rien d'autre ne déclenche sa
// fin, il faut donc la vérifier activement plutôt que réactivement.
setInterval(() => {
  // La fenêtre de niveau s'élargit avec l'attente : sans ce rappel, deux
  // joueurs déjà en file et trop éloignés ne seraient jamais réévalués —
  // `tryMatch` n'est autrement appelé qu'à l'arrivée d'un nouveau joueur.
  if (queue.length >= 2) tryMatch();

  const now = Date.now();
  for (const [code, state] of rooms) {
    // Duel classé (10 min imposées) comme partie privée limitée par l'hôte :
    // `matchEndsAt` suffit à les reconnaître toutes les deux.
    if (!state.matchOver && state.matchEndsAt && now >= state.matchEndsAt) {
      concludeRankedMatch(state);
      markDirty();
      broadcastState(code);
    }
  }
}, 5_000);

// ---------- serveur ----------
await ensureSchema();
await loadSnapshot();
await loadProfiles();
await loadAccounts();
setInterval(saveSnapshot, SNAPSHOT_EVERY_MS);
setInterval(pruneRooms, 60 * 60 * 1000);

function json(res, body) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    // Le front est servi depuis une autre origine que ce service.
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

const http = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Le front est servi depuis une autre origine ; sans préflight, le POST du
  // profil serait bloqué par le navigateur.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'POST' && (url.pathname === '/register' || url.pathname === '/login')) {
    const ip = req.socket.remoteAddress ?? 'inconnu';
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4_000) req.destroy();
    });
    req.on('end', async () => {
      // Limitation avant tout traitement : elle protège aussi bien le coût
      // du scrypt que le compte lui-même.
      if (!allowAttempt(ip)) {
        res.writeHead(429, { 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Trop de tentatives, réessayez plus tard' }));
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }

      const username = String(payload.username ?? '').trim();
      const password = String(payload.password ?? '');

      if (url.pathname === '/register') {
        if (!USERNAME_RE.test(username)) {
          return json(res, { error: 'Pseudo : 3 à 20 caractères, lettres, chiffres ou _' });
        }
        if (password.length < MIN_PASSWORD) {
          return json(res, { error: `Mot de passe : ${MIN_PASSWORD} caractères minimum` });
        }
        if (accounts.has(username.toLowerCase())) {
          return json(res, { error: 'Ce pseudo est déjà pris' });
        }

        const account = await createAccount(username, password);
        const profile = getProfile(account.id);
        profile.name = username;
        migrateAnonymousProgress(profile, account.id, payload.migrateFrom);

        return json(res, { id: account.id, username, token: issueToken(account.id) });
      }

      const account = accounts.get(username.toLowerCase());
      // Message identique que le compte existe ou non : sinon on révélerait
      // quels pseudos sont enregistrés.
      const echec = { error: 'Pseudo ou mot de passe incorrect' };
      if (!account) return json(res, echec);
      if (!(await verifyPassword(account, password))) return json(res, echec);

      return json(res, {
        id: account.id,
        username: account.username,
        token: issueToken(account.id),
      });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/oauth/callback') {
    const ip = req.socket.remoteAddress ?? 'inconnu';
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_000) req.destroy();
    });
    req.on('end', async () => {
      if (!allowAttempt(ip)) {
        res.writeHead(429, { 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Trop de tentatives, réessayez plus tard' }));
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }

      const provider = payload.provider === 'google' || payload.provider === 'apple' ? payload.provider : null;
      const credential = String(payload.credential ?? '');
      if (!provider || !credential) return json(res, { error: 'Requête invalide' });

      // Un jeton refusé ici veut dire : signature invalide, expiré, ou pas
      // destiné à CETTE app (`aud`) — jamais un problème de compte, donc un
      // seul message, générique, comme pour /login.
      let claims;
      try {
        claims = provider === 'google'
          ? await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID)
          : await verifyAppleIdToken(credential, APPLE_AUDIENCE);
      } catch (err) {
        console.error(`[oauth] jeton ${provider} refusé —`, err.message);
        return json(res, { error: 'Connexion refusée, réessaie' });
      }

      let account = accountsByProvider.get(`${provider}:${claims.sub}`);
      if (!account) {
        // Le nom n'est fourni qu'à la toute première connexion (surtout
        // vrai pour Apple) : `payload.name`, capturé côté client à cet
        // instant précis, sert de repli quand le jeton lui-même n'en a pas.
        const indice = ('name' in claims ? claims.name : null) || payload.name || claims.email;
        const username = pickUsername(indice);
        account = createOAuthAccount(provider, claims.sub, claims.email, username);
        const profile = getProfile(account.id);
        profile.name = username;
        migrateAnonymousProgress(profile, account.id, payload.migrateFrom);
      }

      return json(res, { id: account.id, username: account.username, token: issueToken(account.id) });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        if (token) {
          tokens.delete(token);
          markDirty();
        }
      } catch {
        /* rien à faire : se déconnecter ne doit jamais échouer bruyamment */
      }
      json(res, { ok: true });
    });
    return;
  }

  if (url.pathname === '/session') {
    const id = resolveToken(url.searchParams.get('token') ?? '');
    if (!id) return json(res, { valid: false });
    const account = [...accounts.values()].find((a) => a.id === id);
    return json(res, { valid: true, id, username: account?.username ?? null });
  }

  /**
   * Suppression de compte (obligatoire pour la review App Store/Play Store :
   * un joueur doit pouvoir supprimer son compte DEPUIS l'app, pas seulement
   * s'en déconnecter). Efface tout ce qui est identifié par ce compte —
   * irréversible, d'où l'instantané forcé immédiatement après plutôt que
   * d'attendre le tick de 10s : un crash entre les deux ne doit pas pouvoir
   * ressusciter le compte depuis un ancien instantané.
   */
  if (req.method === 'POST' && url.pathname === '/account-delete') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { token } = JSON.parse(body);
        const id = resolveToken(token ?? '');
        if (!id) return json(res, { error: 'Session invalide' });

        const entree = [...accounts.entries()].find(([, a]) => a.id === id);
        if (entree) accounts.delete(entree[0]);

        for (const [t, entry] of [...tokens.entries()]) {
          if (entry.id === id) tokens.delete(t);
        }

        profiles.delete(id);

        const salleSolo = `solo-${id}`;
        rooms.delete(salleSolo);
        sockets.delete(salleSolo);

        // force=true : une suppression de compte doit être durablement
        // actée immédiatement, pas attendre le prochain changement pour
        // qu'un cycle d'instantané la remarque.
        await saveSnapshot(true);
        json(res, { ok: true });
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  // Mise à jour du profil hors partie : l'écran de profil est accessible
  // depuis l'accueil, où aucun socket n'est ouvert.
  if (req.method === 'POST' && url.pathname === '/profile-update') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 60_000) req.destroy(); // garde-fou
    });
    req.on('end', () => {
      try {
        const { id: claimedId, token, name, avatar } = JSON.parse(body);
        const id = verifiedId(claimedId, token);
        if (!id) {
          res.writeHead(400);
          return res.end();
        }
        const profile = getProfile(id);
        if (typeof name === 'string' && name.trim()) profile.name = name.trim().slice(0, 16);
        if (typeof avatar === 'string') profile.avatar = avatar.length <= 40_000 ? avatar : profile.avatar;
        else if (avatar === null) profile.avatar = null;
        profile.updatedAt = Date.now();
        markDirty();
        json(res, publicProfile(id));
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/block' || url.pathname === '/unblock')) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const { id: claimedId, token, playerId } = JSON.parse(body);
        const id = verifiedId(claimedId, token);
        if (!id || !playerId || id === playerId) {
          res.writeHead(400);
          return res.end();
        }
        if (url.pathname === '/block') {
          if (!blocks.has(id)) blocks.set(id, new Set());
          blocks.get(id).add(String(playerId).slice(0, 64));
          // Rester ami avec quelqu'un qu'on vient de bloquer n'a pas de sens
          // — et le laisserait apparaître au classement « Amis ».
          defaireRelation(id, String(playerId).slice(0, 64));
        } else {
          blocks.get(id)?.delete(playerId);
        }
        markDirty();
        json(res, { blocked: [...blockedIds(id)] });
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  if (url.pathname === '/blocks') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.writeHead(400);
      return res.end();
    }
    return json(res, { blocked: [...blockedIds(id)] });
  }

  /**
   * État complet des relations d'un joueur : amis, demandes reçues et
   * envoyées. Une seule route plutôt que trois — l'écran Amis affiche les
   * trois ensemble, et les séparer multiplierait les allers-retours.
   */
  if (url.pathname === '/friends') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.writeHead(400);
      return res.end();
    }
    const p = profiles.get(id);
    return json(res, {
      friends: (p?.friends ?? []).map(vueAmi).sort((a, b) => Number(b.online) - Number(a.online)),
      incoming: (p?.reqIn ?? []).map(vueAmi),
      outgoing: (p?.reqOut ?? []).map(vueAmi),
    });
  }

  /**
   * Toutes les actions d'amitié passent par ici — elles partagent la même
   * vérification d'identité et renvoient le même état complet, ce qui évite
   * au client de recharger derrière chaque action.
   */
  if (req.method === 'POST' && url.pathname === '/friend') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const { id: claimedId, token, action, username, playerId } = JSON.parse(body);
        const id = verifiedId(claimedId, token);
        // Une relation engage DEUX comptes : un invité, dont l'identité
        // disparaît au prochain rechargement, n'a rien à faire ici.
        if (!id || !id.startsWith('acc_')) {
          res.writeHead(403);
          return res.end();
        }
        const moi = getProfile(id);
        let cible = null;
        let erreur = null;

        if (action === 'request') {
          const compte = findAccountByUsername(username);
          if (!compte) erreur = 'Aucun joueur à ce pseudo.';
          else if (compte.id === id) erreur = 'C’est vous.';
          else if (isBlockedPair(id, compte.id)) erreur = 'Impossible d’ajouter ce joueur.';
          else cible = compte.id;

          if (cible) {
            if ((moi.friends ?? []).includes(cible)) erreur = 'Vous êtes déjà amis.';
            else if ((moi.reqOut ?? []).includes(cible)) erreur = 'Demande déjà envoyée.';
          }
          if (!erreur && cible) {
            const autre = getProfile(cible);
            // Demande croisée : les deux se sont ajoutés chacun de leur côté,
            // il n'y a plus rien à confirmer.
            if ((moi.reqIn ?? []).includes(cible)) {
              moi.reqIn = retirer(moi.reqIn, cible);
              autre.reqOut = retirer(autre.reqOut, id);
              moi.friends = [...new Set([...(moi.friends ?? []), cible])];
              autre.friends = [...new Set([...(autre.friends ?? []), id])];
            } else {
              moi.reqOut = [...new Set([...(moi.reqOut ?? []), cible])];
              autre.reqIn = [...new Set([...(autre.reqIn ?? []), id])];
            }
            autre.updatedAt = Date.now();
          }
        } else if (action === 'accept') {
          cible = String(playerId ?? '').slice(0, 64);
          if (!(moi.reqIn ?? []).includes(cible)) erreur = 'Demande introuvable.';
          else {
            const autre = getProfile(cible);
            moi.reqIn = retirer(moi.reqIn, cible);
            autre.reqOut = retirer(autre.reqOut, id);
            moi.friends = [...new Set([...(moi.friends ?? []), cible])];
            autre.friends = [...new Set([...(autre.friends ?? []), id])];
            autre.updatedAt = Date.now();
          }
        } else if (action === 'decline') {
          cible = String(playerId ?? '').slice(0, 64);
          const autre = profiles.get(cible);
          moi.reqIn = retirer(moi.reqIn, cible);
          if (autre) {
            autre.reqOut = retirer(autre.reqOut, id);
            autre.updatedAt = Date.now();
          }
        } else if (action === 'cancel' || action === 'remove') {
          // `cancel` annule une demande envoyée, `remove` défait une amitié :
          // dans les deux cas il s'agit de couper la relation des deux côtés.
          defaireRelation(id, String(playerId ?? '').slice(0, 64));
        } else {
          res.writeHead(400);
          return res.end();
        }

        moi.updatedAt = Date.now();
        markDirty();
        return json(res, {
          error: erreur,
          friends: (moi.friends ?? []).map(vueAmi).sort((a, b) => Number(b.online) - Number(a.online)),
          incoming: (moi.reqIn ?? []).map(vueAmi),
          outgoing: (moi.reqOut ?? []).map(vueAmi),
        });
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  if (url.pathname === '/health') {
    return json(res, { status: 'ok', rooms: rooms.size, profiles: profiles.size, queue: queue.length });
  }

  if (url.pathname === '/leaderboard') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    // 'global' (total de toujours) ou 'semaine' (7 derniers jours). Un seul
    // barème dans les deux cas : solo et multijoueur additionnés, voir
    // `totalPointsOf` — il n'y a plus de classement séparé par mode.
    const scope = url.searchParams.get('scope');
    const semaine = scope === 'semaine';
    const score = (p) => (semaine ? pointsSince(p, 7) : totalPointsOf(p));

    // « Amis » : soi-même et ses amis uniquement. Un classement de trois
    // personnes n'a d'intérêt que si l'on s'y voit, d'où l'inclusion de soi.
    let cercle = null;
    if (scope === 'amis') {
      const moi = url.searchParams.get('id');
      const p = moi ? profiles.get(moi) : null;
      cercle = new Set([...(p?.friends ?? []), moi].filter(Boolean));
    }

    const top = [...profiles.values()]
      .filter((p) => !cercle || cercle.has(p.id))
      // Un invité (id préfixé `guest-`, jamais persisté côté client) ne doit
      // jamais apparaître au classement — c'est explicitement ce qu'« aucune
      // persistance, pas de classement » veut dire. L'adversaire artificiel
      // (id préfixé `bot-`, voir BotGame.tsx) n'est pas un joueur non plus.
      .filter((p) => !p.id.startsWith('guest-') && !p.id.startsWith('bot-'))
      // Un joueur sans point n'a rien à faire dans un classement ouvert —
      // sauf entre amis, où l'on veut voir TOUT son cercle, y compris celui
      // qui vient de s'inscrire.
      .filter((p) => cercle || score(p) > 0)
      .sort((a, b) => score(b) - score(a) || b.words - a.words)
      .slice(0, limit)
      .map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        points: score(p),
        words: p.words,
        wins: p.wins,
        soloGrids: p.soloGrids,
        // Le palier tient lieu de titre : c'est lui qui est généralisé à
        // tous les modes, contrairement aux médailles.
        title: soloTierFor(p).tier.label,
      }));
    return json(res, { top });
  }

  if (url.pathname === '/profile') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.writeHead(400);
      return res.end();
    }
    const me = publicProfile(id);
    // Rang calculé à la volée : le nombre de profils reste modeste et cela
    // évite de maintenir un index à jour. Un invité n'a pas de rang — il
    // n'apparaît jamais au classement (voir /leaderboard) — et ne doit pas
    // non plus en gonfler le calcul pour les autres ; même chose pour le bot.
    const horsClassement = id.startsWith('guest-') || id.startsWith('bot-');
    // Sur le TOTAL tous modes, comme /leaderboard : un joueur exclusivement
    // solo doit pouvoir être mieux classé qu'un joueur multijoueur moyen.
    const mieux = [...profiles.values()]
      .filter((p) => !p.id.startsWith('guest-') && !p.id.startsWith('bot-'))
      .filter((p) => totalPointsOf(p) > me.totalPoints).length;
    return json(res, { ...me, rank: !horsClassement && me.totalPoints > 0 ? mieux + 1 : null });
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });
let nextConnectionId = 1;

wss.on('connection', (ws) => {
  ws.connectionId = nextConnectionId++;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.t === 'join') {
      // 80, pas 32 : une salle solo encode l'identifiant du joueur dans son
      // code (`solo-<playerId>`), et un id de compte (`acc_` + 24 hex) ou un
      // UUID anonyme dépasse déjà 32 caractères à lui seul.
      const code = String(msg.room ?? '').slice(0, 80);
      const player = msg.player ?? {};
      if (!code || !player.id) return;

      const playerId = verifiedId(player.id, player.token);
      if (!playerId) {
        send(ws, { t: 'error', reason: 'identité invalide' });
        ws.close();
        return;
      }

      // Isolation des salles solo : le propriétaire se déduit du code
      // lui-même, aucun champ à faire confiance séparément. Un tiers qui
      // devine ou reçoit ce code ne peut pas rejoindre la partie de
      // quelqu'un d'autre — seul le même playerId (donc le même compte,
      // éventuellement depuis un autre appareil) le peut.
      if (code.startsWith('solo-') && code.slice(5) !== playerId) {
        send(ws, { t: 'error', reason: 'forbidden' });
        ws.close();
        return;
      }

      ws.room = code;
      ws.player = {
        id: playerId,
        name: String(player.name ?? 'Joueur').slice(0, 16),
        color: String(player.color ?? '#9CA3AF').slice(0, 9),
        activeCell: null,
      };

      if (!rooms.has(code)) {
        const room = emptyRoom();
        // Fixé à la création, jamais réattribué sur les joins suivants —
        // même logique que `hostId` juste en dessous.
        const demande = String(msg.mode ?? '');
        if (demande === 'solo' || demande === 'daily') room.mode = demande;
        rooms.set(code, room);
      }
      if (!sockets.has(code)) sockets.set(code, new Set());
      sockets.get(code).add(ws);

      const state = rooms.get(code);
      state.touchedAt = Date.now();
      // Solo et quotidien ne passent jamais par `start` : c'est l'arrivée du
      // joueur qui donne son origine de temps à la chronologie.
      if (!state.roundStartedAt) state.roundStartedAt = Date.now();
      // Présence : compte les connexions, pas les salles — un joueur peut
      // avoir plusieurs onglets, il reste en ligne tant qu'il en reste un.
      if (!ws.compteEnLigne) {
        ws.compteEnLigne = true;
        markOnline(playerId);
      }
      // Le PREMIER arrivant devient hôte, et le reste : réattribuer ferait
      // hériter le rôle au moindre départ du créateur.
      if (state.hostId == null) state.hostId = ws.player.id;
      state.players[ws.player.id] = { name: ws.player.name, color: ws.player.color };
      // Une reconnexion efface la trace de déconnexion — voir `leaveMatch` et
      // la règle des 5 minutes de grâce.
      if (state.disconnectedAt) delete state.disconnectedAt[ws.player.id];

      // Le profil persistant reprend le pseudo courant : sans cela, un joueur
      // qui n'a jamais ouvert l'écran de profil apparaîtrait « Joueur » au
      // classement alors qu'il porte un nom en partie.
      const profile = getProfile(ws.player.id);
      if (profile.name === 'Joueur' || !profile.name) profile.name = ws.player.name;
      markDirty(); // nouvelle salle et/ou nouveau profil potentiellement créés

      send(ws, { t: 'welcome', connectionId: ws.connectionId });
      broadcastState(code);
      broadcastPresence(code);
      return;
    }

    // La file d'attente se traite AVANT le garde-fou de partie : on cherche
    // un adversaire précisément quand on n'est encore dans aucune partie.
    if (msg.t === 'queue') {
      // Il faut connaître le joueur AVANT de l'apparier, pour pouvoir
      // vérifier les blocages — contrairement à `join`, la file d'attente ne
      // rejoint aucune salle et n'identifiait donc personne jusqu'ici.
      const player = msg.player ?? {};
      if (player.id) {
        const playerId = verifiedId(player.id, player.token);
        if (!playerId) {
          send(ws, { t: 'error', reason: 'identité invalide' });
          return;
        }
        ws.player = {
          id: playerId,
          name: String(player.name ?? 'Joueur').slice(0, 16),
          color: String(player.color ?? '#9CA3AF').slice(0, 9),
          activeCell: null,
        };
      }
      if (!queue.includes(ws)) {
        // Horodaté à l'entrée : c'est l'ancienneté dans la file qui élargit
        // la fenêtre de niveau (voir `toleranceDe`).
        ws.queuedAt = Date.now();
        queue.push(ws);
      }
      send(ws, { t: 'queued', position: queue.indexOf(ws) + 1 });
      tryMatch();
      return;
    }

    if (msg.t === 'unqueue') {
      leaveQueue(ws);
      return;
    }

    if (!ws.room || !rooms.has(ws.room)) return;
    const state = rooms.get(ws.room);
    state.touchedAt = Date.now();

    if (msg.t === 'presence') {
      ws.player.activeCell = msg.activeCell ?? null;
      broadcastPresence(ws.room);
      return;
    }

    if (msg.t === 'reaction') {
      // Éphémère par nature (une réaction n'a de sens que "maintenant") :
      // jamais écrite dans `state`, donc jamais persistée ni rediffusée en
      // `state` — un simple message relayé aux autres, comme `presence`.
      if (!REACTIONS.has(msg.emoji)) return;
      const now = Date.now();
      if (now - (ws.lastReactionAt ?? 0) < REACTION_COOLDOWN_MS) return;
      ws.lastReactionAt = now;

      const message = JSON.stringify({
        t: 'reaction',
        playerId: ws.player.id,
        name: ws.player.name,
        color: ws.player.color,
        emoji: msg.emoji,
      });
      // Pas à l'auteur : son propre clic s'anime déjà en local (voir
      // GameState.tsx) — la rediffuser lui ferait voir sa réaction deux fois.
      for (const autre of peers(ws.room)) {
        if (autre !== ws && autre.readyState === autre.OPEN) autre.send(message);
      }
      return;
    }

    /**
     * Revanche après un duel classé conclu : il faut les DEUX pour repartir
     * ensemble — géré ici plutôt que dans INTENTS pour pouvoir, dès l'accord
     * mutuel, ouvrir directement la nouvelle salle et prévenir les deux
     * sockets (`matched`), exactement comme `tryMatch`.
     */
    if (msg.t === 'rematchRequest') {
      if (!state.ranked || !state.matchOver) return;
      state.rematchRequestedBy[ws.player.id] = true;
      const opponentId = otherPlayerId(state, ws.player.id);
      const opponent = opponentId
        ? [...peers(ws.room)].find((autre) => autre.player?.id === opponentId)
        : null;

      if (opponentId && state.rematchRequestedBy[opponentId]) {
        const code = randomCode();
        const nouvelle = emptyRoom();
        nouvelle.started = true;
        nouvelle.ranked = true;
        nouvelle.matchEndsAt = Date.now() + MATCH_DURATION_MS;
        nouvelle.grade = rankedGrade();
        rooms.set(code, nouvelle);
        send(ws, { t: 'matched', room: code });
        if (opponent) send(opponent, { t: 'matched', room: code });
      } else {
        markDirty();
        broadcastState(ws.room); // pour que l'adversaire voie "en attente de revanche"
      }
      return;
    }

    const intent = INTENTS[msg.t];
    if (intent) {
      const changed = intent(state, msg, ws.player.id);
      markDirty();
      if (changed) broadcastState(ws.room);
    }
  });

  ws.on('close', () => {
    leaveQueue(ws);
    if (ws.compteEnLigne && ws.player) {
      ws.compteEnLigne = false;
      markOffline(ws.player.id);
    }
    if (!ws.room) return;
    peers(ws.room).delete(ws);
    const state = rooms.get(ws.room);
    // Horodatage de départ — seule trace qu'un duel classé garde d'une
    // déconnexion, pour la règle de grâce des 5 minutes (voir `leaveMatch`).
    if (state?.ranked && ws.player) {
      state.disconnectedAt[ws.player.id] = Date.now();
      markDirty();
    }
    broadcastPresence(ws.room);
  });
});

// Sans ce battement, un client parti sans fermer proprement resterait compté
// comme présent — et bloquerait par exemple l'attente du « prêt » de tous.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

http.listen(PORT, () => console.log(`[ws] écoute sur :${PORT}`));

// Un hébergeur (Railway, Fly, ...) envoie SIGTERM avant de tuer le process à
// chaque redéploiement. Sans ce handler, Node quitte immédiatement et perd
// jusqu'à SNAPSHOT_EVERY_MS de parties, points et comptes non encore
// écrits en base.
async function arreterProprement() {
  console.log('[arrêt] instantané final avant extinction');
  await saveSnapshot(true); // force : même si rien n'a été marqué "dirty"
  process.exit(0);
}
process.on('SIGTERM', arreterProprement);
process.on('SIGINT', arreterProprement);
