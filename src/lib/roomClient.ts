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
}

export interface Medal {
  id: string;
  label: string;
  icon: string;
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
  title: string;
  rank: number | null;
  /** Économie solo — séparée du classement général ci-dessus. */
  soloPoints: number;
  soloGrids: number;
  hintBalance: number;
  tier: SoloTier;
  next: SoloTier | null;
  pointsToNext: number | null;
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
  player: { id: string; name: string; color: string },
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

export async function fetchLeaderboard(limit = 50, mode?: 'solo'): Promise<LeaderboardRow[]> {
  const params = mode ? `&mode=${mode}` : '';
  const res = await fetch(`${httpBase()}/leaderboard?limit=${limit}${params}`);
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
    body: JSON.stringify({ id, playerId }),
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
  const res = await fetch(`${httpBase()}/profile-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...patch }),
  });
  if (!res.ok) throw new Error(`profil: ${res.status}`);
}
