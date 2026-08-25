/**
 * Avatars prédéfinis — aucun envoi de photo.
 *
 * Un upload libre impose de modérer le contenu (nudité, violence, etc.) pour
 * passer la review des stores ; un jeu de préréglages élimine le risque à la
 * racine. Thème aligné sur les noms tirés au sort (playerName.ts NOUNS).
 */
export interface AvatarPreset {
  id: string;
  emoji: string;
  color: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'renard', emoji: '🦊', color: '#F5A623' },
  { id: 'hibou', emoji: '🦉', color: '#8E7CFF' },
  { id: 'loup', emoji: '🐺', color: '#6B7280' },
  { id: 'chat', emoji: '🐱', color: '#FF6B6B' },
  { id: 'faucon', emoji: '🦅', color: '#4DE8EF' },
  { id: 'pingouin', emoji: '🐧', color: '#3D5A80' },
  { id: 'tortue', emoji: '🐢', color: '#52B788' },
  { id: 'papillon', emoji: '🦋', color: '#C77DFF' },
  { id: 'dauphin', emoji: '🐬', color: '#48CAE4' },
  { id: 'lion', emoji: '🦁', color: '#E85D04' },
];

const BY_ID = new Map(AVATAR_PRESETS.map((p) => [p.id, p]));

export function avatarPresetFor(id: string): AvatarPreset | undefined {
  return BY_ID.get(id);
}
