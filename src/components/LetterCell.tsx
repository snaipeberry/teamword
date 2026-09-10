import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { PlayerCursor } from '../state/GameState';

interface LetterCellProps {
  value: string;
  isActive: boolean;
  isInActiveWord: boolean;
  isLocked: boolean;
  lockDelay: number;
  othersHere: PlayerCursor[];
  onSelect: () => void;
  /** Duel classé uniquement : couleur du joueur qui a trouvé ce mot — la
   *  case verrouillée se teinte à SA couleur plutôt que le sauge générique,
   *  pour distinguer d'un coup d'œil qui a trouvé quoi. */
  lockedColor?: string | null;
  /**
   * Onde de fin de grille : délai, en secondes, avant que cette case ne
   * s'allume. `null` hors célébration. Distinct de `lockDelay`, qui court le
   * long d'un seul mot — ici la vague part de la dernière case remplie et
   * traverse toute la grille.
   */
  waveDelay?: number | null;
  /** Dernière case vide du mot en cours : elle respire, on sent le mot sur le
   *  point de tomber avant même d'avoir tapé la lettre. */
  isLastEmpty?: boolean;
  /** Coordonnées, uniquement pour l'énoncer : une case ne se nommait que par
   *  sa lettre, ce qui donnait « K, bouton » et rien d'autre — impossible de
   *  se situer dans la grille sans la voir. */
  row: number;
  col: number;
  /** Définition du mot en cours, quand cette case en fait partie. */
  wordLabel?: string | null;
}

