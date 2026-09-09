/**
 * Client temps réel des parties — remplace Liveblocks.
 *
 * Le serveur fait autorité : on ne modifie jamais l'état local, on envoie une
 * intention et on attend l'état rediffusé. Cela évite les divergences entre
 * une prédiction optimiste et ce que le serveur a réellement appliqué.
 *
 * La reconnexion est automatique et rejoue le `join` : couper le Wi-Fi ou
 * verrouiller son téléphone ne doit pas sortir de la partie.
 */

import { activePlayerToken } from './auth';

export interface RoomState {
  round: number;
  game: number;
  hostId: string | null;
  started: boolean;
  kicked: Record<string, boolean>;
  letters: Record<string, string>;
  revealed: Record<string, boolean>;
  scores: Record<string, number>;
  hints: Record<string, number>;
  ready: Record<string, number>;
  players: Record<string, { name: string; color: string }>;
  /** playerId -> 'A' | 'B' pour les parties par équipes (2v2, 3v3). */
  teams: Record<string, string>;
  /** Partie classée (1v1 aléatoire) : les points comptent au classement. */
  ranked?: boolean;
  /** Grade choisi par l'hôte — répartition facile/moyen/difficile des indices. */
  grade?: string;
  /** Format d'une partie privée : 'coop' | 'equipes' | '1v1'. Pilote `teams`. */
  format?: string;
  /** Ordre de découverte des mots de la manche : qui a pris quoi, et au bout
   *  de combien de millisecondes depuis l'ouverture de la grille. */
  timeline?: { wordId: string; playerId: string; at: number }[];
  /** Limite de temps du salon en minutes — `null` = illimité. */
  timeLimitMin?: number | null;
  /** Chacun sa grille : les frappes des autres restent invisibles jusqu'à ce
   *  qu'un mot entier tombe. Toujours vrai en duel classé (voir `ranked`). */
  hideLetters?: boolean;

  // ---------- duel classé (1v1 aléatoire) ----------
  /** Horodatage de fin de match (`Date.now()` + 10 min à l'appariement). */
  matchEndsAt?: number | null;
  /** Le match est-il conclu (chrono écoulé ou abandon) ? */
  matchOver?: boolean;
  /** Vainqueur une fois `matchOver` — `null` si égalité parfaite. */
  winnerId?: string | null;
  /** Si conclu par abandon plutôt que par le chrono : qui a abandonné. */
  forfeitedBy?: string | null;
  /** wordId -> playerId qui l'a trouvé — visible et verrouillé pour tous. */
  solvedWords?: Record<string, string>;
  /** Frappes privées en cours — le serveur n'envoie jamais que les SIENNES à
   *  chaque joueur (voir server/websocket/index.js, `broadcastState`). */
  playerLetters?: Record<string, Record<string, string>>;
  /** playerId -> true : qui a déjà demandé une revanche. */
  rematchRequestedBy?: Record<string, boolean>;
}

export interface Medal {
  id: string;
  label: string;
  icon: string;
}

export interface CatalogMedal extends Medal {
  /** Condition d'obtention, en toutes lettres (ex. « 10 victoires »). */
  reason: string;
  earned: boolean;
}

export interface SoloTier {
  id: string;
  label: string;
  icon: string;
  min: number;
}

export interface Profile {
  id: string;
  name: string;
  avatar: string | null;
  points: number;
  words: number;
  wins: number;
  games: number;
  dailies: number;
  medals: Medal[];
  /** Catalogue complet (obtenues et non), pour un aperçu des verrouillées. */
  allMedals: CatalogMedal[];
  title: string;
  rank: number | null;
  /** Solo + multijoueur additionnés — c'est CE total qui classe et qui donne
   *  le palier (voir `totalPointsOf` côté serveur). `points` et `soloPoints`
   *  n'en sont plus que le détail. */
  totalPoints: number;
  /** Points gagnés sur les sept derniers jours — onglet « Semaine ». */
  weekPoints: number;
  /** Points par jour sur 30 jours, du plus ancien au plus récent — frise
   *  d'activité du profil. */
  activity: number[];
  /** Derniers adversaires en duel classé, du plus récent au plus ancien. */
  recentOpponents: {
    id: string;
    name: string;
    avatar: string | null;
    wins: number;
    losses: number;
    draws: number;
  }[];
  /** Mots trouvés le plus vite, du plus rapide au plus lent. */
  bestWords: { answer: string; clue: string; ms: number }[];
  /** Temps moyen pour trouver un mot, en millisecondes — `null` tant
   *  qu'aucun mot n'a été mesuré. */
  avgWordMs: number | null;
  /** Détail de l'économie solo, à l'intérieur de `totalPoints`. */
  soloPoints: number;
  soloGrids: number;
  hintBalance: number;
  tier: SoloTier;
  next: SoloTier | null;
  pointsToNext: number | null;

