import { useEffect, useRef } from 'react';
import type { Puzzle } from '../types/puzzle';
import { connectRoom, EMPTY_STATE, type RoomConnection, type RoomState } from '../lib/roomClient';
import { activePlayerId } from '../lib/auth';
import { wordCellIds } from '../lib/gridGeometry';

/**
 * Adversaire artificiel — sa propre connexion, sa propre identité.
 *
 * Il ne « réfléchit » pas : il choisit un mot encore non résolu et le remplit
 * d'un coup, à cadence irrégulière. C'est suffisant pour donner la sensation
 * d'une course, et cela ne demande aucun serveur.
 *
 * AVANT, le bot écrivait via `useGameState()` du joueur humain : ses mots se
 * comptaient donc dans VOTRE score, et il n'existait tout simplement pas en
 * tant que joueur — d'où l'impossibilité de voir ses points. Il ouvre
 * maintenant sa PROPRE connexion à la même salle, avec sa propre identité :
 * le tableau des scores (déjà générique sur `state.players`/`state.scores`)
 * l'affiche sans aucun changement ailleurs.
 *
 * Sa difficulté tient au DÉLAI entre deux mots, pas à une quelconque
 * intelligence : c'est le seul levier qui compte pour le ressenti.
 */
const DELAIS: Record<string, [number, number]> = {
  facile: [9000, 15000],
  normal: [5000, 9000],
  difficile: [2500, 5000],
};

const BOT_COULEUR = '#FF8A5B';

function motComplet(word: Puzzle['words'][number], lettres: Record<string, string>): boolean {
  return wordCellIds(word).every((id, i) => lettres[id] === word.answer[i]);
}

export function BotPlayer({
  puzzle,
  sessionId,
  level = 'normal',
}: {
  puzzle: Puzzle;
  sessionId: string;
  level?: keyof typeof DELAIS;
}) {
  // Ref plutôt qu'un state réactif : la minuterie lit l'état le plus récent
  // sans se relancer à chaque diffusion serveur.
  const stateRef = useRef<RoomState>(EMPTY_STATE);

  useEffect(() => {
    let arrete = false;
    let timer: ReturnType<typeof setTimeout>;

    // Identité dérivée de l'hôte + de la salle : stable pour la durée de
    // cette partie précise, jamais confondue avec un vrai joueur ni avec le
    // bot d'une autre salle.
    const botId = `bot-${sessionId}-${activePlayerId()}`;
    const conn: RoomConnection = connectRoom(
      sessionId,
      { id: botId, name: 'Bot 🤖', color: BOT_COULEUR },
      {
        onState: (s) => {
          stateRef.current = s;
        },
        onPresence: () => {},
        onBroadcast: () => {},
      },
    );

    const jouer = () => {
      const [min, max] = DELAIS[level];
      timer = setTimeout(() => {
        if (arrete) return;
        const lettres = { ...stateRef.current.letters };
        const restants = puzzle.words.filter((w) => !motComplet(w, lettres));
        if (restants.length > 0) {
          const cible = restants[Math.floor(Math.random() * restants.length)];
          wordCellIds(cible).forEach((id, i) => {
            const lettre = cible.answer[i];
            // Mots affectés par CETTE case précise (le mot cible, et tout
            // mot croisé qui la partage) — même calcul que côté joueur
            // humain (voir setLetter dans state/GameState.tsx), pour que le
            // bot marque exactement comme marquerait un humain.
            const affectes = puzzle.words.filter((w) => wordCellIds(w).includes(id));
            const avant = new Map(affectes.map((w) => [w.id, motComplet(w, lettres)]));
            lettres[id] = lettre;
            const scored = affectes.filter((w) => !avant.get(w.id) && motComplet(w, lettres)).length;
            conn.send({ t: 'letter', cellId: id, letter: lettre, scored });
          });
        }
        jouer();
      }, min + Math.random() * (max - min));
    };

    jouer();
    return () => {
      arrete = true;
      clearTimeout(timer);
      conn.close();
    };
  }, [puzzle, sessionId, level]);

  return null;
}
