/**
 * Fixed, decorative gradient-blob backdrop. Pure CSS transforms (no JS per
 * frame), so it's cheap on mobile GPUs; prefers-reduced-motion freezes it
 * via the global rule in index.css.
 */
export function AuroraBackground() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden bg-[#3D1F63]">
      <div className="absolute inset-0 bg-gradient-to-br from-[#3D1F63] via-[#7A2F77] to-[#FF8A5B]" />
      <div className="absolute -left-1/4 -top-1/4 h-[70vmax] w-[70vmax] animate-blob-float-a rounded-full bg-aurora-magenta/50 blur-[90px]" />
      <div className="absolute -right-1/3 top-1/4 h-[60vmax] w-[60vmax] animate-blob-float-b rounded-full bg-aurora-coral/40 blur-[100px]" />
      <div className="absolute bottom-[-20vmax] left-1/4 h-[65vmax] w-[65vmax] animate-blob-float-c rounded-full bg-aurora-amber/30 blur-[110px]" />
      <div className="absolute inset-0 bg-black/10" />
    </div>
  );
}
