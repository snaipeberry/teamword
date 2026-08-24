/** Vignette de joueur : photo si elle existe, initiales sinon. */
export function Avatar({
  name,
  color,
  src,
  size = 32,
}: {
  name: string;
  color: string;
  src?: string | null;
  size?: number;
}) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-semibold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: Math.round(size * 0.34),
      }}
      title={name}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
