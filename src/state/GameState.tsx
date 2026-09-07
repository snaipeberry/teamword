import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  connectRoom,
  EMPTY_STATE,
  type RoomConnection,
  type RoomPeer,
  type RoomState,
} from '../lib/roomClient';
import { getOrCreatePlayerName } from '../lib/playerName';
import { activePlayerId, activePlayerName, activePlayerToken } from '../lib/auth';
import { wordCellIds } from '../lib/gridGeometry';
import type { MultiplayerGrade } from '../lib/difficulty';
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

  /** Nom affiché du joueur — fixe (pseudo du compte, ou nom généré pour un
   *  invité) : voir lib/auth.ts, aucune UI ne permet plus de le changer. */
  myName: string;
  /**
   * Signale une grille solo/quotidienne terminée : `points` (pondérés par la
   * complexité, calculés côté appelant qui seul connaît les mots) rejoint
   * `profile.soloPoints` côté serveur.
   */
  reportGridDone: (points: number, daily: boolean) => void;
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

  // ---- Difficulté (répartition des indices) ----
  /** Grade choisi par l'hôte dans le salon — 'moyen' par défaut (parties
   *  sans salon : bot, duel aléatoire). Voir lib/difficulty.ts. */
  grade: MultiplayerGrade;
  setGrade: (grade: MultiplayerGrade) => void;
}

const RoundContext = createContext<RoundApi | null>(null);

export function useRound(): RoundApi {
  const ctx = useContext(RoundContext);
  if (!ctx) throw new Error('useRound must be used within a SessionProvider');
  return ctx;
}

// Tons puisés dans les rampes organic (tailwind.config.js) pour ne pas jurer
// avec le reste de l'habillage — terre cuite, sauge, et quelques repères
// neutres pour distinguer plus de joueurs que les deux couleurs de rôle.
const PLAYER_COLORS = ['#D67F48', '#8FA073', '#B2622D', '#728157', '#82796A'];


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
      grade: 'moyen',
      setGrade: () => {},
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
  const localName = useMemo(getOrCreatePlayerName, []);

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
      myName: localName,
      reportGridDone: () => {},
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
}

const RoomContext = createContext<RoomBridge | null>(null);

function useRoom(): RoomBridge {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within a SessionProvider');
  return ctx;
}

function RemoteSessionProvider({
  sessionId,
  mode,
  children,
}: {
  sessionId: string;
  mode?: string;
  children: React.ReactNode;
}) {
  const me = useMemo(
    () => ({
      id: activePlayerId(),
      name: activePlayerName(),
      color: randomColor(),
      token: activePlayerToken(),
    }),
    [],
  );

  const [state, setState] = useState<RoomState>(EMPTY_STATE);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const connection = useRef<RoomConnection | null>(null);

  useEffect(() => {
    const conn = connectRoom(
      sessionId,
      me,
      {
        onState: setState,
        onPresence: setPeers,
      },
      mode,
    );
    connection.current = conn;
    return () => {
      conn.close();
      connection.current = null;
    };
  }, [sessionId, me, mode]);

  const send = useCallback((message: Record<string, unknown>) => {
    connection.current?.send(message);
  }, []);

  const bridge = useMemo<RoomBridge>(
    () => ({ state, peers, send, me }),
    [state, peers, send, me],
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
      grade: (state.grade as MultiplayerGrade) ?? 'moyen',
      setGrade: (grade) => send({ t: 'grade', grade }),
    }),
    [state, send],
  );

  return (
    <RoomContext.Provider value={bridge}>
      <RoundContext.Provider value={roundApi}>{children}</RoundContext.Provider>
    </RoomContext.Provider>
  );
}

/** Une frappe non confirmée au-delà de ce délai est abandonnée : l'autorité
 *  reste le serveur, et mieux vaut retirer une lettre fantôme que la figer. */
const PEREMPTION_MS = 8000;

