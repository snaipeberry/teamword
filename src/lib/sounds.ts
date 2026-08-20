// Short procedurally-generated tones via Web Audio — works out of the box with
// no binary audio assets to ship or go missing. Howler (already a dependency)
// stays ready below for when you drop in real sound-designed files, e.g. an
// ambient loop or polished SFX — see the example at the bottom.

const MUTE_STORAGE_KEY = 'mf_muted';

let muted = localStorage.getItem(MUTE_STORAGE_KEY) === '1';
const muteListeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  localStorage.setItem(MUTE_STORAGE_KEY, next ? '1' : '0');
  muteListeners.forEach((listener) => listener(next));
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** For components that want to re-render on mute changes (e.g. the toggle button icon). */
export function onMuteChange(listener: (muted: boolean) => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

/**
 * Vibration API — Android Chrome supports it, iOS Safari never has (Apple hasn't
 * implemented it, even in recent versions), so this silently no-ops there. Kept
 * as progressive enhancement rather than a real cross-platform haptics guarantee.
 */
export function vibrate(pattern: number | number[]): void {
  if (muted) return;
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

let audioCtx: AudioContext | null = null;

/** Partagé avec le talkie-walkie : les navigateurs limitent le nombre d'AudioContext. */
export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

/** iOS Safari suspends the AudioContext until a user gesture unlocks it — call this on the first tap. */
export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  delay = 0,
  peakGain = 0.15,
): void {
  if (muted) return;
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = type;
  osc.frequency.value = frequency;

  const start = ctx.currentTime + delay;
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(peakGain, start + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playCorrectSound(): void {
  playTone(880, 0.12, 'sine');
}

export function playWrongSound(): void {
  playTone(160, 0.18, 'sawtooth', 0, 0.1);
}

export function playTickSound(): void {
  playTone(1200, 0.04, 'square', 0, 0.05);
}

export function playWinSound(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => playTone(freq, 0.22, 'triangle', i * 0.09, 0.12));
}

/** Short two-note chime for a single word being completed — distinct from the full-grid win fanfare. */
export function playWordFoundSound(): void {
  const notes = [659.25, 987.77]; // E5, B5
  notes.forEach((freq, i) => playTone(freq, 0.16, 'triangle', i * 0.08, 0.13));
}

export function hapticTick(): void {
  vibrate(8);
}

export function hapticWrong(): void {
  vibrate([30, 40, 30]);
}

export function hapticWordFound(): void {
  vibrate([15, 30, 40]);
}

export function hapticWin(): void {
  vibrate([20, 40, 20, 40, 20, 40, 90]);
}

// --- Howler, ready for real sound-designed audio ---
//
// import { Howl } from 'howler';
//
// export const backgroundMusic = new Howl({
//   src: ['/sounds/ambient.mp3'],
//   loop: true,
//   volume: 0.3,
// });
