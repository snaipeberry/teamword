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
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
        muted ? 'bg-organic-neutral-200 text-organic-neutral-500' : 'bg-organic-neutral-200 text-organic-text'
      }`}
    >
      {/* Pastille pleine/creuse plutôt qu'un pictogramme : « pas d'émoji ». */}
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 rounded-full ${muted ? 'border border-organic-neutral-500' : 'bg-organic-accent-500'}`}
      />
    </button>
  );
}