function RemoteGameProvider({
  puzzle,
  children,
}: {
  puzzle: Puzzle;
  children: React.ReactNode;
}) {
  const { state, peers, send, me } = useRoom();
  const { wordsById, cellsByWordId, wordIdsByCellId } = usePuzzleIndex(puzzle);
  const myName = me.name;

  /**
   * Saisie optimiste.
   *
   * Sans elle, une lettre n'apparaissait qu'au retour du serveur : mesuré à
   * 404 ms sur l'hébergement de production (0 ms en local, d'où un bug
   * invisible en développement). On affiche donc la frappe immédiatement, et
   * l'état serveur — qui reste la seule autorité — vient la confirmer.
   *
   * Ce n'est pas qu'un confort d'affichage : `setLetter` calcule le score à
   * partir des lettres déjà posées. En lisant le seul état serveur, une frappe
   * rapide ne « voyait » pas les lettres précédentes encore en vol, et la
   * complétion d'un mot pouvait n'être jamais détectée.
   */
  const enAttente = useRef<Map<string, { letter: string; at: number }>>(new Map());
  const [versionAttente, setVersionAttente] = useState(0);

  const purger = useCallback(() => {
    const maintenant = Date.now();
    let change = false;
    for (const [cellId, p] of enAttente.current) {
      const confirme = (state.letters[cellId] ?? '') === p.letter;
      if (confirme || maintenant - p.at > PEREMPTION_MS) {
        enAttente.current.delete(cellId);
        change = true;
      }
    }
    if (change) setVersionAttente((v) => v + 1);
  }, [state.letters]);

  // Chaque diffusion du serveur est une occasion de confirmer les frappes en vol.
  useEffect(purger, [purger]);

  /** Lettre affichée : la frappe locale non confirmée prime sur l'état serveur. */
  const lettreEffective = useCallback(
    (cellId: string) => enAttente.current.get(cellId)?.letter ?? state.letters[cellId] ?? '',
    [state.letters],
  );

  const getLetter = useCallback(
    (cellId: string) => lettreEffective(cellId),
    // versionAttente force le recalcul des mémos qui en dépendent (grille,
    // mots résolus) dès qu'une frappe locale est posée ou confirmée.
    [lettreEffective, versionAttente],
  );

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
          // lettreEffective et non state.letters : les frappes précédentes
          // peuvent être encore en vol, et les ignorer ferait manquer la
          // complétion du mot.
          const value = id === cellId ? override : lettreEffective(id);
          return value === word.answer[i];
        });
      };
      const avant = new Map(affected.map((id) => [id, complete(id, lettreEffective(cellId))]));
      const scored = affected.filter((id) => !avant.get(id) && complete(id, letter)).length;

      // Affichage immédiat, puis envoi. L'ordre importe peu techniquement,
      // mais dit l'intention : l'écran ne dépend pas du réseau.
      enAttente.current.set(cellId, { letter, at: Date.now() });
      setVersionAttente((v) => v + 1);
      send({ t: 'letter', cellId, letter, scored });
    },
    [send, lettreEffective, wordsById, cellsByWordId, wordIdsByCellId],
  );

  const revealLetter = useCallback(
    (cellId: string, letter: string) => {
      // Même raison que pour la frappe : la lettre révélée doit apparaître
      // sans attendre le serveur.
      enAttente.current.set(cellId, { letter, at: Date.now() });
      setVersionAttente((v) => v + 1);
      send({ t: 'reveal', cellId, letter });
    },
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

  const reportGridDone = useCallback(
    (points: number, daily: boolean) => send({ t: 'soloGridDone', points, daily }),
    [send],
  );

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
      myName,
      reportGridDone,
    }),
    [getLetter, setLetter, revealLetter, state, peers, me, send, scoreboard, allReadyFor, myName, reportGridDone],
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
  mode,
  children,
}: {
  sessionId: string;
  /** 'solo' | 'daily' — voir server/index.js pour ce que ça change. */
  mode?: string;
  children: React.ReactNode;
}) {
  if (!hasMultiplayer) {
    return <LocalSessionProvider>{children}</LocalSessionProvider>;
  }
  return (
    <RemoteSessionProvider sessionId={sessionId} mode={mode}>
      {children}
    </RemoteSessionProvider>
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
  if (!hasMultiplayer) {
    return <LocalGameProvider>{children}</LocalGameProvider>;
  }
  return <RemoteGameProvider puzzle={puzzle}>{children}</RemoteGameProvider>;
}
