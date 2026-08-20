import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LiveMap } from '@liveblocks/client';
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
  useStorage,
  useMutation,
  useMyPresence,
  useOthers,
  useBroadcastEvent,
  useEventListener,
} from '@liveblocks/react/suspense';
import { getOrCreatePlayerId, getOrCreatePlayerName } from '../lib/playerName';
import { wordCellIds } from '../lib/gridGeometry';
import { playRadioClip, splitIntoChunks, startRecording, type Recording } from '../lib/voiceRadio';
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
  hints: number;
  online: boolean;
  isMe: boolean;
}

/** Réaction reçue d'un autre joueur, à afficher puis oublier. */
export interface LiveReaction {
  id: number;
  emoji: string;
  name: string;
  isMe: boolean;
}

export interface GameStateApi {
  /** false when no Liveblocks key is configured — grid still fully playable, just single-player/local. */
  multiplayer: boolean;
  getLetter: (cellId: string) => string;
  setLetter: (cellId: string, letter: string) => void;
  /** Écrit la bonne lettre sans jamais accorder de point (voir revealLetter). */
  revealLetter: (cellId: string, letter: string) => void;
  isRevealed: (cellId: string) => boolean;
  others: PlayerCursor[];
  myColor: string;
  myPlayerId: string;
  setMyActiveCell: (cellId: string | null) => void;
  /** Ranked by words found, descending. Empty outside multiplayer. */
  scoreboard: PlayerScore[];

  /** Se déclarer prêt pour passer à la grille suivante. */
  setReady: (round: number) => void;
  /** Vrai quand tous les joueurs EN LIGNE sont prêts pour cette grille. */
  allReadyFor: (round: number) => boolean;
  /** Ce joueur s'est-il déclaré prêt pour CETTE grille ? */
  isReadyFor: (playerId: string, round: number) => boolean;

  /** Diffuse une réaction aux autres joueurs (éphémère, jamais persistée). */
  sendReaction: (emoji: string) => void;

  /** Talkie-walkie : maintenir pour parler, relâcher pour envoyer. */
  startTalking: () => Promise<void>;
  stopTalking: () => void;
  /** Noms des joueurs en train de parler, pour l'affichage. */
  talkingNames: string[];
  /** Le micro a été refusé (ou est indisponible) : on le signale plutôt que d'échouer en silence. */
  micDenied: boolean;
  /** Réactions actuellement à l'écran. */
  reactions: LiveReaction[];
}

const GameStateContext = createContext<GameStateApi | null>(null);

export function useGameState(): GameStateApi {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error('useGameState must be used within a GameStateProvider');
  return ctx;
}

/**
 * Manche courante + passage à la suivante.
 *
 * Séparé de GameStateApi parce qu'il faut connaître la manche AVANT d'avoir
 * la grille : c'est elle qui détermine quelle grille charger.
 */
export interface RoundApi {
  round: number;
  /** `fromRound` évite de sauter plusieurs grilles quand tous les clients avancent en même temps. */
  advanceRound: (fromRound?: number) => void;
}

const RoundContext = createContext<RoundApi | null>(null);

export function useRound(): RoundApi {
  const ctx = useContext(RoundContext);
  if (!ctx) throw new Error('useRound must be used within a SessionProvider');
  return ctx;
}

const PLAYER_COLORS = ['#F5A623', '#4ECDC4', '#FF6B6B', '#8E7CFF', '#2ECC71'];

/** Durée d'affichage d'une réaction avant disparition. */
const REACTION_LIFETIME_MS = 2600;