export function LetterCell({
  value,
  isActive,
  isInActiveWord,
  isLocked,
  lockDelay,
  othersHere,
  onSelect,
  lockedColor,
  waveDelay = null,
  isLastEmpty = false,
  row,
  col,
  wordLabel = null,
}: LetterCellProps) {
  const [showLockFlash, setShowLockFlash] = useState(false);
  const [showWave, setShowWave] = useState(false);
  // Les effets qui respirent en boucle sont les premiers à gêner : on les
  // coupe net quand le système demande moins de mouvement.
  const moinsDeMouvement = useReducedMotion();

  // isLocked only ever flips false -> true (a found word never becomes unsolved),
  // so this effect fires exactly once per cell: the moment it locks.
  useEffect(() => {
    if (!isLocked) return;
    const start = setTimeout(() => setShowLockFlash(true), lockDelay * 1000);
    const end = setTimeout(() => setShowLockFlash(false), lockDelay * 1000 + 550);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  // La grille se referme d'un seul geste avant que les confettis ne la
  // recouvrent : chaque case s'allume à son tour, en partant de la dernière
  // remplie (voir `waveDelayByCell` dans CrosswordGrid).
  useEffect(() => {
    if (waveDelay == null) {
      setShowWave(false);
      return;
    }
    const debut = setTimeout(() => setShowWave(true), waveDelay * 1000);
    const fin = setTimeout(() => setShowWave(false), waveDelay * 1000 + 420);
    return () => {
      clearTimeout(debut);
      clearTimeout(fin);
    };
  }, [waveDelay]);

  /**
   * Curseurs des AUTRES joueurs : un liseré à leur couleur, en calque animé
   * plutôt qu'en `box-shadow` sur la case.
   *
   * Le calque permet le fondu à l'arrivée et la respiration lente — un
   * liseré qui apparaît d'un coup et se téléporte de case en case donne un
   * adversaire mécanique, là où une présence doit se sentir habitée. Le sien
   * reste en `box-shadow` : il ne bouge pas, il n'a rien à raconter.
   *
   * Chacun se décale de deux pixels vers l'intérieur, le sien d'abord : deux
   * curseurs sur la même case restent lisibles au lieu de se recouvrir.
   */
  const autres = othersHere.slice(0, 2);
  const decalageDe = (i: number) => (isActive ? 2 : 0) + i * 2;

  /**
   * Ce que la case dit d'elle-même.
   *
   * Dans l'ordre où l'information sert : où l'on est, ce qu'il y a dedans,
   * si c'est encore modifiable, et à quel mot ça appartient. Sans cela, un
   * lecteur d'écran énonçait la lettre seule — soit rien d'exploitable pour
   * remplir des mots croisés.
   */
  const nomAccessible = [
    `Ligne ${row + 1}, colonne ${col + 1}`,
    value ? `lettre ${value}` : 'vide',
    isLocked ? 'mot trouvé' : null,
    isInActiveWord && wordLabel ? `mot en cours : ${wordLabel}` : null,
    autres.length > 0 ? `${autres.map((a) => a.name).join(' et ')} ${autres.length > 1 ? 'sont' : 'est'} sur cette case` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const background =
    isLocked && !lockedColor
      ? 'bg-organic-accent2-200'
      : isLocked
        ? '' // teinte posée en style inline ci-dessous
        : isActive
          ? 'bg-white'
          : isInActiveWord
            ? 'bg-organic-accent-100'
            : 'bg-organic-neutral-100';

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-label={nomAccessible}
      aria-pressed={isActive}
      aria-disabled={isLocked}
      whileTap={isLocked ? undefined : { scale: 0.88 }}
      animate={isLastEmpty && !moinsDeMouvement ? { opacity: [1, 0.62, 1] } : { opacity: 1 }}
      transition={
        isLastEmpty && !moinsDeMouvement
          ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.35 }
      }
      style={{
        ...(isActive ? { boxShadow: 'inset 0 0 0 2px #D67F48' } : null),
        ...(!isActive && isLocked && lockedColor ? { backgroundColor: `${lockedColor}2E` } : null),
      }}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden border border-cell-border/70 font-grid text-[clamp(1rem,5.5vw,1.5rem)] font-semibold uppercase transition-colors duration-300 ${background} ${
        isLocked ? 'cursor-default' : ''
      }`}
    >
      {isActive && !isLocked && (
        <span aria-hidden="true" className="absolute -left-1 top-1/2 -translate-y-1/2 text-[10px] text-organic-accent-700">
          ▶
        </span>
      )}

      <AnimatePresence>
        {autres.map((autre, i) => (
          <motion.span
            key={autre.connectionId}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={moinsDeMouvement ? { opacity: 1 } : { opacity: [0.55, 1, 0.55] }}
            exit={{ opacity: 0 }}
            transition={
              moinsDeMouvement
                ? { duration: 0.2 }
                : { opacity: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }, default: { duration: 0.25 } }
            }
            className="pointer-events-none absolute z-[6]"
            style={{
              inset: `${decalageDe(i)}px`,
              boxShadow: `inset 0 0 0 2px ${autre.color}`,
            }}
          />
        ))}
        {showWave && (
          <motion.span
            key="onde"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.75, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.42, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-0 bg-organic-accent2-400"
          />
        )}
        {showLockFlash && (
          <motion.span
            key="verrou"
            aria-hidden="true"
            initial={{ scale: 0.6, opacity: 0.85 }}
            animate={{ scale: 1.8, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className={`pointer-events-none absolute inset-0 ${lockedColor ? '' : 'bg-organic-accent2-400'}`}
            style={lockedColor ? { backgroundColor: lockedColor } : undefined}
          />
        )}
      </AnimatePresence>

      <motion.span
        key={value}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        // Sauge UNIQUEMENT quand le mot entier est trouvé. Colorer une lettre
        // dès qu'elle est juste individuellement révélait la réponse au fur et
        // à mesure de la saisie.
        aria-hidden="true"
        className={`relative z-10 ${
          isLocked && !lockedColor ? 'text-organic-accent2-900' : !isLocked ? 'text-organic-text' : ''
        }`}
        style={isLocked && lockedColor ? { color: lockedColor } : undefined}
      >
        {value}
      </motion.span>
    </motion.button>
  );
}
