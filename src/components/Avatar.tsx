import { avatarPresetFor } from '../lib/avatarPresets';

/**
 * Vignette de joueur : préréglage (emoji + couleur) si `src` en désigne un,
 * ancienne photo uploadée si `src` reste une `data:` URI (profils déjà
 * existants, jamais migrés de force), initiales sinon.
 */
export function Avatar({
  name,
  color,
  src,
  size = 32,
  square = false,
}: {
  name: string;
  color: string;
  src?: string | null;
  size?: number;
  /**
   * Vignette carrée à coins doux plutôt que ronde — « la case comme brique »
   * du design V2 : avatars, code de salon et scores sont tous posés dans des
   * cases carrées, comme celles de la grille. Le rayon suit la taille, à
   * l'identique de la maquette (8px, puis 10px au-delà de 34px).
   */
  square?: boolean;
}) {
  const initials = name.slice(0, 2).toUpperCase();
  const preset = src ? avatarPresetFor(src) : undefined;

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden font-display font-semibold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: preset ? preset.color : color,
        fontSize: Math.round(size * 0.34),
        borderRadius: square ? (size > 34 ? 10 : 8) : 999,
      }}
      title={name}
    >
      {preset ? (
        <span style={{ fontSize: Math.round(size * 0.58) }} aria-hidden="true">
          {preset.emoji}
        </span>
      ) : src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
