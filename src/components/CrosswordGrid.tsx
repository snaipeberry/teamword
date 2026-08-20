import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Puzzle } from '../types/puzzle';
import { cellId, wordCellIds } from '../lib/gridGeometry';
import { useGameState, useRound, type PlayerCursor } from '../state/GameState';
import { ClueCell } from './ClueCell';
import { LetterCell } from './LetterCell';
import { CompletionCelebration } from './CompletionCelebration';
import { Keyboard } from './Keyboard';
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

  /**
   * Taille de la grille, mesurée plutôt que calculée en CSS.
   *
   * Il faut respecter DEUX bornes à la fois — largeur et hauteur disponibles —
   * en gardant le ratio. Or `aspect-ratio` ne propage la contrainte que dans
   * un sens : partir de la largeur laisse `max-height` rogner la hauteur sans
   * réduire la largeur (mesuré : 353x301 sur un écran 375x667), et partir de
   * la hauteur produit l'inverse. On mesure donc le conteneur et on prend le
   * minimum des deux.
   */
  const fitRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const ratio = puzzle.cols / puzzle.rows;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setGridWidth(Math.floor(Math.min(width, 480, height * ratio)));
      }
    };
    // Mesure SYNCHRONE dans le callback : ResizeObserver se déclenche déjà
    // après le calcul de la mise en page, les dimensions y sont donc justes.
    // Surtout, ne pas passer par requestAnimationFrame — il ne s'exécute pas
    // quand l'onglet ne compose pas de frames (arrière-plan), et la grille
    // resterait alors bloquée sur sa taille de repli.
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [puzzle.cols, puzzle.rows]);

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
    },
    [activeCellId, activeWordId, game, puzzle.grid],
  );

  /**
   * Sélectionne un mot depuis sa DÉFINITION.
   *
   * Le double-tap sur une case pour changer de direction fonctionne, mais il
   * est inutilisable en pratique : dès qu'on a saisi une lettre le curseur a
   * avancé, donc retaper la case d'origine ne bascule plus rien. Passer par
   * la définition — qui porte déjà sa flèche — rend le choix du sens explicite.
   */
  const selectWord = useCallback(
    (wordId: string) => {
      unlockAudio();
      const ids = cellsByWordId.get(wordId);
      if (!ids || ids.length === 0) return;
      // On démarre sur la première case encore à remplir, pas systématiquement
      // sur la première du mot : sinon on repasse sur des lettres déjà justes.
      const target = ids.find((id) => game.getLetter(id) !== answerByCellId.get(id)) ?? ids[0];
      setActiveWordId(wordId);
      setActiveCellId(target);
      game.setMyActiveCell(target);
    },
    [cellsByWordId, answerByCellId, game],
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
    (e: globalThis.KeyboardEvent) => {
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

  // Écoute globale plutôt qu'un <input> caché qu'il fallait garder focalisé.
  // Sur téléphone ce focus ouvrait le clavier natif — dont la hauteur est
  // imposée par l'OS — qui recouvrait la moitié de la grille. La saisie
  // tactile passe désormais par le clavier intégré (voir Keyboard.tsx), et
  // cette écoute ne sert plus qu'au clavier physique sur ordinateur.
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

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
    // `min-h-0` est indispensable : sans lui un enfant flex refuse de se
    // comprimer sous sa taille de contenu, et la grille pousserait le clavier
    // hors de l'écran au lieu de se réduire.
    <div className="flex w-full min-h-0 flex-1 flex-col items-center gap-2 px-2 sm:px-4">
      {/*
        Conteneur centreur : c'est LUI qui absorbe la hauteur restante. La
        carte, elle, ne doit surtout pas être en `flex-1` — cela l'étirerait
        verticalement et écraserait son ratio (cases mesurées 46x59 au lieu
        de carrées). Elle se dimensionne donc uniquement par son aspect-ratio,
        borné par la hauteur ET la largeur disponibles.
      */}
      <div ref={fitRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
        <motion.div
          animate={mounted ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.15 }}
          className="rounded-2xl bg-gradient-to-br from-aurora-amber via-aurora-coral to-aurora-magenta p-[3px] shadow-2xl"
          style={{
            aspectRatio: `${puzzle.cols} / ${puzzle.rows}`,
            // Avant la première mesure on retombe sur la largeur pleine, pour
            // éviter un saut de mise en page au montage.
            width: gridWidth ? `${gridWidth}px` : '100%',
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
        <div
          className="grid h-full w-full overflow-hidden rounded-[14px] border border-white/40"
          style={{
            gridTemplateColumns: `repeat(${puzzle.cols}, 1fr)`,
            // Lignes explicitement uniformes : sans cette ligne, les rangées
            // implicites s'étirent au gré du texte des définitions (mesuré :
            // 40 à 55 px sur une même grille), ce qui donne des cases de
            // tailles inégales.
            gridTemplateRows: `repeat(${puzzle.rows}, 1fr)`,
          }}
        >
          {puzzle.grid.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const id = cellId(row, col);
              if (cell.type === 'blank') {
                return <div key={id} className="bg-neutral-100" />;
              }
              if (cell.type === 'clue') {
                return (
                  <ClueCell
                    key={id}
                    data={cell}
                    solvedWordIds={solvedWordIds}
                    activeWordId={activeWordId}
                    onSelectWord={selectWord}
                  />
                );
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
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <motion.button
          type="button"
          onClick={revealActiveCell}
          whileTap={{ scale: 0.94 }}
          className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-4 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition"
        >
          <span aria-hidden="true">💡</span> Révéler
        </motion.button>

        <motion.button
          type="button"
          onClick={checkGrid}
          whileTap={{ scale: 0.94 }}
          className="flex items-center gap-1.5 rounded-full bg-white px-5 py-1.5 text-xs font-bold text-aurora-violet shadow-xl transition"
        >
          <span aria-hidden="true">✓</span> Vérifier
        </motion.button>
      </div>

      <Keyboard onLetter={handleLetter} onBackspace={handleBackspace} />

      <AnimatePresence>
        {celebrating && <CompletionCelebration onDone={goToNextRound} />}
      </AnimatePresence>
    </div>
  );
}
