/**
 * Comptes joueur.
 *
 * Avant les comptes, l'identité tenait à un identifiant tiré au sort et gardé
 * dans le navigateur : la progression ne suivait donc pas d'un appareil à
 * l'autre et disparaissait avec les données du site. Un compte rattache cette
 * progression à un pseudo et un mot de passe.
 *
 * Le jeu reste JOUABLE SANS COMPTE — se connecter n'est jamais obligatoire,
 * et l'inscription reprend la progression déjà accumulée.
 */
import { getOrCreatePlayerId } from './playerName';

const TOKEN_KEY = 'mf_auth_token';
const ACCOUNT_KEY = 'mf_account_id';
const USERNAME_KEY = 'mf_account_name';

export interface Session {
  id: string;
  username: string;
  token: string;
}

function base(): string {
  const configured = import.meta.env.VITE_REALTIME_URL?.trim();
  if (configured) return configured.replace(/^ws/, 'http').replace(/\/$/, '');
  return '/rt';
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) return { error: 'Trop de tentatives, réessayez plus tard' };
  return (await res.json()) as Record<string, unknown>;
}

function store(session: Session): Session {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(ACCOUNT_KEY, session.id);
  localStorage.setItem(USERNAME_KEY, session.username);
  return session;
}

export function currentSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const id = localStorage.getItem(ACCOUNT_KEY);
  const username = localStorage.getItem(USERNAME_KEY);
  return token && id && username ? { token, id, username } : null;
}

/**
 * Identifiant utilisé par le jeu : celui du compte s'il y en a un, sinon
 * l'identifiant local. Tout le reste (profil, scores, classement) s'y réfère,
 * donc se connecter fait bien suivre la progression.
 */
export function activePlayerId(): string {
  return localStorage.getItem(ACCOUNT_KEY) ?? getOrCreatePlayerId();
}

export async function register(username: string, password: string): Promise<Session | string> {
  // `migrateFrom` transmet l'identifiant local pour reprendre la progression
  // déjà jouée. Le serveur ne l'accepte qu'une fois.
  const data = await post('/register', {
    username,
    password,
    migrateFrom: getOrCreatePlayerId(),
  });
  if (typeof data.error === 'string') return data.error;
  return store(data as unknown as Session);
}

export async function login(username: string, password: string): Promise<Session | string> {
  const data = await post('/login', { username, password });
  if (typeof data.error === 'string') return data.error;
  return store(data as unknown as Session);
}

export async function logout(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) await post('/logout', { token }).catch(() => undefined);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(USERNAME_KEY);
}

/** Vérifie que la session est toujours valable ; la purge sinon. */
export async function refreshSession(): Promise<Session | null> {
  const session = currentSession();
  if (!session) return null;
  try {
    const res = await fetch(`${base()}/session?token=${encodeURIComponent(session.token)}`);
    const data = await res.json();
    if (!data.valid) {
      await logout();
      return null;
    }
    return session;
  } catch {
    // Serveur injoignable : on garde la session plutôt que de déconnecter
    // quelqu'un pour une simple coupure réseau.
    return session;
  }
}
