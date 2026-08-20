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
 * Reads `?session=` from the URL, or mints a fresh code and writes it back
 * (via replaceState, no reload/navigation) so the address bar becomes the
 * shareable invite link and a page refresh resumes the same game.
 */
export function getOrCreateSessionCode(): string {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get('session');
  if (existing) return existing;

  const fresh = generateSessionCode();
  url.searchParams.set('session', fresh);
  window.history.replaceState({}, '', url.toString());
  return fresh;
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
