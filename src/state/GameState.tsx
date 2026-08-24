import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  connectRoom,
  EMPTY_STATE,
  type RoomConnection,
  type RoomPeer,
  type RoomState,
} from '../lib/roomClient';
import { getOrCreatePlayerName, setPlayerName } from '../lib/playerName';
import { activePlayerId } from '../lib/auth';
import { wordCellIds } from '../lib/gridGeometry';
import { playRadioClip, splitIntoChunks, startRecording, type Recording } from '../lib/voiceRadio';
import type { Puzzle, WordEntry } from '../types/puzzle';

/**
 * Le multijoueur passe par notre propre serveur WebSocket (server/index.js),
 * plus par Liveblocks : facturé au joueur actif, son coût croissait avec le
 * succès. Il n'y a donc plus de clé à configurer — le mode multijoueur est
 * toujours disponible.
 */
export const hasMultiplayer = true;

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

  /** Talkie-walkie : maintenir pour parler, relâcher pour envoyer. */
  startTalking: () => Promise<void>;
  stopTalking: () => void;
  /** Noms des joueurs en train de parler, pour l'affichage. */
  talkingNames: string[];
  /** Le micro a été refusé (ou est indisponible) : on le signale plutôt que d'échouer en silence. */
  micDenied: boolean;

  /** Nom affiché du joueur, et son remplacement par un nom choisi. */
  myName: string;
  renameMe: (name: string) => void;
  /** Met à jour le profil persistant (pseudo et/ou vignette). */
  updateProfile: (patch: { name?: string; avatar?: string | null }) => void;
  /** Signale une grille du jour terminée (compteur d'assiduité). */
  reportDailyDone: () => void;
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
  /** Numéro de partie — entre dans la graine, voir seedFor. */
  game: number;
  /** `fromRound` évite de sauter plusieurs grilles quand tous les clients avancent en même temps. */
  advanceRound: (fromRound?: number) => void;
  /**
   * Repart de zéro SANS quitter la session : NOUVELLE grille 1, scores et
   * indices remis à zéro. Le code de session ne change pas, donc les autres
   * joueurs restent connectés et voient la remise à zéro aussitôt.
   */
  resetSession: () => void;

  // ---- Salon ----
  /** Identifiant du créateur de la partie ; lui seul peut exclure. */
  hostId: string | null;
  /** La partie a-t-elle été lancée depuis le salon ? */
  started: boolean;
  /** Lance la partie (hôte). */
  startGame: () => void;
  /** Exclut un joueur (hôte). */
  kickPlayer: (playerId: string) => void;
  /** Ce joueur a-t-il été exclu ? */
  isKicked: (playerId: string) => boolean;

  // ---- Équipes (matchmaking privé 2v2 / 3v3) ----
  /** playerId -> 'A' | 'B'. Vide = partie coopérative classique. */
  teams: Record<string, string>;
  setTeam: (team: string | null) => void;
  /** Partie classée : issue du 1v1 aléatoire. */
  ranked: boolean;
}

const RoundContext = createContext<RoundApi | null>(null);

export function useRound(): RoundApi {
  const ctx = useContext(RoundContext);
  if (!ctx) throw new Error('useRound must be used within a SessionProvider');
  return ctx;
}

const PLAYER_COLORS = ['#F5A623', '#4ECDC4', '#FF6B6B', '#8E7CFF', '#2ECC71'];


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
  const [game, setGame] = useState(0);
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const roundApi = useMemo<RoundApi>(
    () => ({
      round,
      game,
      advanceRound: () => {
        setRound((r) => r + 1);
        setLetters({});
        setRevealed({});
      },
      resetSession: () => {
        // Incrémenter la partie change la graine : on repart sur une grille
        // NEUVE, et non sur celle déjà jouée.
        setGame((g) => g + 1);
        setRound(0);
        setLetters({});
        setRevealed({});
      },
      // En solo il n'y a ni salon ni hôte : la partie démarre directement.
      hostId: 'local',
      started: true,
      startGame: () => {},
      kickPlayer: () => {},
      isKicked: () => false,
      teams: {},
      setTeam: () => {},
      ranked: false,
    }),
    [round, game],
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
  const [localName, setLocalName] = useState(getOrCreatePlayerName);

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
      // En solo il n'y a personne à qui parler : le bouton est masqué côté UI.
      startTalking: async () => {},
      stopTalking: () => {},
      talkingNames: [],
      micDenied: false,
      myName: localName,
      renameMe: (name) => setLocalName(setPlayerName(name)),
      updateProfile: ({ name }) => { if (name) setLocalName(setPlayerName(name)); },
      reportDailyDone: () => {},
    }),
    [letters, revealed, setLetters, setRevealed, myColor, localName],
  );

  return <GameStateContext.Provider value={api}>{children}</GameStateContext.Provider>;
}

