import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Puzzle } from '../types/puzzle';
import { cellId, wordCellIds } from '../lib/gridGeometry';
import { useGameState, useRound, type PlayerCursor } from '../state/GameState';
import { ClueCell } from './ClueCell';
import { LetterCell } from './LetterCell';
import { CompletionCelebration } from './CompletionCelebration';
import {
  hapticTick,
  hapticWin,
  hapticWordFound,
  hapticWrong,
  playCorrectSound,
  playWinSound,
  playWordFoundSound,
  playWrongSound,
  unlockAudio,
} from '../lib/sounds';

export function CrosswordGrid({ puzzle }: { puzzle: Puzzle }) {
  const game = useGameState();
  const { advanceRound } = useRound();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [activeWordId, setActiveWordId] = useState<string | null>(null);
  const [wrongCells, setWrongCells] = useState<Set<string>>(new Set());
  const [celebrating, setCelebrating] = useState(false);
  // Plain state (rather than Framer Motion's initial/animate mount detection) drives the
  // card's entrance animation — under React 18 StrictMode's double-invoked mount, relying
  // on FM's own "is this the first render" tracking left the card stuck at its initial
  // (invisible) state, so a normal effect flipping this once is more robust.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cellsByWordId = useMemo(() => {
    const map = new Map<string, string[]>();
    puzzle.words.forEach((w) => map.set(w.id, wordCellIds(w)));
    return map;
  }, [puzzle.words]);

  const wordIdsByCell = useMemo(() => {
    const map = new Map<string, string[]>();
    puzzle.grid.forEach((rowCells, row) => {
      rowCells.forEach((cell, col) => {
        if (cell.type === 'letter') map.set(cellId(row, col), cell.wordIds);
      });
    });
    return map;
  }, [puzzle.grid]);

  const allLetterCells = useMemo(() => {
    const cells: { id: string; answer: string }[] = [];
    puzzle.grid.forEach((rowCells, row) => {
      rowCells.forEach((cell, col) => {
        if (cell.type === 'letter') cells.push({ id: cellId(row, col), answer: cell.answer });
      });
    });
    return cells;
  }, [puzzle.grid]);

  const answerByCellId = useMemo(
    () => new Map(allLetterCells.map(({ id, answer }) => [id, answer])),
    [allLetterCells],
  );

  // A word is "found" once every one of its cells holds the right letter — at that
  // point it locks (see isCellLocked below) and its clue/cells get the found effects.
  const solvedWordIds = useMemo(() => {
    const solved = new Set<string>();
    puzzle.words.forEach((word) => {
      const ids = cellsByWordId.get(word.id) ?? [];
      const isWordSolved = ids.every((id, i) => game.getLetter(id) === word.answer[i]);
      if (isWordSolved) solved.add(word.id);
    });
    return solved;
  }, [puzzle.words, cellsByWordId, game]);

  const isCellLocked = useCallback(
    (id: string) => (wordIdsByCell.get(id) ?? []).some((w) => solvedWordIds.has(w)),
    [wordIdsByCell, solvedWordIds],
  );

  // Stagger delay (seconds) for each newly-locked cell's flash, based on its
  // position within whichever solved word claims it — gives a left-to-right /
  // top-to-bottom "wave" reveal across the word instead of everything popping at once.
  const lockDelayByCell = useMemo(() => {
    const map = new Map<string, number>();
    puzzle.words.forEach((word) => {
      if (!solvedWordIds.has(word.id)) return;
      const ids = cellsByWordId.get(word.id) ?? [];
      ids.forEach((id, index) => {
        if (!map.has(id)) map.set(id, index * 0.07);
      });
    });
    return map;
  }, [puzzle.words, solvedWordIds, cellsByWordId]);

  const prevSolvedWordIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const foundNewWord = [...solvedWordIds].some((id) => !prevSolvedWordIds.current.has(id));
    if (foundNewWord) {
      playWordFoundSound();
      hapticWordFound();
    }
    prevSolvedWordIds.current = solvedWordIds;
  }, [solvedWordIds]);

  const isSolved = useMemo(
    () => allLetterCells.length > 0 && allLetterCells.every(({ id, answer }) => game.getLetter(id) === answer),
    [allLetterCells, game],
  );

  useEffect(() => {
    if (isSolved) {
      setCelebrating(true);
      playWinSound();
      hapticWin();
    }
  }, [isSolved]);

  // Le passage à la manche suivante est déclenché à la FIN de la célébration
  // (voir onDone de CompletionCelebration) plutôt qu'à la détection de la
  // victoire : sinon la grille serait remplacée avant que le joueur ait vu
  // les confettis.
  const goToNextRound = useCallback(() => {
    setCelebrating(false);
    advanceRound();
  }, [advanceRound]);

  const revealActiveCell = useCallback(() => {
    unlockAudio();

    // Repli en cascade, pour que le bouton fasse toujours quelque chose :
    // la case sélectionnée, sinon la première case encore fausse du mot en
    // cours, sinon n'importe quelle case fausse de la grille (sans ce
    // dernier niveau, le bouton devenait inerte dès que le mot courant
    // était complet).
    const isWrong = (id: string) => game.getLetter(id) !== answerByCellId.get(id);

    let target: string | null = null;
    if (activeCellId && isWrong(activeCellId)) {
      target = activeCellId;
    } else if (activeWordId) {
      target = (cellsByWordId.get(activeWordId) ?? []).find(isWrong) ?? null;
    }
    if (!target) {
      target = allLetterCells.map((c) => c.id).find(isWrong) ?? null;
    }
    if (!target) return;

    const answer = answerByCellId.get(target);
    if (!answer) return;

    game.revealLetter(target, answer);
    playCorrectSound();
    hapticTick();
    setWrongCells((prev) => {
      if (!prev.has(target!)) return prev;
      const next = new Set(prev);
      next.delete(target!);
      return next;
    });
  }, [activeCellId, activeWordId, cellsByWordId, allLetterCells, answerByCellId, game]);

  const activeWordCellIds = activeWordId ? (cellsByWordId.get(activeWordId) ?? []) : [];

  const selectCell = useCallback(
    (row: number, col: number) => {
      const cell = puzzle.grid[row][col];
      if (cell.type !== 'letter') return;
      const id = cellId(row, col);
      unlockAudio();

      let nextWordId = cell.wordIds[0];
      if (id === activeCellId && cell.wordIds.length > 1) {
        const currentIndex = cell.wordIds.indexOf(activeWordId ?? '');
        nextWordId = cell.wordIds[(currentIndex + 1) % cell.wordIds.length];
      } else if (activeWordId && cell.wordIds.includes(activeWordId)) {
        nextWordId = activeWordId;
      }

      setActiveCellId(id);
      setActiveWordId(nextWordId);
      game.setMyActiveCell(id);
      inputRef.current?.focus();
    },
    [activeCellId, activeWordId, game, puzzle.grid],
  );

  const moveWithinWord = useCallback(
    (delta: number) => {
      if (!activeWordId || !activeCellId) return;
      const ids = cellsByWordId.get(activeWordId) ?? [];
      const idx = ids.indexOf(activeCellId);
      let nextIdx = idx + delta;
      // Skip over already-locked (found) cells so typing flows straight to what's left to fill.
      while (nextIdx >= 0 && nextIdx < ids.length && isCellLocked(ids[nextIdx])) {
        nextIdx += delta;
      }
      if (nextIdx < 0 || nextIdx >= ids.length) return;
      const nextId = ids[nextIdx];
      setActiveCellId(nextId);
      game.setMyActiveCell(nextId);
    },
    [activeWordId, activeCellId, cellsByWordId, game, isCellLocked],
  );

  const handleLetter = useCallback(
    (letter: string) => {
      if (!activeCellId || isCellLocked(activeCellId)) return;
      game.setLetter(activeCellId, letter);
      playCorrectSound();
      hapticTick();
      setWrongCells((prev) => {
        if (!prev.has(activeCellId)) return prev;
        const next = new Set(prev);
        next.delete(activeCellId);
        return next;
      });
      moveWithinWord(1);
    },
    [activeCellId, game, isCellLocked, moveWithinWord],
  );

  const handleBackspace = useCallback(() => {
    if (!activeCellId) return;
    if (isCellLocked(activeCellId)) {
      moveWithinWord(-1);
      return;
    }
    if (game.getLetter(activeCellId)) {
      game.setLetter(activeCellId, '');
    } else {
      moveWithinWord(-1);
    }
  }, [activeCellId, game, isCellLocked, moveWithinWord]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const key = e.key;
      if (key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }
      if (key === 'ArrowRight' || key === 'ArrowDown') {
        e.preventDefault();
        moveWithinWord(1);
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowUp') {
        e.preventDefault();
        moveWithinWord(-1);
        return;
      }
      if (key.length === 1) {
        // Grid answers use plain A-Z (accents are stripped by crossword convention),
        // so a long-press "é" on the iOS keyboard still lands as E.
        const normalized = key
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase();
        if (/^[A-Z]$/.test(normalized)) {
          e.preventDefault();
          handleLetter(normalized);
        }
      }
    },
    [handleBackspace, handleLetter, moveWithinWord],
  );

  const checkGrid = useCallback(() => {
    const wrong = new Set<string>();
    allLetterCells.forEach(({ id, answer }) => {
      const value = game.getLetter(id);
      if (value && value !== answer) wrong.add(id);
    });
    setWrongCells(wrong);
    if (wrong.size > 0) {
      playWrongSound();
      hapticWrong();
    }
  }, [allLetterCells, game]);

  const othersByCellId = useMemo(() => {
    const map = new Map<string, PlayerCursor[]>();
    game.others.forEach((o) => {
      if (!o.activeCell) return;
      map.set(o.activeCell, [...(map.get(o.activeCell) ?? []), o]);
    });
    return map;
  }, [game.others]);

  return (
    // Marge réduite sur téléphone : 32 px de padding coûtaient ~4 px de
    // largeur à chaque case, ce qui compte beaucoup pour lire les définitions.
    <div className="flex w-full flex-col items-center gap-5 px-2 pb-[env(safe-area-inset-bottom)] sm:px-4">
      <motion.div
        animate={mounted ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.15 }}
        className="w-full max-w-[480px] rounded-2xl bg-gradient-to-br from-aurora-amber via-aurora-coral to-aurora-magenta p-[3px] shadow-2xl"
      >
        <div
          className="grid overflow-hidden rounded-[14px] border border-white/40"
          style={{
            gridTemplateColumns: `repeat(${puzzle.cols}, 1fr)`,
            // Lignes explicitement uniformes : sans cette ligne, les rangées
            // implicites s'étirent au gré du texte des définitions (mesuré :
            // 40 à 55 px sur une même grille), ce qui donne des cases de
            // tailles inégales.
            gridTemplateRows: `repeat(${puzzle.rows}, 1fr)`,
            aspectRatio: `${puzzle.cols} / ${puzzle.rows}`,
          }}
        >
          {puzzle.grid.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const id = cellId(row, col);
              if (cell.type === 'blank') {
                return <div key={id} className="bg-neutral-100" />;
              }
              if (cell.type === 'clue') {
                return <ClueCell key={id} data={cell} solvedWordIds={solvedWordIds} />;
              }
              const value = game.getLetter(id);
              return (
                <LetterCell
                  key={id}
                  value={value}
                  isActive={activeCellId === id}
                  isInActiveWord={activeWordCellIds.includes(id)}
                  isCorrect={value !== '' && value === cell.answer}
                  isWrong={wrongCells.has(id)}
                  isLocked={isCellLocked(id)}
                  lockDelay={lockDelayByCell.get(id) ?? 0}
                  othersHere={othersByCellId.get(id) ?? []}
                  onSelect={() => selectCell(row, col)}
                />
              );
            }),
          )}
        </div>
      </motion.div>

      <input
        ref={inputRef}
        className="pointer-events-none absolute h-px w-px opacity-0"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        inputMode="text"
        aria-hidden="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      />

      <div className="flex items-center gap-3">
        <motion.button
          type="button"
          onClick={revealActiveCell}
          whileTap={{ scale: 0.94 }}
          className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-5 py-2.5 text-sm font-bold text-white shadow-lg backdrop-blur-md transition"
        >
          <span aria-hidden="true">💡</span> Révéler
        </motion.button>

        <motion.button
          type="button"
          onClick={checkGrid}
          whileTap={{ scale: 0.94 }}
          className="flex items-center gap-1.5 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-aurora-violet shadow-xl transition"
        >
          <span aria-hidden="true">✓</span> Vérifier
        </motion.button>
      </div>

      <AnimatePresence>
        {celebrating && <CompletionCelebration onDone={goToNextRound} />}
      </AnimatePresence>
    </div>
  );
}
