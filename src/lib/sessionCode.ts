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
