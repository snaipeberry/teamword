import { useEffect, useState } from 'react';
import { isMuted, onMuteChange, toggleMuted } from '../lib/sounds';

export function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted);

  useEffect(() => onMuteChange(setMutedState), []);

  return (
    <button
      type="button"
      onClick={() => toggleMuted()}
      aria-label={muted ? 'Activer le son' : 'Couper le son'}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition active:scale-90"
    >
      <span className="text-base" aria-hidden="true">
        {muted ? '🔇' : '🔊'}
      </span>
    </button>
  );
}
