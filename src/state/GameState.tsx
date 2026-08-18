import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LiveMap } from '@liveblocks/client';
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
  useStorage,
  useMutation,
  useMyPresence,
  useOthers,
} from '@liveblocks/react/suspense';
import { getOrCreatePlayerId, getOrCreatePlayerName } from '../lib/playerName';
import { wordCellIds } from '../lib/gridGeometry';
import type { Puzzle, WordEntry } from '../types/puzzle';

export const hasLiveblocksKey = Boolean(import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY);

export interface PlayerCursor {
  connectionId: number;
  name: string;
  color: string;
  activeCell: string | null;
}

export interface PlayerScore {
  playerId: string;
  name: string;
  color: string;
  score: number;
  online: boolean;
  isMe: boolean;
}

export interface GameStateApi {
  /** false when no Liveblocks key is configured — grid still fully playable, just single-player/local. */
  multiplayer: boolean;
  getLetter: (cellId: string) => string;
  setLetter: (cellId: string, letter: string) => void;
  others: PlayerCursor[];
  myColor: string;
  myPlayerId: string;
  setMyActiveCell: (cellId: string | null) => void;
  /** Ranked by words found, descending. Empty outside multiplayer. */
  scoreboard: PlayerScore[];
}

const GameStateContext = createContext<GameStateApi | null>(null);

export function useGameState(): GameStateApi {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error('useGameState must be used within a GameStateProvider');
  return ctx;
}

const PLAYER_COLORS = ['#F5A623', '#4ECDC4', '#FF6B6B', '#8E7CFF', '#2ECC71'];

