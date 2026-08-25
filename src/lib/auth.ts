/**
 * Comptes joueur — et identité invité.
 *
 * Un compte rattache la progression à un pseudo et un mot de passe, portable
 * d'un appareil à l'autre. L'invité est l'inverse délibéré : un identifiant
 * ET un nom générés une seule fois PAR CHARGEMENT DE PAGE (variables de
 * module, jamais écrites dans le navigateur) — recharger la page en génère
 * de nouveaux. C'est un choix explicite de l'utilisateur (« aucune
 * persistance »), pas un oubli : ne pas être tenté de les stocker « pour
 * plus tard », ça romprait la promesse faite à l'écran d'accueil.
 */
import { generateRandomName } from './playerName';

const TOKEN_KEY = 'mf_auth_token';
const ACCOUNT_KEY = 'mf_account_id';
const USERNAME_KEY = 'mf_account_name';

let guestId: string | null = null;
let guestName: string | null = null;

/** Préfixe reconnu par le serveur pour exclure les invités du classement. */
function ensureGuestId(): string {
  if (!guestId) guestId = `guest-${crypto.randomUUID()}`;
  return guestId;
}

function ensureGuestName(): string {
  if (!guestName) guestName = generateRandomName();
  return guestName;
}

/**
 * Le portail (LoginGate) doit s'afficher au premier chargement, mais PAS se
 * remettre en travers de chaque partie rejointe : rejoindre une salle
 * recharge la page en entier (voir Home.tsx `go()`), ce qui réexécuterait ce
 * module et redemanderait « connecté / invité » avant CHAQUE partie. On se
 * souvient donc du choix dans `sessionStorage` — portée l'onglet, effacée à
 * sa fermeture — ce qui est un choix de NAVIGATION, pas de persistance de
 * données : l'identité invité elle-même (ci-dessus) continue de se
 * régénérer à chaque rechargement, sans exception.
 */
const GATE_SKIP_KEY = 'mf_gate_skip';

export function shouldSkipGate(): boolean {
  return sessionStorage.getItem(GATE_SKIP_KEY) === '1';
}

export function skipGateForThisTab(): void {
  sessionStorage.setItem(GATE_SKIP_KEY, '1');
}

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
 * l'identifiant invité éphémère. Tout le reste (profil, scores, classement)
 * s'y réfère, donc se connecter fait bien suivre la progression — et rester
 * invité ne la fait jamais suivre nulle part.
 */
export function activePlayerId(): string {
  return localStorage.getItem(ACCOUNT_KEY) ?? ensureGuestId();
}

/**
 * Nom affiché : le pseudo du compte s'il y en a un, sinon le nom généré de
 * l'invité (préfixé « Guest », voir playerName.ts). Fixe dans les deux cas —
 * aucune UI ne permet plus de le changer.
 */
export function activePlayerName(): string {
  const session = currentSession();
  return session ? session.username : ensureGuestName();
}

export async function register(username: string, password: string): Promise<Session | string> {
  // `migrateFrom` transmet l'identité active pour reprendre la progression
  // déjà jouée dans CETTE visite — celle d'un invité qui décide de créer un
  // compte en cours de partie, typiquement. Le serveur ne l'accepte qu'une
  // fois. `activePlayerId()` renvoie ici forcément l'identifiant invité :
  // on n'appelle jamais `register` en étant déjà connecté.
  const data = await post('/register', {
    username,
    password,
    migrateFrom: activePlayerId(),
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

/**
 * Supprime le compte (pas seulement la session) : requis par les stores
 * (Apple 5.1.1v et équivalent Google) — un compte doit pouvoir être
 * supprimé DEPUIS l'app. Irréversible côté serveur.
 */
export async function deleteAccount(): Promise<true | string> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return 'Aucun compte connecté';
  const data = await post('/account-delete', { token }).catch(() => ({ error: 'Serveur injoignable' }));
  if (typeof data.error === 'string') return data.error;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(USERNAME_KEY);
  return true;
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