function randomColor(): string {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

// ============================================================
// Mode local (aucune clé Liveblocks)
// ============================================================

const LocalLettersContext = createContext<{
  letters: Record<string, string>;
  setLetters: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  revealed: Record<string, boolean>;
  setRevealed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
} | null>(null);

function LocalSessionProvider({ children }: { children: React.ReactNode }) {
  const [round, setRound] = useState(0);
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const roundApi = useMemo<RoundApi>(
    () => ({
      round,
      advanceRound: () => {
        setRound((r) => r + 1);
        setLetters({});
        setRevealed({});
      },
    }),
    [round],
  );

  const lettersApi = useMemo(
    () => ({ letters, setLetters, revealed, setRevealed }),
    [letters, revealed],
  );

  return (
    <RoundContext.Provider value={roundApi}>
      <LocalLettersContext.Provider value={lettersApi}>{children}</LocalLettersContext.Provider>
    </RoundContext.Provider>
  );
}

function LocalGameProvider({ children }: { children: React.ReactNode }) {
  const store = useContext(LocalLettersContext);
  if (!store) throw new Error('LocalGameProvider must be used within a SessionProvider');
  const { letters, setLetters, revealed, setRevealed } = store;
  const myColor = useMemo(randomColor, []);

  // En solo il n'y a personne à attendre : « prêt » est immédiatement vrai,
  // et une réaction n'est qu'une petite animation pour soi-même.
  const [reactions, setReactions] = useState<LiveReaction[]>([]);
  const pushReaction = useCallback((emoji: string) => {
    const id = Date.now() + Math.random();
    setReactions((prev) => [...prev, { id, emoji, name: 'Vous', isMe: true }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), REACTION_LIFETIME_MS);
  }, []);

  const api = useMemo<GameStateApi>(
    () => ({
      multiplayer: false,
      getLetter: (cellId) => letters[cellId] ?? '',
      setLetter: (cellId, letter) => setLetters((prev) => ({ ...prev, [cellId]: letter })),
      revealLetter: (cellId, letter) => {
        setLetters((prev) => ({ ...prev, [cellId]: letter }));
        setRevealed((prev) => ({ ...prev, [cellId]: true }));
      },
      isRevealed: (cellId) => Boolean(revealed[cellId]),
      others: [],
      myColor,
      myPlayerId: 'local',
      setMyActiveCell: () => {},
      scoreboard: [],
      setReady: () => {},
      allReadyFor: () => true,
      isReadyFor: () => true,
      sendReaction: pushReaction,
      reactions,
      // En solo il n'y a personne à qui parler : le bouton est masqué côté UI.
      startTalking: async () => {},
      stopTalking: () => {},
      talkingNames: [],
      micDenied: false,
    }),
    [letters, revealed, setLetters, setRevealed, myColor, pushReaction, reactions],
  );

  return <GameStateContext.Provider value={api}>{children}</GameStateContext.Provider>;
}

// ============================================================
// Mode multijoueur
// ============================================================

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

function LiveblocksRoundProvider({ children }: { children: React.ReactNode }) {
  const round = useStorage((root) => root.round) ?? 0;

  // On repart d'une grille vierge : les lettres de la manche précédente
  // n'ont plus de sens sur la nouvelle. Les scores, eux, se cumulent.
  //
  // `fromRound` rend l'appel IDEMPOTENT : tous les clients détectent
  // « tout le monde est prêt » au même instant et appellent donc cette
  // mutation en même temps. Sans cette garde, on sauterait deux ou trois
  // grilles d'un coup.
  const advanceRound = useMutation(({ storage }, fromRound?: number) => {
    const current = storage.get('round') ?? 0;
    if (fromRound !== undefined && current !== fromRound) return;
    storage.set('round', current + 1);
    // LiveMap n'a pas de .clear() : on supprime clé par clé, en figeant
    // d'abord la liste pour ne pas muter la map pendant qu'on l'itère.
    const lettersMap = storage.get('letters');
    Array.from(lettersMap.keys()).forEach((key) => lettersMap.delete(key));
    const revealedMap = storage.get('revealed');
    Array.from(revealedMap.keys()).forEach((key) => revealedMap.delete(key));
  }, []);

  const api = useMemo<RoundApi>(() => ({ round, advanceRound }), [round, advanceRound]);
  return <RoundContext.Provider value={api}>{children}</RoundContext.Provider>;
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
  const hints = useStorage((root) => root.hints);
  const revealed = useStorage((root) => root.revealed);
  const ready = useStorage((root) => root.ready);
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

  // Volontairement SANS attribution de points : une lettre donnée par l'aide
  // ne doit pas pouvoir faire gagner le mot. Seul le compteur d'indices bouge,
  // pour que l'usage de l'aide reste visible des deux joueurs.
  const revealLetter = useMutation(({ storage, self }, targetCellId: string, letter: string) => {
    storage.get('letters').set(targetCellId, letter);
    storage.get('revealed').set(targetCellId, true);
    const playerId = self.presence.playerId;
    const hintsMap = storage.get('hints');
    hintsMap.set(playerId, (hintsMap.get(playerId) ?? 0) + 1);
  }, []);

  const setReady = useMutation(({ storage, self }, round: number) => {
    storage.get('ready').set(self.presence.playerId, round);
  }, []);

  const broadcast = useBroadcastEvent();
  const [reactions, setReactions] = useState<LiveReaction[]>([]);

  const pushReaction = useCallback((emoji: string, name: string, isMe: boolean) => {
    const id = Date.now() + Math.random();
    setReactions((prev) => [...prev, { id, emoji, name, isMe }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), REACTION_LIFETIME_MS);
  }, []);

  const sendReaction = useCallback(
    (emoji: string) => {
      // Affichage local immédiat : la diffusion ne se renvoie pas à
      // l'expéditeur, et attendre l'aller-retour rendrait le bouton mou.
      pushReaction(emoji, 'Vous', true);
      broadcast({
        type: 'reaction',
        emoji,
        playerId: myPresence.playerId,
        name: myPresence.name,
      });
    },
    [broadcast, pushReaction, myPresence.playerId, myPresence.name],
  );

  // ---------- Talkie-walkie ----------
  const recordingRef = useRef<Recording | null>(null);
  // Indexé par playerId : `voice-end` ne transporte que l'identifiant.
  const [talking, setTalking] = useState<Record<string, string>>({});
  const [micDenied, setMicDenied] = useState(false);
  const talkingNames = useMemo(() => Object.values(talking), [talking]);

  const startTalking = useCallback(async () => {
    if (recordingRef.current) return;
    try {
      recordingRef.current = await startRecording();
      setMicDenied(false);
      broadcast({ type: 'voice-start', playerId: myPresence.playerId, name: myPresence.name });
    } catch {
      // Micro refusé ou indisponible : on le signale à l'UI, on ne casse rien.
      recordingRef.current = null;
      setMicDenied(true);
    }
  }, [broadcast, myPresence.playerId, myPresence.name]);

  const stopTalking = useCallback(() => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    broadcast({ type: 'voice-end', playerId: myPresence.playerId });

    void rec.stop().then((clip) => {
      if (!clip) return;
      const chunks = splitIntoChunks(clip.base64);
      const clipId = `${myPresence.playerId}-${Date.now()}`;
      chunks.forEach((data, seq) =>
        broadcast({
          type: 'voice-chunk',
          playerId: myPresence.playerId,
          name: myPresence.name,
          clipId,
          seq,
          total: chunks.length,
          data,
        }),
      );
    });
  }, [broadcast, myPresence.playerId, myPresence.name]);

  // Réassemblage des messages reçus. Les morceaux d'un même clip peuvent
  // arriver dans le désordre : on les range par numéro et on ne joue qu'une
  // fois le compte complet atteint.
  const inboxRef = useRef(new Map<string, { parts: Map<number, string>; total: number }>());

  useEventListener(({ event }) => {
    if (event.type === 'reaction') {
      pushReaction(event.emoji, event.name, false);
      return;
    }
    if (event.type === 'voice-start') {
      setTalking((prev) => ({ ...prev, [event.playerId]: event.name }));
      return;
    }
    if (event.type === 'voice-end') {
      setTalking((prev) => {
        if (!(event.playerId in prev)) return prev;
        const next = { ...prev };
        delete next[event.playerId];
        return next;
      });
      return;
    }
    if (event.type === 'voice-chunk') {
      const inbox = inboxRef.current;
      const entry = inbox.get(event.clipId) ?? { parts: new Map<number, string>(), total: event.total };
      entry.parts.set(event.seq, event.data);
      inbox.set(event.clipId, entry);
      if (entry.parts.size === entry.total) {
        inbox.delete(event.clipId);
        setTalking((prev) => {
          if (!(event.playerId in prev)) return prev;
          const next = { ...prev };
          delete next[event.playerId];
          return next;
        });
        const ordered = Array.from({ length: entry.total }, (_, i) => entry.parts.get(i) ?? '').join('');
        void playRadioClip(ordered);
      }
    }
  });



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
          hints: hints.get(id) ?? 0,
          online: onlineIds.has(id),
          isMe,
        };
      })
      .sort((a, b) => b.score - a.score || Number(b.isMe) - Number(a.isMe));
  }, [players, scores, hints, others, myPresence]);

  /**
   * On n'attend que les joueurs EN LIGNE : sinon un joueur parti en cours de
   * partie bloquerait définitivement la progression des autres.
   */
  const allReadyFor = useCallback(
    (round: number) => {
      const onlineIds = [myPresence.playerId, ...others.map((o) => o.presence.playerId)];
      return onlineIds.every((id) => ready.get(id) === round);
    },
    [ready, others, myPresence.playerId],
  );

  /**
   * Le drapeau « prêt » ne peut pas vivre dans PlayerScore : il n'a de sens
   * que rapporté à une grille précise, que le tableau des scores ignore.
   */
  const isReadyFor = useCallback(
    (playerId: string, round: number) => ready.get(playerId) === round,
    [ready],
  );

  const api = useMemo<GameStateApi>(
    () => ({
      multiplayer: true,
      getLetter: (cellId) => letters.get(cellId) ?? '',
      setLetter,
      revealLetter,
      isRevealed: (cellId) => revealed.get(cellId) === true,
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
      setReady,
      allReadyFor,
      isReadyFor,
      sendReaction,
      reactions,
      startTalking,
      stopTalking,
      talkingNames,
      micDenied,
    }),
    [
      letters, revealed, others, myPresence, setLetter, revealLetter, updateMyPresence,
      scoreboard, setReady, allReadyFor, isReadyFor, sendReaction, reactions,
      startTalking, stopTalking, talkingNames, micDenied,
    ],
  );

  return <GameStateContext.Provider value={api}>{children}</GameStateContext.Provider>;
}

function ConnectingFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-white/70">
      Connexion à la partie…
    </div>
  );
}

// ============================================================
// Providers exportés
// ============================================================

/**
 * Ouvre la session (room Liveblocks ou état local). L'identifiant de room ne
 * dépend QUE de la session, pas de la manche : il faut déjà être connecté
 * pour savoir quelle manche est en cours.
 */
export function SessionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  if (!hasLiveblocksKey) {
    return <LocalSessionProvider>{children}</LocalSessionProvider>;
  }

  const playerName = getOrCreatePlayerName();
  const playerId = getOrCreatePlayerId();

  return (
    <LiveblocksProvider publicApiKey={import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY as string}>
      <RoomProvider
        id={`mots-fleches-${sessionId}`}
        initialPresence={{ name: playerName, color: randomColor(), activeCell: null, playerId }}
        initialStorage={{
          round: 0,
          letters: new LiveMap(),
          scores: new LiveMap(),
          hints: new LiveMap(),
          revealed: new LiveMap(),
          ready: new LiveMap(),
          players: new LiveMap(),
        }}
      >
        <ClientSideSuspense fallback={<ConnectingFallback />}>
          <LiveblocksRoundProvider>{children}</LiveblocksRoundProvider>
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

/** À placer sous SessionProvider, une fois la grille de la manche chargée. */
export function GameStateProvider({
  puzzle,
  children,
}: {
  puzzle: Puzzle;
  children: React.ReactNode;
}) {
  if (!hasLiveblocksKey) {
    return <LocalGameProvider>{children}</LocalGameProvider>;
  }
  return <LiveblocksGameBridge puzzle={puzzle}>{children}</LiveblocksGameBridge>;
}

/** Petit hook utilitaire pour vider la grille locale/partagée en fin de manche. */
export function useAdvanceRound(): () => void {
  const { advanceRound } = useRound();
  return useCallback(() => advanceRound(), [advanceRound]);
}
