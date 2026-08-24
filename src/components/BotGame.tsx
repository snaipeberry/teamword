import { useEffect, useRef } from 'react';
import type { Puzzle } from '../types/puzzle';
import { useGameState } from '../state/GameState';
import { wordCellIds } from '../lib/gridGeometry';

/**
 * Adversaire artificiel — entièrement côté client.
 *
 * Il ne « réfléchit » pas : il choisit un mot encore non résolu et le remplit
 * d'un coup, à cadence irrégulière. C'est suffisant pour donner la sensation
 * d'une course, et cela ne demande aucun serveur.
 *
 * Sa difficulté tient au DÉLAI entre deux mots, pas à une quelconque
 * intelligence : c'est le seul levier qui compte pour le ressenti.
 */
const DELAIS: Record<string, [number, number]> = {
  facile: [9000, 15000],
  normal: [5000, 9000],
  difficile: [2500, 5000],
};

export function BotPlayer({
  puzzle,
  level = 'normal',
  onScore,
}: {
  puzzle: Puzzle;
  level?: keyof typeof DELAIS;
  onScore: () => void;
}) {
  const game = useGameState();
  // Une ref plutôt qu'une dépendance d'effet : sinon chaque lettre écrite
  // relancerait la minuterie, et le bot n'arriverait jamais au bout.
  const gameRef = useRef(game);
  gameRef.current = game;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const jouer = () => {
      const [min, max] = DELAIS[level];
      timer = setTimeout(() => {
        const g = gameRef.current;
        const restants = puzzle.words.filter((w) => {
          const ids = wordCellIds(w);
          return !ids.every((id, i) => g.getLetter(id) === w.answer[i]);
        });
        if (restants.length > 0) {
          const cible = restants[Math.floor(Math.random() * restants.length)];
          wordCellIds(cible).forEach((id, i) => g.setLetter(id, cible.answer[i]));
          onScore();
        }
        jouer();
      }, min + Math.random() * (max - min));
    };

    jouer();
    return () => clearTimeout(timer);
  }, [puzzle, level, onScore]);

  return null;
}
