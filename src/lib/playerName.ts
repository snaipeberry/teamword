const ADJECTIVES = ['Malin', 'Rapide', 'Curieux', 'Vif', 'Habile', 'Futé', 'Espiègle'];
const NOUNS = ['Renard', 'Hibou', 'Lynx', 'Faucon', 'Loup', 'Chat', 'Corbeau'];

const NAME_STORAGE_KEY = 'mf_player_name';

/**
 * Nom tiré au sort, préfixé « Guest » — un invité doit être identifiable
 * comme tel au premier coup d'œil (scoreboard, salon...), sans avoir à
 * consulter son statut ailleurs. Fixe pour la durée d'un chargement de page :
 * aucune UI ne permet plus de le changer (voir lib/auth.ts).
 */
export function generateRandomName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 100);
  return `Guest${adjective}${noun}${suffix}`;
}

export function getOrCreatePlayerName(): string {
  const stored = localStorage.getItem(NAME_STORAGE_KEY);
  if (stored) return stored;
  const name = generateRandomName();
  localStorage.setItem(NAME_STORAGE_KEY, name);
  return name;
}