// ============================================================
// Mode multijoueur (serveur WebSocket maison)
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

/**
 * Connexion partagée : l'état de partie et la présence sont nécessaires à la
 * fois au niveau session (manche, salon) et au niveau grille (scores, lettres).
 * Les faire vivre ici évite d'ouvrir deux sockets.
 */
interface RoomBridge {
  state: RoomState;
  peers: RoomPeer[];
  send: (message: Record<string, unknown>) => void;
  me: { id: string; name: string; color: string };
  onBroadcast: (handler: (payload: unknown) => void) => () => void;
}

const RoomContext = createContext<RoomBridge | null>(null);

function useRoom(): RoomBridge {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within a SessionProvider');
  return ctx;
}

function RemoteSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  const me = useMemo(
    () => ({
      id: activePlayerId(),
      name: getOrCreatePlayerName(),
      color: randomColor(),
    }),
    [],
  );

  const [state, setState] = useState<RoomState>(EMPTY_STATE);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const connection = useRef<RoomConnection | null>(null);

  // Les auditeurs de diffusion (talkie-walkie) s'abonnent ici : le socket est
  // ouvert une seule fois, mais plusieurs composants peuvent vouloir écouter.
  const listeners = useRef(new Set<(payload: unknown) => void>());

  useEffect(() => {
    const conn = connectRoom(sessionId, me, {
      onState: setState,
      onPresence: setPeers,
      onBroadcast: (payload) => listeners.current.forEach((fn) => fn(payload)),
    });
    connection.current = conn;
    return () => {
      conn.close();
      connection.current = null;
    };
  }, [sessionId, me]);

  const send = useCallback((message: Record<string, unknown>) => {
    connection.current?.send(message);
  }, []);

  const onBroadcast = useCallback((handler: (payload: unknown) => void) => {
    listeners.current.add(handler);
    return () => listeners.current.delete(handler);
  }, []);

  const bridge = useMemo<RoomBridge>(
    () => ({ state, peers, send, me, onBroadcast }),
    [state, peers, send, me, onBroadcast],
  );

  const roundApi = useMemo<RoundApi>(
    () => ({
      round: state.round,
      game: state.game,
      // `fromRound` rend l'appel idempotent côté serveur : tous les clients
      // l'émettent en même temps dès que le dernier joueur est prêt.
      advanceRound: (fromRound) => send({ t: 'advance', fromRound }),
      resetSession: () => send({ t: 'reset' }),
      hostId: state.hostId,
      started: state.started,
      startGame: () => send({ t: 'start' }),
      kickPlayer: (playerId) => send({ t: 'kick', playerId }),
      isKicked: (playerId) => state.kicked[playerId] === true,
      teams: state.teams ?? {},
      setTeam: (team) => send({ t: 'team', team }),
      ranked: state.ranked === true,
    }),
    [state, send],
  );

  return (
    <RoomContext.Provider value={bridge}>
      <RoundContext.Provider value={roundApi}>{children}</RoundContext.Provider>
    </RoomContext.Provider>
  );
}

