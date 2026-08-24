import { motion } from 'framer-motion';
import type { Profile } from '../lib/roomClient';
import { AnimatedNumber } from './AnimatedNumber';

/**
 * Écran de fin de grille en mode solo : pas d'attente, pas de tableau de
 * scores (un seul joueur) — juste les points gagnés, la progression de
 * palier et le solde d'ampoules, puis on enchaîne.
 */
export function SoloRoundResults({
  round,
  pointsEarned,
  profile,
  onAdvance,
}: {
  round: number;
  pointsEarned: number;
  /** `null` tant que le profil n'a pas encore été (re)chargé. */
  profile: Profile | null;
  onAdvance: () => void;
}) {
  const progress =
    profile?.next && profile.tier
      ? Math.min(
          100,
          Math.max(
            0,
            ((profile.soloPoints - profile.tier.min) / (profile.next.min - profile.tier.min)) * 100,
          ),
        )
      : 100;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full max-w-[340px] rounded-3xl bg-gradient-to-br from-white/95 to-white/85 p-5 shadow-2xl"
      >
        <h2 className="text-center font-display text-xl font-bold text-aurora-violet">
          Grille {round + 1} terminée !
        </h2>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-2xl font-display font-bold text-aurora-violet">
          <span>+</span>
          <AnimatedNumber value={pointsEarned} />
          <span className="text-sm font-bold text-neutral-500">points solo</span>
        </div>

        {profile && (
          <div className="mt-4 rounded-2xl bg-black/5 p-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">
                {profile.tier.icon}
              </span>
              <span className="flex-1 text-sm font-bold text-neutral-800">{profile.tier.label}</span>
              <span className="font-display text-sm font-bold tabular-nums text-aurora-violet">
                {profile.soloPoints}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
            <p className="mt-1.5 text-center text-[11px] font-medium text-neutral-500">
              {profile.next
                ? `${profile.pointsToNext} points avant ${profile.next.label}`
                : 'Palier maximum atteint'}
            </p>
          </div>
        )}

        {profile && (
          <p className="mt-3 text-center text-[12px] font-bold text-neutral-500">
            💡 {profile.hintBalance} indice{profile.hintBalance !== 1 ? 's' : ''} disponible
            {profile.hintBalance !== 1 ? 's' : ''}
          </p>
        )}

        <button
          type="button"
          onClick={onAdvance}
          className="mt-5 w-full rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber py-3 font-display text-sm font-bold text-white shadow-lg transition active:scale-95"
        >
          Grille suivante →
        </button>
      </motion.div>
    </motion.div>
  );
}
