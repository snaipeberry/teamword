const ADJECTIVES = ['Malin', 'Rapide', 'Curieux', 'Vif', 'Habile', 'Futé', 'Espiègle'];
const NOUNS = ['Renard', 'Hibou', 'Lynx', 'Faucon', 'Loup', 'Chat', 'Corbeau'];

const NAME_STORAGE_KEY = 'mf_player_name';

/** Nom tiré au sort — pas de stockage ici : `getOrCreatePlayerName` (compte)
 * et l'identité invité (voir auth.ts) l'utilisent chacun à leur façon. */
export function generateRandomName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 100);
  return `${adjective}${noun}${suffix}`;
}

export function getOrCreatePlayerName(): string {
  const stored = localStorage.getItem(NAME_STORAGE_KEY);
  if (stored) return stored;
  const name = generateRandomName();
  localStorage.setItem(NAME_STORAGE_KEY, name);
  return name;
}

/** Enregistre le nom choisi par le joueur, en remplacement du nom tiré au sort. */
export function setPlayerName(name: string): string {
  const clean = name.trim().slice(0, 16);
  if (!clean) return getOrCreatePlayerName();
  localStorage.setItem(NAME_STORAGE_KEY, clean);
  return clean;
}
