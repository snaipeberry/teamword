import type { PlayerScore } from '../state/GameState';

export interface TeamTotal {
  team: string;
  score: number;
  hints: number;
  members: PlayerScore[];
}

/** Couleurs des camps, réutilisées partout pour rester lisible d'un écran à
 *  l'autre — organic.accent2.500 / organic.accent.500 (tailwind.config.js),
 *  même répartition sauge/terre cuite que Lobby.tsx (`styleEquipe`) pour
 *  l'équipe A/B, plutôt qu'un cyan/rouge criards issus de l'ancien thème
 *  "Aurora". */
export const TEAM_COLORS: Record<string, string> = { A: '#8FA073', B: '#D67F48' };

/**
 * Regroupe les scores par camp.
 *
 * Les points restent attribués INDIVIDUELLEMENT côté serveur — c'est
 * l'affichage et la victoire qui s'agrègent. Cela garde l'attribution simple
 * et permet de voir qui a porté son équipe.
 *
 * Renvoie une liste vide quand personne n'a choisi de camp : la partie est
 * alors coopérative, et il n'y a rien à agréger.
 */
export function aggregateTeams(
  scoreboard: PlayerScore[],
  teams: Record<string, string>,
): TeamTotal[] {
  const noms = [...new Set(Object.values(teams))].sort();
  if (noms.length === 0) return [];

  return noms
    .map((team) => {
      const members = scoreboard.filter((p) => teams[p.playerId] === team);
      return {
        team,
        score: members.reduce((n, p) => n + p.score, 0),
        hints: members.reduce((n, p) => n + p.hints, 0),
        members,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Camp gagnant, ou `null` en cas d'égalité — qu'on ne départage pas arbitrairement. */
export function winningTeam(totals: TeamTotal[]): string | null {
  if (totals.length < 2) return null;
  return totals[0].score > totals[1].score ? totals[0].team : null;
}
