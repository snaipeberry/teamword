import { useGameState, useRound } from '../state/GameState';
import { aggregateTeams, TEAM_COLORS } from '../lib/teams';

/**
 * Avancement des deux camps, en rails verticaux de part et d'autre de la
 * grille.
 *
 * Remplace la carte de scores qui coiffait la grille : elle disait la même
 * chose, mais en prenant une hauteur qui grandissait avec le nombre de
 * joueurs — au détriment de la seule chose qu'on regarde vraiment. Un rail de
 * quelques pixels tient dans la marge, se lit d'un coup d'œil périphérique
 * sans quitter la grille des yeux, et ne coûte aucune place verticale.
 *
 * Le score EST le nombre de mots trouvés (voir les intents `letter` et
 * `solveWord` côté serveur) : le remplissage se lit donc directement sur le
 * total de mots de la grille, sans donnée supplémentaire à demander.
 */
export interface Camp {
  /** Ce qui remplit le rail : 0 → 1. */
  part: number;
  /** Couleur du camp — celle du joueur, ou celle de l'équipe. */
  color: string;
  /** Pour les lecteurs d'écran, qui n'ont pas la couleur. */
  label: string;
  mots: number;
}

/**
 * Les deux camps à afficher : le sien à gauche, l'adversaire à droite.
 *
 * Renvoie `null` quand la question ne se pose pas — seul, en coopération, ou
 * tant qu'il n'y a personne en face. Un rail qui n'oppose rien à rien ne
 * serait qu'une barre de progression de la grille.
 */
export function useCamps(totalMots: number): { mien: Camp; adverse: Camp } | null {
  const game = useGameState();
  const { teams, ranked, format } = useRound();

  // La coop est le seul format où l'on partage un score : rien à opposer.
  // Le duel classé, lui, n'a pas de format renseigné (il ne passe par aucun
  // salon), d'où le `ranked` en plus.
  const versus = ranked || format !== 'coop';
  if (!versus) return null;

  const part = (mots: number) => (totalMots > 0 ? Math.min(1, mots / totalMots) : 0);

  // Par ÉQUIPE dès qu'il y en a, sinon par joueur : en 1v1 comme en équipes,
  // c'est le camp qui gagne, pas l'individu.
  const totaux = aggregateTeams(game.scoreboard, teams);
  if (totaux.length >= 2) {
    const monEquipe = teams[game.myPlayerId];
    const mien = totaux.find((t) => t.team === monEquipe) ?? totaux[0];
    // Le camp adverse le mieux placé : au-delà de deux équipes, c'est celui
    // qu'on a réellement à surveiller.
    const adverse = totaux.find((t) => t.team !== mien.team);
    if (!adverse) return null;
    return {
      mien: {
        part: part(mien.score),
        color: TEAM_COLORS[mien.team] ?? '#8FA073',
        label: `Équipe ${mien.team}`,
        mots: mien.score,
      },
      adverse: {
        part: part(adverse.score),
        color: TEAM_COLORS[adverse.team] ?? '#D67F48',
        label: `Équipe ${adverse.team}`,
        mots: adverse.score,
      },
    };
  }

  const moi = game.scoreboard.find((p) => p.isMe);
  // `scoreboard` est déjà trié par score décroissant : le premier qui n'est
  // pas moi est bien l'adversaire en tête.
  const autre = game.scoreboard.find((p) => !p.isMe);
  if (!moi || !autre) return null;
  return {
    mien: { part: part(moi.score), color: moi.color, label: 'Vous', mots: moi.score },
    adverse: { part: part(autre.score), color: autre.color, label: autre.name, mots: autre.score },
  };
}

/** Largeur d'un rail, gouttière comprise — la grille se mesure en déduisant
 *  cette réserve, pour ne pas perdre un pixel de case (voir CrosswordGrid). */
export const RAIL_TOTAL_PX = 12;

/**
 * Un rail. Volontairement étroit (4 px) et posé HORS de la grille, dans la
 * marge : la consigne était de ne pas empiéter d'un pixel sur les cases, qui
 * sont déjà ce qu'il y a de plus serré à l'écran.
 *
 * Sa hauteur vient d'un `align-items: stretch` sur la rangée, pas d'une
 * mesure : la carte de grille y est le seul élément à hauteur propre, les
 * rails s'y ajustent donc exactement, y compris à la toute première frame
 * où aucune mesure n'a encore eu lieu.
 */
export function ProgressRail({ camp }: { camp: Camp }) {
  const pourcent = Math.round(camp.part * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pourcent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${camp.label} · ${camp.mots} mot${camp.mots === 1 ? '' : 's'}`}
      // `justify-end` : le rail se remplit par le BAS, comme une éprouvette —
      // le sens qu'on prête spontanément à une jauge verticale.
      className="flex w-[4px] shrink-0 flex-col justify-end overflow-hidden rounded-full bg-organic-neutral-300"
    >
      {/* Transition CSS plutôt qu'animation JavaScript : la hauteur est juste
          dans le DOM à la seconde où l'état change, l'animation n'étant qu'un
          agrément par-dessus. Une animation pilotée en JS laisse au contraire
          le rail à zéro tant qu'aucune frame n'est composée. */}
      <span
        className="block w-full rounded-full transition-[height] duration-500 ease-out"
        style={{ backgroundColor: camp.color, height: `${pourcent}%` }}
      />
    </div>
  );
}
