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

export type MultiplayerGrade = 'facile' | 'moyen' | 'difficile';

export const MULTIPLAYER_GRADES: MultiplayerGrade[] = ['facile', 'moyen', 'difficile'];

/** Libellé affiché — partagé entre le sélecteur de salon et le bandeau de jeu. */
export const GRADE_LABELS: Record<MultiplayerGrade, string> = {
  facile: 'Facile',
  moyen: 'Moyen',
  difficile: 'Difficile',
};

/**
 * Répartition de chacun des trois grades nommés. Le solo (rotation, voir
 * plus bas) et le multijoueur (grade choisi par l'hôte, ou tiré par le
 * serveur en duel classé) retombent tous les deux sur un de ces trois
 * grades, donc sur le même barème plutôt que deux échelles distinctes.
 *
 * Les poids n'ont pas besoin de sommer à 1 : le générateur de grilles les
 * normalise lui-même (voir `pick_hint_level` côté Python) — seul le RAPPORT
 * entre eux compte.
 */
const GRADE_DISTRIBUTIONS: Record<MultiplayerGrade, HintDistribution> = {
  facile: { facile: 0.9, moyen: 0.1, difficile: 0 },
  // Reprend exactement l'ancien niveau facile.
  moyen: { facile: 0.8, moyen: 0.2, difficile: 0 },
  // Même répartition moyen/difficile que l'ancien niveau difficile — juste
  // sans indice facile du tout.
  difficile: { facile: 0, moyen: 0.08, difficile: 0.9 },
};

/** Multijoueur : grade choisi par l'hôte, sur la même échelle que le solo. */
export function multiplayerDistribution(grade: MultiplayerGrade): HintDistribution {
  return GRADE_DISTRIBUTIONS[grade];
}

// Rotation stricte du solo : facile -> moyen -> difficile -> facile -> ...
// Un cran par grille solo jouée. Remplace l'ancienne progression continue
// par palier de points (qui dérivait lentement vers le plus dur au fil de
// la partie) — ici les trois niveaux reviennent dans l'ordre, à intervalle
// régulier, quel que soit le score.
const SOLO_ROTATION: MultiplayerGrade[] = ['facile', 'moyen', 'difficile'];

/**
 * Index de rotation à partir du profil : `soloGrids` compte TOUTES les
 * grilles solo terminées, grille du jour incluse (voir `soloGridDone` côté
 * serveur) — or la grille du jour a sa propre difficulté fixe et ne doit
 * pas décaler la rotation des vraies grilles solo. On la retranche donc
 * (`dailies`, déjà suivi séparément) plutôt que d'ajouter un compteur dédié
 * côté serveur.
 */
function soloRotationIndex(soloGrids: number, dailies: number): number {
  const n = SOLO_ROTATION.length;
  return ((soloGrids - dailies) % n + n) % n;
}

/** Solo : niveau du moment dans la rotation. */
export function soloGrade(soloGrids: number, dailies: number): MultiplayerGrade {
  return SOLO_ROTATION[soloRotationIndex(soloGrids, dailies)];
}

/** Solo : répartition des indices pour le niveau courant de la rotation. */
export function soloDistribution(soloGrids: number, dailies: number): HintDistribution {
  return multiplayerDistribution(soloGrade(soloGrids, dailies));
}

/** Grille du jour : fixe, quel que soit le joueur (le serveur l'impose de
 *  toute façon — envoyée ici surtout pour que l'intention soit lisible). */
export const DAILY_DISTRIBUTION: HintDistribution = { facile: 0.05, moyen: 0.15, difficile: 0.8 };
