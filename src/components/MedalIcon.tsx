/**
 * Pictogrammes des médailles — remplace les émojis Unicode génériques par
 * des glyphes maison, dans le même esprit que le reste du système Organic
 * (formes pleines, aucun dégradé). `currentColor` partout : la couleur suit
 * celle du texte du badge qui l'entoure (obtenue/verrouillée), pas de
 * logique de couleur ici.
 *
 * Les paliers solo (Bronze…Archimage) restent en émoji pour l'instant —
 * uniquement les médailles sont concernées par ce remplacement.
 */

function Flag() {
  return (
    <>
      <line x1="24" y1="46" x2="24" y2="20" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M24 21 L42 26 L24 32 Z" fill="currentColor" />
    </>
  );
}

function Podium() {
  return (
    <>
      <rect x="18" y="34" width="9" height="12" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="28" y="24" width="9" height="22" rx="1.5" fill="currentColor" />
      <rect x="38" y="30" width="9" height="16" rx="1.5" fill="currentColor" opacity="0.8" />
    </>
  );
}

function Laurel() {
  const leaves = [-1, 1].flatMap((side) =>
    [0, 1, 2].map((i) => {
      const y = 26 + i * 7;
      const x = 32 + side * (10 - i);
      return (
        <ellipse
          key={`${side}-${i}`}
          cx={x}
          cy={y}
          rx="5"
          ry="2.6"
          fill="currentColor"
          opacity={0.9 - i * 0.15}
          transform={`rotate(${side * (30 - i * 6)} ${x} ${y})`}
        />
      );
    }),
  );
  return (
    <>
      {leaves}
      <line x1="32" y1="22" x2="32" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

function Book() {
  return (
    <>
      <path d="M32 24 C28 21 22 21 19 23 V42 C22 40 28 40 32 43 Z" fill="currentColor" opacity="0.85" />
      <path d="M32 24 C36 21 42 21 45 23 V42 C42 40 36 40 32 43 Z" fill="currentColor" />
    </>
  );
}

function BookStack({ count }: { count: number }) {
  const widths = [22, 18, 14, 20, 16];
  const start = 44;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const w = widths[i % widths.length];
        return (
          <rect
            key={i}
            x={32 - w / 2}
            y={start - i * 6}
            width={w}
            height="6"
            rx="2"
            fill="currentColor"
            opacity={1 - i * 0.14}
          />
        );
      })}
    </>
  );
}

function Sun({ rays }: { rays: number }) {
  return (
    <>
      <circle cx="32" cy="32" r="9" fill="currentColor" />
      {Array.from({ length: rays }, (_, i) => {
        const angle = (360 / rays) * i;
        return (
          <line
            key={i}
            x1="32"
            y1="15"
            x2="32"
            y2="20"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            transform={`rotate(${angle} 32 32)`}
          />
        );
      })}
    </>
  );
}

function Target({ arrow }: { arrow: boolean }) {
  return (
    <>
      <circle cx="32" cy="32" r="13" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="32" r="7.5" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="32" r="2.6" fill="currentColor" />
      {arrow && (
        <>
          <line x1="46" y1="18" x2="33" y2="31" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M46 18 L40 17.5 L46.5 24 Z" fill="currentColor" />
        </>
      )}
    </>
  );
}

function Sprout() {
  return (
    <>
      <path d="M32 44 V28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M32 32 C26 32 23 27 24 21 C30 22 33 27 32 32 Z" fill="currentColor" />
      <path d="M32 36 C38 36 41 31 40 25 C34 26 31 31 32 36 Z" fill="currentColor" opacity="0.85" />
      <ellipse cx="32" cy="45" rx="8" ry="2.4" fill="currentColor" opacity="0.5" />
    </>
  );
}

function Hourglass() {
  return (
    <>
      <path d="M22 18 H42 L32 32 Z" fill="currentColor" />
      <path d="M22 46 H42 L32 32 Z" fill="currentColor" opacity="0.85" />
      <line x1="20" y1="18" x2="44" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="20" y1="46" x2="44" y2="46" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

const GLYPHS: Record<string, () => JSX.Element> = {
  first_win: Flag,
  win_10: Podium,
  win_50: Laurel,
  words_100: Book,
  words_1000: () => <BookStack count={3} />,
  daily_7: () => <Sun rays={7} />,
  no_hint: () => <Target arrow={false} />,
  ermite: Sprout,
  increvable: Hourglass,
  perfectionniste: () => <Target arrow />,
  fidele: () => <Sun rays={12} />,
  encyclopediste: () => <BookStack count={5} />,
};

export function MedalIcon({ id, className }: { id: string; className?: string }) {
  const Glyph = GLYPHS[id];
  if (!Glyph) return null;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <Glyph />
    </svg>
  );
}
