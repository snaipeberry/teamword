import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Puzzle } from '../types/puzzle';
import { cellId, wordCellIds } from '../lib/gridGeometry';
import { useGameState, useRound, type PlayerCursor } from '../state/GameState';
import { Avatar } from './Avatar';
import { ClueCell } from './ClueCell';
import { LetterCell } from './LetterCell';
import { CompletionCelebration } from './CompletionCelebration';
import { Keyboard } from './Keyboard';
import { RoundResults } from './RoundResults';
import { SoloRoundResults } from './SoloRoundResults';
import { ActiveClueBar } from './ActiveClueBar';
import { ProgressRail, RAIL_TOTAL_PX, useCamps } from './ProgressRails';
import type { UseSoloProfileResult } from '../hooks/useSoloProfile';
import {
  hapticTick,
  hapticWin,
  hapticWordFound,
  playCorrectSound,
  playWinSound,
  playWordFoundSound,
  unlockAudio,
} from '../lib/sounds';

export function CrosswordGrid({
  puzzle,
  round,
  daily = false,
  solo = false,
  soloProfile,
}: {
  puzzle: Puzzle;
  round: number;
  /** La grille du jour est unique : pas d'enchaînement vers une suivante. */
  daily?: boolean;
  /** Mode solo : progression infinie, points pondérés, ampoules limitées. */
  solo?: boolean;
  /** Chargé par le parent (Round, dans App.tsx) — sa répartition d'indices
   *  doit être connue AVANT de demander la grille, donc avant même que ce
   *  composant existe. Voir useSoloProfile. */
  soloProfile: UseSoloProfileResult;
}) {
  const game = useGameState();
  const { advanceRound } = useRound();
  const soloScored = solo || daily;
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [activeWordId, setActiveWordId] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [showResults, setShowResults] = useState(false);
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

  // Avancement des deux camps, rendu en rails de chaque côté de la grille.
  // `null` en solo, en quotidien et en coopération — il n'y a alors personne
  // à qui se comparer. Déclaré ici parce que la mesure ci-dessous doit savoir
  // si les rails occupent, ou non, une part de la largeur.
  const camps = useCamps(puzzle.words.length);
  const reserve = camps ? 2 * RAIL_TOTAL_PX : 0;

  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const ratio = puzzle.cols / puzzle.rows;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        // `reserve` : les rails latéraux et leurs gouttières sont DANS la zone
        // mesurée. Sans cette déduction la grille se croirait plus large
        // qu'elle ne peut l'être et déborderait de l'écran.
        setGridWidth(Math.floor(Math.min(width - reserve, 480, height * ratio)));
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
  }, [puzzle.cols, puzzle.rows, reserve]);

  // Côté d'une case, dérivé de la mesure du conteneur : c'est lui qui
  // dimensionne le texte des définitions (voir ClueCell). Repli sur une
  // valeur plausible tant que la première mesure n'a pas eu lieu.
  const cellSize = (gridWidth ?? 360) / puzzle.cols;


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

  // Formule confirmée : somme brute des complexités, sans pondération par le
  // nombre de mots — une grille avec plus de mots rapporte donc simplement
  // plus, sans bonus ni malus caché.
  const soloPointsEarned = useMemo(
    () => puzzle.words.reduce((n, w) => n + w.complexity, 0),
    [puzzle.words],
  );

  useEffect(() => {
    if (isSolved) {
      setCelebrating(true);
      playWinSound();
      hapticWin();
    }
  }, [isSolved]);

  // La célébration ne fait plus avancer d'elle-même : elle cède la place à
  // l'écran de résultats, qui attend que tout le monde soit prêt. Avancer
  // automatiquement propulsait un joueur encore en train de lire les scores
  // sur une grille vierge.
  const showRoundResults = useCallback(() => {
    setCelebrating(false);
    setShowResults(true);
    if (soloScored) {
      game.reportGridDone(soloPointsEarned, daily);
      // `soloGridDone` ne rediffuse rien (les points solo ne sont pas un
      // état de salle partagé) : on relit le profil un instant après plutôt
      // que d'attendre un signal que le serveur n'envoie pas.
      setTimeout(() => soloProfile.refresh(), 400);
    }
  }, [daily, soloScored, soloPointsEarned, game, soloProfile]);

  const goToNextRound = useCallback(() => {
    setShowResults(false);
    // `round` rend l'appel idempotent : tous les clients l'émettent en même
    // temps dès que le dernier joueur se déclare prêt.
    advanceRound(round);
  }, [advanceRound, round]);

  const isCellWrong = useCallback(
    (id: string) => game.getLetter(id) !== answerByCellId.get(id),
    [game, answerByCellId],
  );

  // Le joueur choisit LUI-MÊME la case à deviner (sélection = `activeCellId`
  // avant de taper une lettre) : plus de repli automatique vers le mot en
  // cours ou une case au hasard ailleurs dans la grille — ça révélait une
  // case que le joueur n'avait pas demandée, en lui prenant un indice pour
  // rien. Une case déjà juste, ou aucune sélection, ne fait plus rien.
  const hintTarget = activeCellId && isCellWrong(activeCellId) ? activeCellId : null;

  const revealActiveCell = useCallback(() => {
    if (!hintTarget) return;
    const answer = answerByCellId.get(hintTarget);
    if (!answer) return;

    unlockAudio();
    game.revealLetter(hintTarget, answer);
    playCorrectSound();
    hapticTick();
  }, [hintTarget, answerByCellId, game]);

  const activeWordCellIds = activeWordId ? (cellsByWordId.get(activeWordId) ?? []) : [];

  // Définition en cours, reprise en grand au-dessus du clavier.
  const activeWord = useMemo(
    () => puzzle.words.find((w) => w.id === activeWordId) ?? null,
    [puzzle.words, activeWordId],
  );

  // La flèche vit sur la case-indice, pas sur le mot : on la retrouve en
  // cherchant l'entrée qui désigne ce mot.
  const activeArrow = useMemo(() => {
    if (!activeWordId) return null;
    for (const row of puzzle.grid) {
      for (const cell of row) {
        if (cell.type !== 'clue') continue;
        const entry = cell.clues.find((c) => c.wordId === activeWordId);
        if (entry) return entry.arrow ?? entry.direction;
      }
    }
    return null;
  }, [puzzle.grid, activeWordId]);

  const activeFilled = activeWordCellIds.filter((id) => game.getLetter(id)).length;

  // Pour la carte plein écran de la barre de définition : une case par
  // lettre, avec son état verrouillé pour la teinter comme dans la grille.
  const activeWordSlots = activeWordCellIds.map((id) => ({
    ch: game.getLetter(id),
    locked: isCellLocked(id),
  }));

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

  /** Chevrons de la barre de définition : mot précédent/suivant dans l'ordre
   * de la grille — un simple défilement, pas de logique de jeu. */
  const cycleWord = useCallback(
    (delta: number) => {
      if (puzzle.words.length === 0) return;
      const i = puzzle.words.findIndex((w) => w.id === activeWordId);
      const next = puzzle.words[(i + delta + puzzle.words.length) % puzzle.words.length];
      selectWord(next.id);
    },
    [puzzle.words, activeWordId, selectWord],
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

  // Deux régimes de plafond, demandés séparément : en solo/quotidien une
  // monnaie persistante sur le profil (rechargée en jouant) ; en multijoueur
  // classique un plafond fixe par salle, déjà suivi côté serveur — pas
  // besoin d'un fetch supplémentaire pour celui-là.
  const monHintCount = game.scoreboard.find((p) => p.isMe)?.hints ?? 0;
  const hintBudget = soloScored ? (soloProfile.profile?.hintBalance ?? 0) : Math.max(0, 3 - monHintCount);
  const hintsExhausted = soloScored ? (soloProfile.profile?.hintBalance ?? 0) <= 0 : monHintCount >= 3;


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
      {/* Réactions live des autres joueurs — jamais la sienne propre (voir
          GameState.tsx, `sendReaction`) : celle-ci s'anime déjà en local dès
          l'envoi. `pointer-events-none` : purement décoratif, ne doit rien
          intercepter sous les cases de la grille. */}
      <div className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+52px)] z-40 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <AnimatePresence>
          {game.reactions.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: -8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1.5 rounded-full bg-organic-neutral-900/85 py-1 pl-1 pr-3 shadow-md"
            >
              <Avatar name={r.name} color={r.color} size={22} />
              <span className="text-[12px] font-bold text-organic-bg">{r.name}</span>
              <span className="text-[15px]">{r.emoji}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/*
        Conteneur centreur : c'est LUI qui absorbe la hauteur restante. La
        carte, elle, ne doit surtout pas être en `flex-1` — cela l'étirerait
        verticalement et écraserait son ratio (cases mesurées 46x59 au lieu
        de carrées). Elle se dimensionne donc uniquement par son aspect-ratio,
        borné par la hauteur ET la largeur disponibles.

        Les rails encadrent la carte au lieu de la surplomber. Ils vivent DANS
        la zone mesurée, d'où la `reserve` déduite plus haut : la grille se
        recalcule à la largeur qui reste, et pas une case n'est rognée.
      */}
      <div ref={fitRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
        {/* Rangée en `items-stretch` : la carte est le seul élément à hauteur
            propre, les rails s'alignent donc exactement sur elle. */}
        <div className="flex min-w-0 max-w-full items-stretch justify-center gap-2">
        {camps && <ProgressRail camp={camps.mien} />}
        <motion.div
          animate={mounted ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.15 }}
          className="overflow-hidden rounded-[9px] shadow-sm"
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
          className="grid h-full w-full"
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
                return <div key={id} className="bg-organic-neutral-400" />;
              }
              if (cell.type === 'clue') {
                return (
                  <ClueCell
                    key={id}
                    data={cell}
                    cellSize={cellSize}
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
                  isLocked={isCellLocked(id)}
                  lockDelay={lockDelayByCell.get(id) ?? 0}
                  othersHere={othersByCellId.get(id) ?? []}
                  onSelect={() => selectCell(row, col)}
                  lockedColor={game.solvedColorFor(id)}
                  labelBelow={row === 0}
                />
              );
            }),
          )}
          </div>
        </motion.div>
        {camps && <ProgressRail camp={camps.adverse} />}
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center justify-center gap-1.5 px-1">
        <motion.button
          type="button"
          onClick={revealActiveCell}
          disabled={hintsExhausted || !hintTarget}
          whileTap={hintsExhausted || !hintTarget ? undefined : { scale: 0.94 }}
          aria-label="Révéler la case sélectionnée"
          title={
            hintsExhausted
              ? 'Plus d’indice disponible'
              : hintTarget
                ? 'Révéler la case sélectionnée'
                : 'Sélectionnez d’abord une case à deviner'
          }
          className={`shrink-0 rounded-full border border-organic-neutral-400 px-3.5 py-2.5 font-display text-[12px] text-organic-text transition ${
            hintsExhausted || !hintTarget ? 'opacity-40' : 'active:bg-organic-neutral-200'
          }`}
        >
          Indice · {hintBudget}
        </motion.button>

        {/*
          Raccourci de DÉVELOPPEMENT — remplit la grille pour atteindre
          l'écran de fin sans jouer trente mots à la main.

          `import.meta.env.DEV` est remplacé par `false` à la compilation :
          tout ce bloc disparaît du bundle de production, il n'y a donc aucun
          moyen de l'atteindre depuis l'app déployée.

          Il passe par la frappe NORMALE (`setLetter`), pas par une écriture
          directe : les points, la chronologie et les mots trouvés sont donc
          exactement ceux d'une vraie partie — c'est bien le but, tester
          l'écran de résultats avec des données réalistes.
        */}
        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={() => {
              allLetterCells.forEach(({ id, answer }, i) => {
                // Léger décalage : chaque mot obtient un temps distinct dans
                // la chronologie, au lieu de tous tomber au même instant.
                setTimeout(() => {
                  if (game.getLetter(id) !== answer) game.setLetter(id, answer);
                }, i * 25);
              });
            }}
            title="Développement uniquement — absent du bundle de production"
            className="shrink-0 rounded-full border border-dashed border-organic-accent-400 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-organic-accent-700"
          >
            dev · remplir
          </button>
        )}

        <ActiveClueBar
          word={activeWord}
          arrow={activeArrow}
          filled={activeFilled}
          slots={activeWordSlots}
          onPrev={() => cycleWord(-1)}
          onNext={() => cycleWord(1)}
        />
      </div>

      <Keyboard onLetter={handleLetter} onBackspace={handleBackspace} />

      <AnimatePresence>
        {celebrating && <CompletionCelebration onDone={showRoundResults} />}
        {showResults && solo && (
          <SoloRoundResults
            round={round}
            pointsEarned={soloPointsEarned}
            profile={soloProfile.profile}
            onAdvance={goToNextRound}
          />
        )}
        {showResults && !solo && (
          <RoundResults
            round={round}
            daily={daily}
            soloPointsEarned={daily ? soloPointsEarned : undefined}
            words={puzzle.words}
            onAdvance={goToNextRound}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
