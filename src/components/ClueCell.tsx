import type { Arrow, ClueCellData } from '../types/puzzle';

/**
 * Glyphe de chaque flèche. Il porte à lui seul les deux informations : où
 * commence le mot, et dans quel sens il se lit.
 *
 *   ▶  le mot commence à DROITE   et se lit vers la droite
 *   ▼  le mot commence EN DESSOUS et se lit vers le bas
 *   ↳  le mot commence EN DESSOUS et se lit vers la droite  (coudée)
 *   ↴  le mot commence à DROITE   et se lit vers le bas     (coudée)
 */
const ARROW_GLYPH: Record<Arrow, string> = {
  right: '▶',
  down: '▼',
  down_right: '↳',
  right_down: '↴',
};

/**
 * Ordre d'affichage des définitions d'une même case.
 *
 * Elles sont triées selon la case où DÉMARRE leur mot, dans l'ordre de
 * lecture : le mot qui part vers la droite (r, c+1) avant celui qui part vers
 * le bas (r+1, c). Sans ce tri, l'ordre était celui du générateur — arbitraire
 * — et une définition du bas pouvait renvoyer au mot de droite, ce qui rendait
 * l'appariement illisible.
 */
const START_ORDER: Record<Arrow, number> = {
  right: 0,       // le mot commence à droite
  right_down: 0,  // idem, mais se lit vers le bas
  down: 1,        // le mot commence en dessous
  down_right: 1,  // idem, mais se lit vers la droite
};

const BENT: Record<Arrow, boolean> = {
  right: false,
  down: false,
  down_right: true,
  right_down: true,
};

interface ClueCellProps {
  data: ClueCellData;
  /** Côté de la case en pixels — la police s'y rapporte. */
  cellSize: number;
  solvedWordIds: Set<string>;
  activeWordId: string | null;
  onSelectWord: (wordId: string) => void;
}

/**
 * Taille de police, en fraction de la TAILLE DE CASE.
 *
 * Elle était auparavant exprimée en `vw`, donc indexée sur la largeur de
 * l'écran : cela coïncidait avec la case en 8x8, mais plus du tout en 10x10
 * où les cases rétrécissent alors que l'écran ne bouge pas — 40 % des
 * définitions y débordaient. La rapporter à la case rend le réglage valable
 * quelle que soit la taille de grille.
 *
 * Le nombre de définitions compte autant que leur longueur : une case double
 * doit loger deux blocs ET un séparateur, donc à nombre de caractères égal
 * il lui faut une police plus petite.
 */
/**
 * Paliers recalibrés par MESURE RÉELLE plutôt que par estimation : un
 * squelette hors-écran est rendu avec la police candidate, puis comparé
 * (`scrollHeight`/`scrollWidth` vs `clientHeight`/`clientWidth`) pour
 * détecter un dépassement — sur 17 textes réalistes (mot seul jusqu'à deux
 * définitions de ~50 caractères chacune, le pire cas mesuré côté
 * générateur) et 5 tailles de case (32 à 46 px), zéro dépassement avec ces
 * seuils. Les anciens paliers (0.225/0.19/0.175/0.155) débordaient déjà à
 * partir d'un simple « Symbole chimique du bore » (24 caractères, un seul
 * indice) — exactement le style d'indice « facile » explicatif introduit
 * par le dataset v24 (voir HINT_MAX_CHARS côté générateur), donc un cas
 * courant, pas un cas limite.
 */
function fontRatioFor(totalChars: number, clueCount: number): number {
  const budget = totalChars + (clueCount > 1 ? 12 : 0);
  if (budget <= 6) return 0.24;
  if (budget <= 10) return 0.22;
  if (budget <= 16) return 0.19;
  if (budget <= 22) return 0.165;
  if (budget <= 26) return 0.15;
  if (budget <= 32) return 0.14;
  if (budget <= 40) return 0.13;
  if (budget <= 50) return 0.115;
  if (budget <= 65) return 0.1;
  // Au-delà du plus long cas mesuré, continuer à réduire plutôt que
  // plafonner : mieux vaut une police plus petite qu'un texte qui déborde.
  return Math.max(0.08, 0.095 - (budget - 65) * 0.0006);
}

export function ClueCell({
  data,
  cellSize,
  solvedWordIds,
  activeWordId,
  onSelectWord,
}: ClueCellProps) {
  const isDouble = data.clues.length > 1;
  const totalChars = data.clues.reduce((n, c) => n + c.text.length, 0);

  const clues = [...data.clues].sort(
    (a, b) => START_ORDER[a.arrow ?? a.direction] - START_ORDER[b.arrow ?? b.direction],
  );

  return (
    <div
      // `lang` est requis pour que le navigateur applique la césure FRANÇAISE
      // (hyphens:auto sans lang ne coupe rien).
      lang="fr"
      className={[
        'flex h-full w-full flex-col items-center justify-center overflow-hidden',
        'border border-cell-border/50 px-[2px] py-[1px] text-center font-clue font-bold',
        'leading-[1.1] text-organic-neutral-800 hyphens-auto [overflow-wrap:anywhere]',
        isDouble ? 'bg-organic-accent-200' : 'bg-clue',
      ].join(' ')}
      style={{ fontSize: `${(cellSize * fontRatioFor(totalChars, data.clues.length)).toFixed(2)}px` }}
    >
      {clues.map((clue, i) => {
        const solved = solvedWordIds.has(clue.wordId);
        const arrow = clue.arrow ?? clue.direction;
        const active = clue.wordId === activeWordId;
        return (
          // Chaque définition est un bouton : c'est le moyen le plus direct de
          // choisir un mot ET son sens de lecture, notamment pour les mots
          // verticaux qu'on ne pouvait sélectionner qu'en tapant deux fois de
          // suite la même case.
          <button
            key={i}
            type="button"
            onClick={() => onSelectWord(clue.wordId)}
            className={[
              // `text-[1em]` est indispensable : un <button> n'hérite pas de
              // `font-size` (feuille de style du navigateur pour les contrôles
              // de formulaire). Sans lui, le texte restait figé à ~7,2 px
              // pendant que la case dimensionnait sa police — le calcul
              // n'atteignait donc jamais les définitions, et les cases doubles
              // débordaient en 10x10.
              'w-full cursor-pointer rounded-[2px] text-[1em] transition-all duration-200',
              i > 0 ? 'mt-[2px] border-t border-organic-neutral-500/30 pt-[2px]' : '',
              active ? 'bg-white/75 ring-1 ring-organic-accent-500/60' : '',
              solved ? 'text-organic-accent2-700 opacity-50 line-through decoration-organic-accent2-600' : '',
            ].join(' ')}
          >
            {clue.text.toUpperCase()}
            {/*
              La flèche est rendue DANS le flux de sa propre définition, et
              non plus en position absolue sur un bord de la case.

              Deux raisons, mesurées sur les grilles réelles : 39 % des cases
              à deux définitions avaient leurs deux flèches sur le même bord,
              donc superposées ; et même sans superposition, rien n'indiquait
              quelle flèche appartenait à quelle définition — une définition
              semblait alors ne renvoyer à aucun mot.
            */}
            <span
              aria-hidden="true"
              className={[
                'ml-[2px] inline-block align-baseline leading-none',
                BENT[arrow]
                  ? 'text-[1.15em] font-bold text-organic-accent-700'
                  : 'text-[0.9em] text-organic-neutral-600',
              ].join(' ')}
            >
              {ARROW_GLYPH[arrow]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
