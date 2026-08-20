import { getAudioContext, isMuted } from './sounds';

/**
 * Talkie-walkie « appuyer pour parler ».
 *
 * CHOIX DE TRANSPORT : la voix est enregistrée pendant l'appui puis envoyée
 * d'un bloc au relâchement, via le canal de diffusion Liveblocks — et non en
 * flux continu par WebRTC.
 *
 * WebRTC donnerait un direct véritable, mais exige un serveur TURN pour
 * traverser les NAT symétriques des réseaux mobiles ; sans lui, la connexion
 * échoue précisément dans le contexte visé par ce jeu. Le clip différé, lui,
 * passe partout — et colle en fait au geste d'un vrai talkie-walkie : on
 * parle, on relâche, l'autre entend.
 *
 * Contrepartie assumée : l'écoute démarre au relâchement, pas pendant.
 */

/** Au-delà, le message devient long à transmettre et lourd à découper. */
const MAX_DURATION_MS = 10_000;

/** Taille d'un morceau diffusé. Les événements Liveblocks doivent rester petits. */
const CHUNK_SIZE = 12_000;

function pickMimeType(): string | undefined {
  // Chrome/Firefox produisent du webm/opus, Safari du mp4/aac : on prend ce
  // que le navigateur sait faire plutôt que d'imposer un format.
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
}

export interface Recording {
  stop: () => Promise<{ base64: string; mime: string } | null>;
  cancel: () => void;
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const mime = pickMimeType();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24_000 } : undefined);
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) parts.push(e.data);
  };
  recorder.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());
  const guard = setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop();
  }, MAX_DURATION_MS);

  return {
    cancel: () => {
      clearTimeout(guard);
      if (recorder.state === 'recording') recorder.stop();
      release();
    },
    stop: () =>
      new Promise((resolve) => {
        clearTimeout(guard);
        if (recorder.state !== 'recording') {
          release();
          resolve(null);
          return;
        }
        recorder.onstop = async () => {
          release();
          const blob = new Blob(parts, { type: recorder.mimeType });
          if (blob.size === 0) {
            resolve(null);
            return;
          }
          const buffer = await blob.arrayBuffer();
          resolve({ base64: toBase64(buffer), mime: recorder.mimeType });
        };
        recorder.stop();
      }),
  };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Par tranches : passer tout le tableau à String.fromCharCode d'un coup
  // dépasse la limite d'arguments sur un message de quelques secondes.
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function splitIntoChunks(base64: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
    out.push(base64.slice(i, i + CHUNK_SIZE));
  }
  return out;
}

/** Courbe de saturation douce : donne le grain « haut-parleur » sans rendre inaudible. */
function makeDistortionCurve(amount = 12): Float32Array<ArrayBuffer> {
  const n = 256;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * Math.PI) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/** Petit souffle de squelch, avant et après le message. */
function squelch(ctx: AudioContext, at: number, duration = 0.07): void {
  const frames = Math.floor(ctx.sampleRate * duration);
  const noise = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * 0.35;

  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  src.connect(band).connect(gain).connect(ctx.destination);
  src.start(at);
  src.stop(at + duration);
}

/**
 * Joue un message avec l'effet radio : bande passante étroite façon
 * téléphone/talkie, légère saturation, et squelch de part et d'autre.
 */
export async function playRadioClip(base64: string): Promise<void> {
  // La sourdine du jeu coupe aussi la voix : c'est le même bouton pour tout.
  if (isMuted()) return;

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(fromBase64(base64));
  } catch {
    return; // format illisible par ce navigateur : on ignore plutôt que planter
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 420;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2900;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve();
  shaper.oversample = '2x';

  const gain = ctx.createGain();
  gain.gain.value = 0.9;

  src.connect(highpass).connect(lowpass).connect(shaper).connect(gain).connect(ctx.destination);

  const start = ctx.currentTime + 0.09;
  squelch(ctx, ctx.currentTime);
  src.start(start);
  squelch(ctx, start + buffer.duration + 0.02);
}
