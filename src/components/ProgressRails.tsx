import { useEffect, useRef, useState } from 'react';
import { useGameState, useRound } from '../state/GameState';
import { aggregateTeams, TEAM_COLORS } from '../lib/teams';
import { playLeadChangeSound } from '../lib/sounds';

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
  /** Incrémenté à chaque mot gagné par ce camp : le rail s'en sert pour
   *  pulser une fois. Un simple booléen ne redéclencherait pas l'animation
   *  sur deux mots consécutifs. */
  pulse: number;
  /** Le rail vient de changer de tête, dans un sens ou dans l'autre. */
  bascule: boolean;
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

  // Suivi des deux scores d'un rendu à l'autre. Des refs et non des états :
  // ce sont des repères de comparaison, pas quelque chose qui s'affiche.
  const precedent = useRef<{ mien: number; adverse: number } | null>(null);
  const enTete = useRef<boolean | null>(null);
  const [pulses, setPulses] = useState({ mien: 0, adverse: 0 });
  const [bascule, setBascule] = useState(false);

  // La coop est le seul format où l'on partage un score : rien à opposer.
  // Le duel classé, lui, n'a pas de format renseigné (il ne passe par aucun
  // salon), d'où le `ranked` en plus.
  const versus = ranked || format !== 'coop';

  const brut = versus ? scoresDe(game, teams) : null;
  const actif = brut !== null;
  const scoreMien = brut?.mien.score ?? 0;
  const scoreAdverse = brut?.adverse.score ?? 0;

  useEffect(() => {
    if (!actif) return;
    const avant = precedent.current;
    precedent.current = { mien: scoreMien, adverse: scoreAdverse };
    if (!avant) {
      // Premier passage : on prend la photo sans rien déclencher, sinon
      // rejoindre une partie en cours sonnerait comme une remontée.
      enTete.current = scoreMien > scoreAdverse ? true : scoreAdverse > scoreMien ? false : null;
      return;
    }

    if (scoreMien > avant.mien) setPulses((p) => ({ ...p, mien: p.mien + 1 }));
    if (scoreAdverse > avant.adverse) setPulses((p) => ({ ...p, adverse: p.adverse + 1 }));

    // Changement de tête : la seule information que le score ne donne pas au
    // moment où elle compte. Une égalité n'est pas une bascule — on ne
    // signale que le passage effectif devant ou derrière.
    const tete = scoreMien > scoreAdverse ? true : scoreAdverse > scoreMien ? false : null;
    if (tete !== null && enTete.current !== null && tete !== enTete.current) {
      playLeadChangeSound(tete);
      setBascule(true);
      setTimeout(() => setBascule(false), 700);
    }
    if (tete !== null) enTete.current = tete;
  }, [actif, scoreMien, scoreAdverse]);

  if (!brut) return null;

  const part = (mots: number) => (totalMots > 0 ? Math.min(1, mots / totalMots) : 0);
  return {
    mien: { ...brut.mien, part: part(brut.mien.score), mots: brut.mien.score, pulse: pulses.mien, bascule },
    adverse: {
      ...brut.adverse,
      part: part(brut.adverse.score),
      mots: brut.adverse.score,
      pulse: pulses.adverse,
      bascule,
    },
  };
}

/** Les deux camps bruts — le sien d'abord — sans rien de ce qui relève de
 *  l'animation. Séparé pour que `useCamps` reste lisible et que ses hooks
 *  soient tous appelés sans condition. */
function scoresDe(
  game: ReturnType<typeof useGameState>,
  teams: Record<string, string>,
): { mien: { score: number; color: string; label: string }; adverse: { score: number; color: string; label: string } } | null {

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
      mien: { score: mien.score, color: TEAM_COLORS[mien.team] ?? '#8FA073', label: `Équipe ${mien.team}` },
      adverse: {
        score: adverse.score,
        color: TEAM_COLORS[adverse.team] ?? '#D67F48',
        label: `Équipe ${adverse.team}`,
      },
    };
  }

  const moi = game.scoreboard.find((p) => p.isMe);
  // `scoreboard` est déjà trié par score décroissant : le premier qui n'est
  // pas moi est bien l'adversaire en tête.
  const autre = game.scoreboard.find((p) => !p.isMe);
  if (!moi || !autre) return null;
  return {
    mien: { score: moi.score, color: moi.color, label: 'Vous' },
    adverse: { score: autre.score, color: autre.color, label: autre.name },
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

  // Un mot vient de tomber dans ce camp : le rail s'élargit brièvement. Piloté
  // par un compteur et non un booléen, sinon deux mots d'affilée ne
  // relanceraient pas l'animation.
  const [pulse, setPulse] = useState(false);
  const dernierPulse = useRef(camp.pulse);
  useEffect(() => {
    if (camp.pulse === dernierPulse.current) return;
    dernierPulse.current = camp.pulse;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 420);
    return () => clearTimeout(t);
  }, [camp.pulse]);

  const plein = pourcent >= 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={pourcent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${camp.label} · ${camp.mots} mot${camp.mots === 1 ? '' : 's'}`}
      // `justify-end` : le rail se remplit par le BAS, comme une éprouvette —
      // le sens qu'on prête spontanément à une jauge verticale.
      // L'élargissement se fait en `scaleX` et non en largeur : la grille est
      // mesurée à partir de la place que prend le rail, la faire varier la
      // ferait respirer elle aussi.
      className={`flex w-[4px] shrink-0 flex-col justify-end overflow-hidden rounded-full bg-organic-neutral-300 transition-transform duration-200 ${
        pulse || camp.bascule ? 'scale-x-[2.2]' : 'scale-x-100'
      }`}
    >
      {/* Transition CSS plutôt qu'animation JavaScript : la hauteur est juste
          dans le DOM à la seconde où l'état change, l'animation n'étant qu'un
          agrément par-dessus. Une animation pilotée en JS laisse au contraire
          le rail à zéro tant qu'aucune frame n'est composée. */}
      <span
        className={`block w-full rounded-full transition-[height,filter] duration-500 ease-out ${
          camp.bascule ? 'brightness-125' : plein ? 'brightness-110' : ''
        }`}
        style={{ backgroundColor: camp.color, height: `${pourcent}%` }}
      />
    </div>
  );
}
