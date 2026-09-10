// Sons courts synthétisés en Web Audio : aucun fichier binaire à embarquer,
// donc rien à charger ni à perdre. Howler reste une dépendance du projet et
// attend en bas de fichier le jour où de vrais sons travaillés remplaceront
// deux ou trois de ces voix (victoire, appariement) — voir l'exemple final.
import { isNative } from './native';

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
 *
 * Sous Capacitor natif, on bascule sur @capacitor/haptics (import dynamique :
 * inutile de charger un module natif quand on tourne dans un navigateur
 * normal) — le vrai moteur haptique du téléphone, là où l'API Vibration ne
 * faisait déjà rien sur iOS. `pattern` (impulsions en ms) se traduit en une
 * intensité d'impact plutôt qu'une reproduction exacte : l'API native ne
 * prend pas de motif arbitraire, mais un simple impact léger/moyen/fort est
 * ce qui « sent » natif — reproduire le motif web n'apporterait rien.
 */
export function vibrate(pattern: number | number[]): void {
  if (muted) return;
  if (isNative) {
    void nativeImpact(pattern);
    return;
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

async function nativeImpact(pattern: number | number[]): Promise<void> {
  const total = Array.isArray(pattern) ? pattern.reduce((n, ms) => n + ms, 0) : pattern;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  const style = total >= 100 ? ImpactStyle.Heavy : total >= 30 ? ImpactStyle.Medium : ImpactStyle.Light;
  await Haptics.impact({ style }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Bus audio
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;

/** Un seul AudioContext partagé : les navigateurs en limitent le nombre. */
export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

/**
 * Sortie commune de TOUTES les voix : gain maître puis compresseur.
 *
 * Sans lui, chaque son se branchait directement sur la sortie : quand
 * plusieurs se superposent — une fanfare pendant qu'un carillon tombe et
 * qu'on tape encore — les amplitudes s'additionnent et saturent en craquant.
 * Le compresseur ramène les crêtes, le gain maître laisse de la marge sous
 * le plafond numérique. Tout ce qui suit passe par ici, sans exception.
 */
function bus(): GainNode {
  if (master) return master;
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 22;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  gain.connect(comp);
  comp.connect(ctx.destination);
  master = gain;
  return master;
}

/** iOS Safari suspends the AudioContext until a user gesture unlocks it — call this on the first tap. */
export function unlockAudio(): void {
  const ctx = getAudioContext();
  bus();
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
}

// ---------------------------------------------------------------------------
// Voix élémentaires
// ---------------------------------------------------------------------------

interface VoixOptions {
  /** Hauteur en hertz. */
  freq: number;
  /** Durée jusqu'à l'extinction, en secondes. */
  duration: number;
  type?: OscillatorType;
  /** Retard avant l'attaque — sert à écrire des motifs sans minuteur JS. */
  delay?: number;
  /** Crête de volume, 0 → 1. La somme de ce qui joue en même temps doit
   *  rester raisonnable ; le compresseur rattrape le reste. */
  gain?: number;
  /** Montée, en secondes. Court = percussif, long = soufflé. */
  attack?: number;
  /** Désaccord en cents — deux voix légèrement désaccordées épaississent. */
  detune?: number;
  /** Glissando : hauteur d'arrivée. */
  glideTo?: number;
  /** Passe-bas, pour adoucir une onde riche (square, sawtooth). */
  lowpass?: number;
}

function playVoice({
  freq,
  duration,
  type = 'sine',
  delay = 0,
  gain = 0.14,
  attack = 0.008,
  detune = 0,
  glideTo,
  lowpass,
}: VoixOptions): void {
  if (muted) return;
  const ctx = getAudioContext();
  const sortie = bus();
  const osc = ctx.createOscillator();
  const enveloppe = ctx.createGain();

  osc.type = type;
  osc.detune.value = detune;

  const debut = ctx.currentTime + delay;
  osc.frequency.setValueAtTime(freq, debut);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), debut + duration);

  enveloppe.gain.setValueAtTime(0, debut);
  enveloppe.gain.linearRampToValueAtTime(gain, debut + attack);
  enveloppe.gain.exponentialRampToValueAtTime(0.0001, debut + duration);

  let dernier: AudioNode = enveloppe;
  if (lowpass) {
    const filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = lowpass;
    enveloppe.connect(filtre);
    dernier = filtre;
  }

  osc.connect(enveloppe);
  dernier.connect(sortie);
  osc.start(debut);
  osc.stop(debut + duration + 0.05);
}

/**
 * Souffle filtré — le grain qu'aucun oscillateur ne donne.
 *
 * C'est ce qui distingue un « toc » d'un « bip » : les sons de contact
 * (frappe, tap, pop) sont d'abord un bruit très court, la hauteur ne venant
 * qu'en renfort.
 */
function playNoise({
  duration,
  gain = 0.1,
  delay = 0,
  bandpass = 1800,
  q = 1.2,
}: {
  duration: number;
  gain?: number;
  delay?: number;
  bandpass?: number;
  q?: number;
}): void {
  if (muted) return;
  const ctx = getAudioContext();
  const sortie = bus();
  const echantillons = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const tampon = ctx.createBuffer(1, echantillons, ctx.sampleRate);
  const donnees = tampon.getChannelData(0);
  for (let i = 0; i < echantillons; i += 1) donnees[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = tampon;

  const filtre = ctx.createBiquadFilter();
  filtre.type = 'bandpass';
  filtre.frequency.value = bandpass;
  filtre.Q.value = q;

  const enveloppe = ctx.createGain();
  const debut = ctx.currentTime + delay;
  enveloppe.gain.setValueAtTime(gain, debut);
  enveloppe.gain.exponentialRampToValueAtTime(0.0001, debut + duration);

  source.connect(filtre);
  filtre.connect(enveloppe);
  enveloppe.connect(sortie);
  source.start(debut);
}

/**
 * Gamme pentatonique majeure.
 *
 * N'importe quelle suite de degrés y sonne juste : on peut donc faire monter
 * un motif au fil d'une série sans jamais fausser, ce qu'une gamme complète
 * ne permet pas sans y réfléchir à chaque degré.
 */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

const degre = (i: number): number => PENTA[Math.min(Math.max(i, 0), PENTA.length - 1)];

// ---------------------------------------------------------------------------
// La frappe
// ---------------------------------------------------------------------------

/**
 * Lettre posée dans la grille.
 *
 * La hauteur varie de quelques cents à chaque frappe : cent fois la même
 * note dans une partie finit par sonner comme une machine à écrire cassée,
 * alors qu'un même son légèrement mouvant reste vivant.
 */
export function playCorrectSound(): void {
  const ecart = (Math.random() - 0.5) * 60;
  playNoise({ duration: 0.022, gain: 0.05, bandpass: 2600, q: 0.9 });
  playVoice({ freq: 880, duration: 0.11, type: 'sine', gain: 0.11, detune: ecart });
}

/** Case sélectionnée : un clic sec, franchement plus court que la frappe. */
export function playTickSound(): void {
  playNoise({ duration: 0.014, gain: 0.05, bandpass: 3200, q: 1.6 });
  playVoice({ freq: 1200, duration: 0.035, type: 'square', gain: 0.028, lowpass: 2600 });
}

/** Touche du clavier : plus mat que la grille — le geste et son résultat ne
 *  doivent pas sonner pareil, sinon on ne sait plus ce qu'on entend. */
export function playKeySound(): void {
  playNoise({ duration: 0.03, gain: 0.055, bandpass: 900, q: 0.8 });
  playVoice({ freq: 320, duration: 0.05, type: 'sine', gain: 0.05 });
}

/** Carte de mode, bouton d'accueil : le même bois, une octave plus bas. */
export function playTapSound(): void {
  playNoise({ duration: 0.035, gain: 0.06, bandpass: 620, q: 0.7 });
  playVoice({ freq: 190, duration: 0.07, type: 'sine', gain: 0.06 });
}

/**
 * Action refusée : code de partie invalide, plus d'indice, pseudo inconnu.
 *
 * Surtout PAS « mauvaise lettre » : ce jeu ne vérifie rien pendant la saisie,
 * c'est un choix assumé. Un son de faute sur une lettre le contredirait.
 */
export function playWrongSound(): void {
  playVoice({ freq: 220, duration: 0.14, type: 'sine', gain: 0.09, glideTo: 150 });
  playVoice({ freq: 221, duration: 0.14, type: 'sine', gain: 0.06, delay: 0.05, glideTo: 148 });
}

// ---------------------------------------------------------------------------
// Le mot trouvé
// ---------------------------------------------------------------------------

/** Deux mots trouvés à moins de ce délai s'enchaînent : la série monte. */
const SERIE_FENETRE_MS = 8000;
const SERIE_MAX = 5;

let serie = 0;
let dernierMotAt = 0;

/**
 * Mot complété.
 *
 * Le carillon monte d'un degré à chaque mot trouvé dans la foulée du
 * précédent, puis retombe après une pause : une bonne passe s'entend au lieu
 * de se compter. C'est le compteur, et non la synthèse, qui fait tout le
 * travail — d'où le coût quasi nul de l'effet.
 */
export function playWordFoundSound(): void {
  const maintenant = Date.now();
  serie = maintenant - dernierMotAt <= SERIE_FENETRE_MS ? Math.min(serie + 1, SERIE_MAX) : 0;
  dernierMotAt = maintenant;

  playVoice({ freq: degre(2 + serie), duration: 0.15, type: 'triangle', gain: 0.12 });
  playVoice({ freq: degre(4 + serie), duration: 0.19, type: 'triangle', gain: 0.11, delay: 0.075 });
}

/** Niveau de série en cours (0 = premier mot) — l'écran s'en sert pour
 *  accompagner visuellement ce que l'oreille entend déjà. */
export function currentStreak(): number {
  return serie;
}

/** Remise à zéro entre deux grilles : une nouvelle manche ne doit pas
 *  hériter de l'élan de la précédente. */
export function resetStreak(): void {
  serie = 0;
  dernierMotAt = 0;
}

/**
 * Un ADVERSAIRE vient de prendre un mot.
 *
 * Même motif, une octave plus bas et deux fois plus discret : on sait qui a
 * marqué à l'oreille, sans quitter sa propre grille des yeux. C'est le
 * registre, et non le volume seul, qui porte l'information.
 */
export function playRivalWordSound(): void {
  playVoice({ freq: degre(2) / 2, duration: 0.16, type: 'triangle', gain: 0.06 });
  playVoice({ freq: degre(4) / 2, duration: 0.2, type: 'triangle', gain: 0.055, delay: 0.075 });
}

/**
 * Changement de tête : on vient de passer devant, ou derrière.
 *
 * La seule information que le score ne donne pas au moment où elle compte.
 * Motif court et tendu, monté ou descendu selon le sens — deux voix
 * légèrement désaccordées pour la tension.
 */
export function playLeadChangeSound(enTete: boolean): void {
  const notes = enTete ? [degre(3), degre(5), degre(7)] : [degre(5), degre(3), degre(1)];
  notes.forEach((freq, i) => {
    playVoice({ freq, duration: 0.16, type: 'triangle', gain: 0.1, delay: i * 0.055 });
    playVoice({ freq, duration: 0.16, type: 'sine', gain: 0.05, delay: i * 0.055, detune: enTete ? 8 : -14 });
  });
}

/** Réaction reçue (emoji) : un « pop » léger, sans hauteur marquée. */
export function playReactionSound(): void {
  playNoise({ duration: 0.03, gain: 0.06, bandpass: 1400, q: 1.4 });
  playVoice({ freq: 520, duration: 0.09, type: 'sine', gain: 0.07, glideTo: 900 });
}

// ---------------------------------------------------------------------------
// Fins de manche et de match
// ---------------------------------------------------------------------------

/** Grille entièrement remplie. */
export function playWinSound(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) =>
    playVoice({ freq, duration: 0.24, type: 'triangle', gain: 0.11, delay: i * 0.085 }),
  );
}

/**
 * Duel gagné — délibérément différente de la fanfare de grille terminée :
 * gagner contre quelqu'un ne doit pas sonner comme finir une grille seul.
 * Une montée en accord plein, avec une octave qui s'ouvre à la fin.
 */
export function playVictorySound(): void {
  const accord = [
    [392, 0], [493.88, 0.06], [587.33, 0.12], // G4 B4 D5
    [523.25, 0.3], [659.25, 0.36], [783.99, 0.42], [1046.5, 0.48], // C5 E5 G5 C6
  ] as const;
  accord.forEach(([freq, delay]) =>
    playVoice({ freq, duration: 0.55, type: 'triangle', gain: 0.09, delay, attack: 0.012 }),
  );
  playVoice({ freq: 130.81, duration: 0.9, type: 'sine', gain: 0.07, delay: 0.3 });
}

/**
 * Duel perdu. Figure descendante courte, chaude, qui se pose sur une note
 * tenue. Jamais un buzzer : on a perdu un duel, on n'a pas commis de faute.
 */
export function playDefeatSound(): void {
  const notes = [698.46, 587.33, 466.16]; // F5 D5 Bb4
  notes.forEach((freq, i) =>
    playVoice({ freq, duration: 0.3, type: 'triangle', gain: 0.09, delay: i * 0.13 }),
  );
  playVoice({ freq: 174.61, duration: 1.1, type: 'sine', gain: 0.075, delay: 0.36, attack: 0.06 });
}

/** Égalité : deux notes à la même hauteur. Ni récompense ni sanction, ce qui
 *  est exactement le résultat. */
export function playDrawSound(): void {
  playVoice({ freq: 523.25, duration: 0.26, type: 'triangle', gain: 0.09 });
  playVoice({ freq: 523.25, duration: 0.34, type: 'triangle', gain: 0.08, delay: 0.2 });
}

/** Compteur qui défile sur l'écran de fin : un tic très discret par cran. */
export function playCountUpTick(): void {
  playVoice({ freq: 1500, duration: 0.025, type: 'square', gain: 0.018, lowpass: 3000 });
}

/** L'adversaire propose la revanche. */
export function playRematchSound(): void {
  playVoice({ freq: degre(3), duration: 0.14, type: 'triangle', gain: 0.08 });
  playVoice({ freq: degre(6), duration: 0.2, type: 'triangle', gain: 0.075, delay: 0.09 });
}

// ---------------------------------------------------------------------------
// Chrono
// ---------------------------------------------------------------------------

/**
 * Un tic par seconde sur les dix dernières, montant en hauteur jusqu'à zéro.
 * C'est ce qui transforme une fin de match en fin de match.
 */
export function playChronoTick(secondesRestantes: number): void {
  const t = Math.min(Math.max(10 - secondesRestantes, 0), 10) / 10;
  playVoice({ freq: 760 + t * 520, duration: 0.05, type: 'square', gain: 0.05, lowpass: 3400 });
}

/** Une minute restante : un seul repère. Assez pour lever les yeux, pas
 *  assez pour paniquer. */
export function playMinuteWarningSound(): void {
  playVoice({ freq: 440, duration: 0.22, type: 'sine', gain: 0.07 });
  playVoice({ freq: 587.33, duration: 0.26, type: 'sine', gain: 0.06, delay: 0.13 });
}

// ---------------------------------------------------------------------------
// Salon, appariement, progression
// ---------------------------------------------------------------------------

/** Quelqu'un rejoint le salon : deux notes chaudes, et l'hôte lève les yeux. */
export function playPeerJoinSound(): void {
  playVoice({ freq: degre(1), duration: 0.16, type: 'triangle', gain: 0.085 });
  playVoice({ freq: degre(4), duration: 0.22, type: 'triangle', gain: 0.08, delay: 0.085 });
}

/** Quelqu'un s'en va. Le miroir exact, à l'envers. */
export function playPeerLeaveSound(): void {
  playVoice({ freq: degre(4), duration: 0.16, type: 'triangle', gain: 0.06 });
  playVoice({ freq: degre(1), duration: 0.22, type: 'triangle', gain: 0.055, delay: 0.085 });
}

/** Battement de la recherche d'adversaire : très grave, très faible.
 *  L'attente devient une attente au lieu d'un écran arrêté. */
export function playSearchPulseSound(): void {
  playVoice({ freq: 98, duration: 0.4, type: 'sine', gain: 0.045, attack: 0.05 });
}

/** Adversaire trouvé : figure montante, franche. */
export function playMatchFoundSound(): void {
  [degre(2), degre(4), degre(6), degre(8)].forEach((freq, i) =>
    playVoice({ freq, duration: 0.26, type: 'triangle', gain: 0.1, delay: i * 0.07 }),
  );
}

/** Décompte de départ : trois, deux, un… */
export function playCountdownTick(): void {
  playVoice({ freq: 660, duration: 0.09, type: 'square', gain: 0.055, lowpass: 2400 });
}

/** …et la grille s'ouvre. */
export function playCountdownGoSound(): void {
  playVoice({ freq: 990, duration: 0.3, type: 'triangle', gain: 0.1 });
  playVoice({ freq: 1320, duration: 0.34, type: 'triangle', gain: 0.08, delay: 0.05 });
}

/**
 * Palier franchi. Le serveur le calcule déjà et offre cinq indices en plus ;
 * il n'y avait rien pour le dire. Accord chaud, attaque lente : une
 * récompense qui s'installe plutôt qu'elle ne claque.
 */
export function playTierUpSound(): void {
  [261.63, 329.63, 392, 523.25].forEach((freq, i) =>
    playVoice({ freq, duration: 1.2, type: 'triangle', gain: 0.07, delay: i * 0.05, attack: 0.09 }),
  );
  playVoice({ freq: 1046.5, duration: 0.7, type: 'sine', gain: 0.05, delay: 0.35 });
}

/** Série du jour prolongée : un pop court et satisfaisant. */
export function playStreakSound(): void {
  playNoise({ duration: 0.03, gain: 0.05, bandpass: 1800, q: 1.3 });
  playVoice({ freq: degre(4), duration: 0.14, type: 'triangle', gain: 0.09, glideTo: degre(6) });
}

/** Notification légère (demande d'ami reçue) — un repère, pas une alerte. */
export function playNoticeSound(): void {
  playVoice({ freq: degre(5), duration: 0.12, type: 'sine', gain: 0.06 });
  playVoice({ freq: degre(7), duration: 0.16, type: 'sine', gain: 0.05, delay: 0.07 });
}

// ---------------------------------------------------------------------------
// Haptique
// ---------------------------------------------------------------------------

export function hapticTick(): void {
  vibrate(8);
}

/** Sélection : plus léger encore que la frappe. */
export function hapticSelect(): void {
  vibrate(5);
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

/** Fin de duel : une seule secousse pleine, pas une fanfare haptique. */
export function hapticMatchEnd(): void {
  vibrate([40, 60, 120]);
}

// --- Howler, prêt pour de vrais sons travaillés ---
//
// Tout ci-dessus est synthétisé : aucun fichier à embarquer, et le rendu
// reste cohérent d'un son à l'autre parce qu'ils sortent tous du même bus.
// Si un jour deux ou trois moments méritent un vrai enregistrement — la
// victoire et l'appariement sont les meilleurs candidats — c'est ici qu'ils
// se branchent, en gardant le reste tel quel :
//
// import { Howl } from 'howler';
//
// const victoire = new Howl({ src: ['/sounds/victoire.mp3'], volume: 0.6 });
// export function playVictorySound(): void {
//   if (muted) return;
//   victoire.play();
// }
