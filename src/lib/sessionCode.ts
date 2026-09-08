// Excludes visually ambiguous characters (0/O, 1/I/L) since players read/type this aloud.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateSessionCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/**
 * Code de partie présent dans l'URL, ou `null`.
 *
 * On n'en crée plus automatiquement : sans code, l'app doit montrer l'accueil
 * pour que le joueur choisisse entre créer et rejoindre.
 */
export function readSessionCode(): string | null {
  return new URL(window.location.href).searchParams.get('session');
}

/**
 * Domaine public du jeu. Les déploiements de PREVIEW Vercel
 * (`teamword-<hash>-<compte>.vercel.app`) sont protégés par authentification :
 * partager leur URL obligerait l'invité à se connecter à Vercel. On force
 * donc le domaine de production dans le lien d'invitation.
 */
const CANONICAL_APP_URL = (
  import.meta.env.VITE_PUBLIC_APP_URL?.trim() || 'https://teamword-snowy.vercel.app'
).replace(/\/$/, '');

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local') ||
    // adresse IP du réseau local, pour tester depuis un téléphone
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Lien à partager pour rejoindre la partie.
 *
 * En local on conserve l'origine courante — sinon impossible de tester à deux
 * onglets, ou depuis un téléphone sur le même Wi-Fi. Partout ailleurs on
 * bascule sur le domaine canonique.
 */
export function buildInviteUrl(sessionId: string): string {
  const base = isLocalHost(window.location.hostname)
    ? window.location.origin
    : CANONICAL_APP_URL;
  return `${base}/?session=${encodeURIComponent(sessionId)}`;
}

/**
 * Quitte la partie en cours pour une session neuve.
 *
 * Un rechargement complet est volontaire : le code de session détermine la
 * room Liveblocks, or celle-ci est fixée au montage du provider. Se contenter
 * de réécrire l'URL laisserait l'app connectée à l'ancienne room.
 */
export function startNewSession(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('session', generateSessionCode());
  window.location.href = url.toString();
}

/**
 * Retour à l'accueil depuis n'importe quel écran de partie (salon, grille,
 * menu). Efface TOUS les paramètres qui déterminent le mode en cours — pas
 * seulement `session` — sinon revenir depuis une grille du jour ou un solo
 * renverrait tout droit dans la même partie plutôt qu'à l'accueil.
 */
export function goHome(): void {
  const url = new URL(window.location.href);
  for (const param of ['session', 'daily', 'bot', 'solo']) url.searchParams.delete(param);
  window.location.href = url.toString();
}

const RETURN_SCREEN_KEY = 'mf_return_screen';

/**
 * Mémorise, juste avant de quitter l'accueil pour une partie (rechargement
 * complet obligé, voir `Home.go`), l'écran local d'où l'on partait — pour que
 * « retour » depuis le salon/la grille y ramène, plutôt que de toujours
 * retomber sur l'accueil pur comme si on n'était jamais passé par
 * « Multijoueur ». Portée session (comme le choix invité) : un nouvel onglet
 * ou un lien direct ne doit rien restaurer.
 */
export function rememberReturnScreen(screen: string): void {
  sessionStorage.setItem(RETURN_SCREEN_KEY, screen);
}

/**
 * Lit puis efface l'écran mémorisé — consommé une seule fois, au montage de
 * l'accueil, pour qu'une visite ultérieure normale (nouvelle session, lien
 * direct) reparte bien de zéro plutôt que de rejouer un retour périmé.
 */
export function consumeReturnScreen(): string | null {
  const v = sessionStorage.getItem(RETURN_SCREEN_KEY);
  sessionStorage.removeItem(RETURN_SCREEN_KEY);
  return v;
}
