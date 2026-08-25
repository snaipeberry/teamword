/**
 * Répartition facile/moyen/difficile des indices affichés dans une grille.
 *
 * Le service de remplissage (Python, `api/puzzle.py` / `serve_puzzles.py`)
 * est sans état : il ne connaît ni le palier solo du joueur ni le grade
 * choisi par l'hôte d'une partie. C'est donc ICI, côté client, que la
 * répartition est décidée — le serveur ne fait qu'appliquer les poids reçus
 * (sauf pour la grille du jour, qu'il fixe lui-même : elle doit être
 * identique pour tout le monde, aucun client ne doit pouvoir la faire varier).
 */
export interface HintDistribution {
  facile: number;
  moyen: number;
  difficile: number;
}

// Miroir de SOLO_TIERS (server/index.js) — seuls les seuils comptent ici,
// pour retrouver l'INDEX du palier courant à partir de `soloPoints`. Un
// changement des paliers côté serveur doit être répercuté ici.
const SOLO_TIER_MINS = [0, 4_200, 12_600, 30_000, 70_000, 150_000, 300_000, 600_000, 1_200_000];

function soloTierIndex(soloPoints: number): number {
  let i = 0;
  for (let n = 0; n < SOLO_TIER_MINS.length; n++) {
    if (soloPoints >= SOLO_TIER_MINS[n]) i = n;
  }
  return i;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Répartition à une progression `t` ∈ [0, 1] sur l'échelle de difficulté
 * commune : 0 = tout début (80 % facile / 20 % moyen), 1 = palier maximum
 * (2 % facile / 8 % moyen / 90 % difficile). Partagée entre le solo (t tiré
 * du palier) et le multijoueur (t tiré du grade choisi par l'hôte), pour que
 * les deux progressent sur la même échelle plutôt que deux barèmes distincts.
 */
function distributionAt(t: number): HintDistribution {
  return {
    facile: lerp(0.8, 0.02, t),
    moyen: lerp(0.2, 0.08, t),
    difficile: lerp(0, 0.9, t),
  };
}

/** Solo : la répartition tend vers plus difficile à chaque palier franchi. */
export function soloDistribution(soloPoints: number): HintDistribution {
  const lastIndex = SOLO_TIER_MINS.length - 1;
  const t = lastIndex > 0 ? soloTierIndex(soloPoints) / lastIndex : 1;
  return distributionAt(t);
}

/** Grille du jour : fixe, quel que soit le joueur (le serveur l'impose de
 *  toute façon — envoyée ici surtout pour que l'intention soit lisible). */
export const DAILY_DISTRIBUTION: HintDistribution = { facile: 0.05, moyen: 0.15, difficile: 0.8 };

export type MultiplayerGrade = 'facile' | 'moyen' | 'difficile';

export const MULTIPLAYER_GRADES: MultiplayerGrade[] = ['facile', 'moyen', 'difficile'];

/** Multijoueur : grade choisi par l'hôte, sur la même échelle que le solo. */
export function multiplayerDistribution(grade: MultiplayerGrade): HintDistribution {
  const t = grade === 'facile' ? 0 : grade === 'difficile' ? 1 : 0.5;
  return distributionAt(t);
}