function randomColor(): string {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

function LocalGameProvider({ children }: { children: React.ReactNode }) {
  const [letters, setLetters] = useState<Record<string, string>>({});
  const myColor = useMemo(randomColor, []);

  const api = useMemo<GameStateApi>(
    () => ({
      multiplayer: false,
      getLetter: (cellId) => letters[cellId] ?? '',
      setLetter: (cellId, letter) => setLetters((prev) => ({ ...prev, [cellId]: letter })),
      others: [],
      myColor,
      myPlayerId: 'local',
      setMyActiveCell: () => {},
      scoreboard: [],
    }),
    [letters, myColor],
  );

  return <GameStateContext.Provider value={api}>{children}</GameStateContext.Provider>;
}

/** cellId -> ids of the word(s) that cell belongs to, and wordId -> its ordered cellIds / definition. */
function usePuzzleIndex(puzzle: Puzzle) {
  return useMemo(() => {
    const wordsById = new Map<string, WordEntry>();
    const cellsByWordId = new Map<string, string[]>();
    const wordIdsByCellId = new Map<string, string[]>();

    puzzle.words.forEach((word) => {
      wordsById.set(word.id, word);
      const cells = wordCellIds(word);
      cellsByWordId.set(word.id, cells);
      cells.forEach((id) => {
        wordIdsByCellId.set(id, [...(wordIdsByCellId.get(id) ?? []), word.id]);
      });
    });

    return { wordsById, cellsByWordId, wordIdsByCellId };
  }, [puzzle.words]);
}

function LiveblocksGameBridge({
  puzzle,
  children,
}: {
  puzzle: Puzzle;
  children: React.ReactNode;
}) {
  const { wordsById, cellsByWordId, wordIdsByCellId } = usePuzzleIndex(puzzle);

  const letters = useStorage((root) => root.letters);
  const scores = useStorage((root) => root.scores);
  const players = useStorage((root) => root.players);
  const others = useOthers();
  const [myPresence, updateMyPresence] = useMyPresence();

  const setLetter = useMutation(
    ({ storage, self }, targetCellId: string, letter: string) => {
      const lettersMap = storage.get('letters');
      const previousLetter = lettersMap.get(targetCellId) ?? '';
      const affectedWordIds = wordIdsByCellId.get(targetCellId) ?? [];

      const isWordComplete = (wordId: string, overrideCellId: string, overrideLetter: string) => {
        const word = wordsById.get(wordId);
        const cells = cellsByWordId.get(wordId);
        if (!word || !cells) return false;
        return cells.every((id, i) => {
          const value = id === overrideCellId ? overrideLetter : (lettersMap.get(id) ?? '');
          return value === word.answer[i];
        });
      };

      const wasCompleteBefore = new Map(
        affectedWordIds.map((wordId) => [wordId, isWordComplete(wordId, targetCellId, previousLetter)]),
      );

      lettersMap.set(targetCellId, letter);

      const newlyCompleted = affectedWordIds.filter(
        (wordId) => !wasCompleteBefore.get(wordId) && isWordComplete(wordId, targetCellId, letter),
      );

      if (newlyCompleted.length > 0) {
        const playerId = self.presence.playerId;
        const scoresMap = storage.get('scores');
        scoresMap.set(playerId, (scoresMap.get(playerId) ?? 0) + newlyCompleted.length);
      }
    },
    [wordsById, cellsByWordId, wordIdsByCellId],
  );

  const registerPlayer = useMutation(({ storage, self }) => {
    storage.get('players').set(self.presence.playerId, {
      name: self.presence.name,
      color: self.presence.color,
    });
  }, []);

  useEffect(() => {
    registerPlayer();
    // Runs once per room join to publish this player's name/color into persistent storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scoreboard = useMemo<PlayerScore[]>(() => {
    const ids = new Set<string>();
    players.forEach((_, id) => ids.add(id));
    scores.forEach((_, id) => ids.add(id));
    ids.add(myPresence.playerId);
    others.forEach((o) => ids.add(o.presence.playerId));

    const onlineIds = new Set([myPresence.playerId, ...others.map((o) => o.presence.playerId)]);

    return [...ids]
      .map((id) => {
        const isMe = id === myPresence.playerId;
        const onlineOther = others.find((o) => o.presence.playerId === id);
        const stored = players.get(id);
        return {
          playerId: id,
          name: isMe ? myPresence.name : (onlineOther?.presence.name ?? stored?.name ?? 'Joueur'),
          color: isMe ? myPresence.color : (onlineOther?.presence.color ?? stored?.color ?? '#9CA3AF'),
          score: scores.get(id) ?? 0,
          online: onlineIds.has(id),
          isMe,
        };
      })
      .sort((a, b) => b.score - a.score || Number(b.isMe) - Number(a.isMe));
  }, [players, scores, others, myPresence]);

  const api = useMemo<GameStateApi>(
    () => ({
      multiplayer: true,
      getLetter: (cellId) => letters.get(cellId) ?? '',
      setLetter,
      others: others.map((o) => ({
        connectionId: o.connectionId,
        name: o.presence.name,
        color: o.presence.color,
        activeCell: o.presence.activeCell,
      })),
      myColor: myPresence.color,
      myPlayerId: myPresence.playerId,
      setMyActiveCell: (cellId) => updateMyPresence({ activeCell: cellId }),
      scoreboard,
    }),
    [letters, others, myPresence, setLetter, updateMyPresence, scoreboard],
  );

  return <GameStateContext.Provider value={api}>{children}</GameStateContext.Provider>;
}

function ConnectingFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-500">
      Connexion à la partie…
    </div>
  );
}

export function GameStateProvider({
  roomId,
  puzzle,
  children,
}: {
  roomId: string;
  puzzle: Puzzle;
  children: React.ReactNode;
}) {
  if (!hasLiveblocksKey) {
    return <LocalGameProvider>{children}</LocalGameProvider>;
  }

  const playerName = getOrCreatePlayerName();
  const playerId = getOrCreatePlayerId();

  return (
    <LiveblocksProvider publicApiKey={import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY as string}>
      <RoomProvider
        id={roomId}
        initialPresence={{ name: playerName, color: randomColor(), activeCell: null, playerId }}
        initialStorage={{ letters: new LiveMap(), scores: new LiveMap(), players: new LiveMap() }}
      >
        <ClientSideSuspense fallback={<ConnectingFallback />}>
          <LiveblocksGameBridge puzzle={puzzle}>{children}</LiveblocksGameBridge>
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}