  // ---------- grille du jour (accueil V2) ----------
  /** Jours d'affilée avec la grille du jour faite. Tolère qu'elle ne soit pas
   *  encore faite AUJOURD'HUI (voir `dailyStatsFor` côté serveur). */
  streak: number;
  /** 21 derniers jours, du plus ancien au plus récent : grille du jour faite ? */
  dailyHistory: boolean[];
  /** Rang sur la grille du jour — `null` tant qu'on ne l'a pas jouée. */
  dailyRank: number | null;
  /** Nombre de joueurs ayant fait la grille du jour. */
  dailyTotal: number;
  /** La grille du jour est-elle déjà faite aujourd'hui ? */
  dailyDone: boolean;
}

export interface LeaderboardRow {
  rank: number;
  id: string;
  name: string;
  avatar: string | null;
  points: number;
  words: number;
  wins: number;
  soloGrids: number;
  title: string;
}

export interface RoomPeer {
  id: string;
  name: string;
  color: string;
  activeCell: string | null;
  connectionId: number;
}

export const EMPTY_STATE: RoomState = {
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
};

export interface RoomHandlers {
  onState: (state: RoomState) => void;
  onPresence: (players: RoomPeer[]) => void;
  onStatus?: (connected: boolean) => void;
  /** Adversaire trouvé en 1v1 aléatoire : code de la partie à rejoindre. */
  onMatched?: (room: string) => void;
  /** Réaction live REÇUE d'un autre joueur — jamais la sienne propre, voir
   *  server/websocket/index.js (l'auteur n'est pas dans la diffusion). */
  onReaction?: (r: { playerId: string; name: string; color: string; emoji: string }) => void;
}

export interface RoomConnection {
  send: (message: Record<string, unknown>) => void;
  close: () => void;
}

function resolveUrl(): string {
  const configured = import.meta.env.VITE_REALTIME_URL?.trim();
  if (configured) return configured;
  // Repli sur la même origine : en développement, le proxy de vite.config.ts
  // redirige /ws vers le serveur local.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function connectRoom(
  /**
   * `null` ouvre la connexion SANS rejoindre de partie — nécessaire pour la
   * file d'attente du 1v1 aléatoire, où l'on cherche justement un adversaire
   * avant d'avoir la moindre partie.
   */
  room: string | null,
  /** `token` prouve l'id revendiqué quand c'est un compte (`acc_…`) — voir
   *  `activePlayerToken` côté client et `verifiedId` côté serveur. Inutile
   *  (et absent) pour un invité ou un bot, qui n'ont rien à prouver. */
  player: { id: string; name: string; color: string; token?: string | null },
  handlers: RoomHandlers,
  /** 'solo' | 'daily' — fixe le mode de la salle à sa création (voir server/index.js). */
  mode?: string,
): RoomConnection {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // File d'attente : une intention émise pendant une coupure ne doit pas être
  // perdue en silence, sinon une lettre tapée au mauvais moment disparaît.
  const pending: string[] = [];

  const flush = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (pending.length) ws.send(pending.shift() as string);
  };

  const open = () => {
    if (closed) return;
    ws = new WebSocket(resolveUrl());

    ws.onopen = () => {
      retry = 0;
      handlers.onStatus?.(true);
      if (room) ws?.send(JSON.stringify({ t: 'join', room, player, mode }));
      flush();
    };

    ws.onmessage = (event) => {
      let msg: { t: string; [k: string]: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.t === 'state') handlers.onState(msg.state as RoomState);
      else if (msg.t === 'presence') handlers.onPresence(msg.players as RoomPeer[]);
      else if (msg.t === 'matched') handlers.onMatched?.(msg.room as string);
      else if (msg.t === 'reaction') {
        handlers.onReaction?.(msg as unknown as { playerId: string; name: string; color: string; emoji: string });
      }
    };

    ws.onclose = () => {
      handlers.onStatus?.(false);
      if (closed) return;
      // Recul exponentiel plafonné : un serveur qui redémarre ne doit pas se
      // faire marteler par tous les clients à la fois.
      retry += 1;
      const delay = Math.min(500 * 2 ** (retry - 1), 8000);
      timer = setTimeout(open, delay);
    };

    ws.onerror = () => ws?.close();
  };

  open();

  return {
    send: (message) => {
      const raw = JSON.stringify(message);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
      else pending.push(raw);
    },
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}

/**
 * Base HTTP du service temps réel (classement, profils).
 *
 * En développement, `/ws` est proxifié en WebSocket et ne convient pas pour
 * du HTTP : vite.config.ts expose `/rt` pour cela.
 */
function httpBase(): string {
  const configured = import.meta.env.VITE_REALTIME_URL?.trim();
  if (configured) return configured.replace(/^ws/, 'http').replace(/\/$/, '');
  return '/rt';
}

