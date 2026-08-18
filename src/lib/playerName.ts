const ADJECTIVES = ['Malin', 'Rapide', 'Curieux', 'Vif', 'Habile', 'Futé', 'Espiègle'];
const NOUNS = ['Renard', 'Hibou', 'Lynx', 'Faucon', 'Loup', 'Chat', 'Corbeau'];

const NAME_STORAGE_KEY = 'mf_player_name';
const ID_STORAGE_KEY = 'mf_player_id';

export function getOrCreatePlayerName(): string {
  const stored = localStorage.getItem(NAME_STORAGE_KEY);
  if (stored) return stored;
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 100);
  const name = `${adjective}${noun}${suffix}`;
  localStorage.setItem(NAME_STORAGE_KEY, name);
  return name;
}

/**
 * Stable per-browser identity, separate from the display name (which isn't
 * guaranteed unique). Scores are keyed by this so they survive reconnects —
 * Liveblocks' own connectionId changes on every reconnect and can't be used for that.
 */
export function getOrCreatePlayerId(): string {
  const stored = localStorage.getItem(ID_STORAGE_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(ID_STORAGE_KEY, id);
  return id;
}