function RemoteGameProvider({
  puzzle,
  children,
}: {
  puzzle: Puzzle;
  children: React.ReactNode;
}) {
  const { state, peers, send, me, onBroadcast } = useRoom();
  const { wordsById, cellsByWordId, wordIdsByCellId } = usePuzzleIndex(puzzle);
  const [myName, setMyName] = useState(me.name);

  const getLetter = useCallback((cellId: string) => state.letters[cellId] ?? '', [state.letters]);

  /**
   * Le score est calculé ICI, pas sur le serveur : lui seul ignore les mots
   * de la grille, et l'y envoyer ferait de ce serveur générique un serveur
   * de mots fléchés. Même niveau de confiance qu'avant, les mutations
   * Liveblocks s'exécutant elles aussi côté client.
   *
   * Seul l'auteur de la frappe détecte la transition non-résolu → résolu,
   * donc un mot ne peut pas être compté deux fois.
   */
  const setLetter = useCallback(
    (cellId: string, letter: string) => {
      const affected = wordIdsByCellId.get(cellId) ?? [];
      const complete = (wordId: string, override: string) => {
        const word = wordsById.get(wordId);
        const cells = cellsByWordId.get(wordId);
        if (!word || !cells) return false;
        return cells.every((id, i) => {
          const value = id === cellId ? override : (state.letters[id] ?? '');
          return value === word.answer[i];
        });
      };
      const avant = new Map(affected.map((id) => [id, complete(id, state.letters[cellId] ?? '')]));
      const scored = affected.filter((id) => !avant.get(id) && complete(id, letter)).length;
      send({ t: 'letter', cellId, letter, scored });
    },
    [send, state.letters, wordsById, cellsByWordId, wordIdsByCellId],
  );

  const revealLetter = useCallback(
    (cellId: string, letter: string) => send({ t: 'reveal', cellId, letter }),
    [send],
  );

  const scoreboard = useMemo<PlayerScore[]>(() => {
    const ids = new Set<string>([
      ...Object.keys(state.players),
      ...Object.keys(state.scores),
      me.id,
      ...peers.map((p) => p.id),
    ]);
    const online = new Set(peers.map((p) => p.id));

    return [...ids]
      .map((id) => {
        const isMe = id === me.id;
        const live = peers.find((p) => p.id === id);
        const stored = state.players[id];
        return {
          playerId: id,
          name: isMe ? myName : (live?.name ?? stored?.name ?? 'Joueur'),
          color: live?.color ?? stored?.color ?? '#9CA3AF',
          score: state.scores[id] ?? 0,
          hints: state.hints[id] ?? 0,
          online: online.has(id),
          isMe,
        };
      })
      .sort((a, b) => b.score - a.score || Number(b.isMe) - Number(a.isMe));
  }, [state, peers, me.id, myName]);

  /** On n'attend que les joueurs EN LIGNE : un partant bloquerait les autres. */
  const allReadyFor = useCallback(
    (round: number) => peers.every((p) => state.ready[p.id] === round),
    [peers, state.ready],
  );

  const renameMe = useCallback(
    (name: string) => {
      const clean = setPlayerName(name);
      setMyName(clean);
      // `profile` met à jour le profil PERSISTANT en plus de l'état de partie :
      // le pseudo doit survivre à la session.
      send({ t: 'profile', name: clean });
    },
    [send],
  );

  const updateProfile = useCallback(
    (patch: { name?: string; avatar?: string | null }) => {
      if (patch.name) {
        const clean = setPlayerName(patch.name);
        setMyName(clean);
        send({ t: 'profile', name: clean, avatar: patch.avatar });
      } else {
        send({ t: 'profile', avatar: patch.avatar });
      }
    },
    [send],
  );

  const reportDailyDone = useCallback(() => send({ t: 'dailyDone' }), [send]);

  // ---------- Talkie-walkie ----------
  const recordingRef = useRef<Recording | null>(null);
  const [talking, setTalking] = useState<Record<string, string>>({});
  const [micDenied, setMicDenied] = useState(false);
  const talkingNames = useMemo(() => Object.values(talking), [talking]);
  const inbox = useRef(new Map<string, { parts: Map<number, string>; total: number }>());

  useEffect(
    () =>
      onBroadcast((raw) => {
        const event = raw as Record<string, unknown>;
        if (event.type === 'voice-start') {
          setTalking((prev) => ({ ...prev, [event.playerId as string]: event.name as string }));
        } else if (event.type === 'voice-end') {
          setTalking((prev) => {
            const next = { ...prev };
            delete next[event.playerId as string];
            return next;
          });
        } else if (event.type === 'voice-chunk') {
          // Les morceaux d'un même message peuvent arriver dans le désordre :
          // on les range par numéro et on ne joue qu'une fois complet.
          const clipId = event.clipId as string;
          const entry =
            inbox.current.get(clipId) ?? { parts: new Map<number, string>(), total: event.total as number };
          entry.parts.set(event.seq as number, event.data as string);
          inbox.current.set(clipId, entry);
          if (entry.parts.size === entry.total) {
            inbox.current.delete(clipId);
            setTalking((prev) => {
              const next = { ...prev };
              delete next[event.playerId as string];
              return next;
            });
            const ordered = Array.from({ length: entry.total }, (_, i) => entry.parts.get(i) ?? '').join('');
            void playRadioClip(ordered);
          }
        }
      }),
    [onBroadcast],
  );

  const startTalking = useCallback(async () => {
    if (recordingRef.current) return;
    try {
      recordingRef.current = await startRecording();
      setMicDenied(false);
      send({ t: 'broadcast', payload: { type: 'voice-start', playerId: me.id, name: myName } });
    } catch {
      recordingRef.current = null;
      setMicDenied(true);
    }
  }, [send, me.id, myName]);

  const stopTalking = useCallback(() => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    send({ t: 'broadcast', payload: { type: 'voice-end', playerId: me.id } });

    void rec.stop().then((clip) => {
      if (!clip) return;
      const chunks = splitIntoChunks(clip.base64);
      const clipId = `${me.id}-${Date.now()}`;
      chunks.forEach((data, seq) =>
        send({
          t: 'broadcast',
          payload: {
            type: 'voice-chunk',
            playerId: me.id,
            name: myName,
            clipId,
            seq,
            total: chunks.length,
            data,
          },
        }),
      );
    });
  }, [send, me.id, myName]);

  const api = useMemo<GameStateApi>(
    () => ({
      multiplayer: true,
      getLetter,
      setLetter,
      revealLetter,
      isRevealed: (cellId) => state.revealed[cellId] === true,
      others: peers
        .filter((p) => p.id !== me.id)
        .map((p) => ({
          connectionId: p.connectionId,
          name: p.name,
          color: p.color,
          activeCell: p.activeCell,
        })),
      myColor: me.color,
      myPlayerId: me.id,
      setMyActiveCell: (cellId) => send({ t: 'presence', activeCell: cellId }),
      scoreboard,
      setReady: (round) => send({ t: 'ready', round }),
      allReadyFor,
      isReadyFor: (playerId, round) => state.ready[playerId] === round,
      startTalking,
      stopTalking,
      talkingNames,
      micDenied,
      myName,
      renameMe,
      updateProfile,
      reportDailyDone,
    }),
    [
      getLetter, setLetter, revealLetter, state, peers, me, send, scoreboard,
      allReadyFor, startTalking, stopTalking, talkingNames, micDenied, myName,
      renameMe, updateProfile, reportDailyDone,
    ],
  );

  return <GameStateContext.Provider value={api}>{children}</GameStateContext.Provider>;
}

// ============================================================
// Providers exportés
// ============================================================

/**
 * Ouvre la session. L'identifiant de room ne dépend QUE de la session, pas de
 * la manche : il faut déjà être connecté pour savoir quelle manche est en
 * cours. Effet de bord souhaitable : les scores se cumulent sur la session.
 */
export function SessionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  if (!hasMultiplayer) {
    return <LocalSessionProvider>{children}</LocalSessionProvider>;
  }
  return <RemoteSessionProvider sessionId={sessionId}>{children}</RemoteSessionProvider>;
}

/** À placer sous SessionProvider, une fois la grille de la manche chargée. */
export function GameStateProvider({
  puzzle,
  children,
}: {
  puzzle: Puzzle;
  children: React.ReactNode;
}) {
  if (!hasMultiplayer) {
    return <LocalGameProvider>{children}</LocalGameProvider>;
  }
  return <RemoteGameProvider puzzle={puzzle}>{children}</RemoteGameProvider>;
}