/**
 * Classement — un seul barème, solo et multijoueur additionnés (voir
 * `totalPointsOf` côté serveur). `scope` ne change que la PÉRIODE prise en
 * compte, plus le mode de jeu : 'global' cumule tout, 'semaine' les sept
 * derniers jours.
 */
export async function fetchLeaderboard(
  limit = 50,
  scope: 'global' | 'semaine' | 'amis' = 'global',
  /** Requis pour `scope: 'amis'` — le serveur ne classe alors que ce joueur
   *  et son cercle. */
  id?: string,
): Promise<LeaderboardRow[]> {
  const params = id ? `&id=${encodeURIComponent(id)}` : '';
  const res = await fetch(`${httpBase()}/leaderboard?limit=${limit}&scope=${scope}${params}`);
  if (!res.ok) throw new Error(`classement: ${res.status}`);
  return (await res.json()).top as LeaderboardRow[];
}

export async function fetchProfile(id: string): Promise<Profile> {
  const res = await fetch(`${httpBase()}/profile?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`profil: ${res.status}`);
  return (await res.json()) as Profile;
}

async function postBlock(path: 'block' | 'unblock', id: string, playerId: string): Promise<string[]> {
  const res = await fetch(`${httpBase()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, playerId, token: activePlayerToken() }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()).blocked as string[];
}

/** Bloque `playerId` pour les futurs duels aléatoires de `id`. */
export const blockPlayer = (id: string, playerId: string) => postBlock('block', id, playerId);
export const unblockPlayer = (id: string, playerId: string) => postBlock('unblock', id, playerId);

export async function fetchBlocked(id: string): Promise<string[]> {
  const res = await fetch(`${httpBase()}/blocks?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`blocages: ${res.status}`);
  return (await res.json()).blocked as string[];
}

/**
 * Met à jour le pseudo et/ou la photo. Par HTTP plutôt que par le socket
 * (voir `send({t:'profile',...})` dans GameState.tsx) car l'écran Profil est
 * accessible hors partie, sans connexion temps réel ouverte.
 */
export async function updateProfile(id: string, patch: { name?: string; avatar?: string | null }): Promise<void> {
  // `id` est toujours celui de l'appelant lui-même (voir Profile.tsx) — le
  // jeton se lit donc directement ici plutôt que de le faire remonter par
  // chaque appelant. Absent pour un invité : `verifiedId` côté serveur ne
  // l'exige que pour un id de compte (`acc_…`).
  const token = activePlayerToken();
  const res = await fetch(`${httpBase()}/profile-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, token, ...patch }),
  });
  if (!res.ok) throw new Error(`profil: ${res.status}`);
}

// ---------- amis ----------

/** Un joueur tel qu'il apparaît dans la liste d'amis ou une demande. */
export interface FriendView {
  id: string;
  name: string;
  avatar: string | null;
  online: boolean;
  /** Dernière connexion (ms epoch) — `0` si jamais vu. */
  lastSeenAt: number;
  tier: string | null;
  points: number;
}

/** État complet des relations : les trois listes arrivent ensemble, l'écran
 *  Amis les affichant côte à côte. */
export interface FriendState {
  friends: FriendView[];
  incoming: FriendView[];
  outgoing: FriendView[];
  /** Message d'échec d'une action (pseudo inconnu, déjà amis…). */
  error?: string | null;
}

export async function fetchFriends(id: string): Promise<FriendState> {
  const res = await fetch(`${httpBase()}/friends?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`amis: ${res.status}`);
  return (await res.json()) as FriendState;
}

/**
 * Signale au serveur qu'on a l'application à l'écran (voir `presence.ts`).
 *
 * Silencieux à dessein : un battement perdu se rattrape au suivant, il n'y a
 * rien à annoncer à l'utilisateur — surtout pas une erreur pour une info
 * aussi secondaire qu'une pastille de statut.
 */
export async function pingPresence(id: string): Promise<void> {
  await fetch(`${httpBase()}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, token: activePlayerToken() }),
  }).catch(() => {});
}

/**
 * Toutes les actions d'amitié passent par la même route, qui renvoie l'état
 * complet mis à jour — inutile de recharger derrière.
 *
 * `request` vise un PSEUDO (c'est ce qu'on tape), les autres un identifiant
 * (on agit sur quelqu'un déjà présent dans une des listes).
 */
export async function friendAction(
  id: string,
  action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove',
  cible: { username?: string; playerId?: string },
): Promise<FriendState> {
  const res = await fetch(`${httpBase()}/friend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, token: activePlayerToken(), action, ...cible }),
  });
  if (!res.ok) throw new Error(`amis: ${res.status}`);
  return (await res.json()) as FriendState;
}
