import { motion } from 'framer-motion';
import type { Profile } from '../lib/roomClient';
import { AnimatedNumber } from './AnimatedNumber';
import { ResultModal } from './ResultModal';

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
    <ResultModal label={`Grille ${round + 1} terminée`}>
        <h2 className="text-center font-display text-[20px] text-organic-text">
          Grille {round + 1} terminée !
        </h2>

        <div className="mt-4 flex items-center justify-center gap-1.5 font-display text-[24px] text-organic-accent-700">
          <span>+</span>
          <AnimatedNumber value={pointsEarned} />
          <span className="text-[13px] font-bold text-organic-neutral-500">points solo</span>
        </div>

        {profile && (
          <div className="mt-4 rounded-[20px] bg-organic-neutral-100 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[20px]" aria-hidden="true">
                {profile.tier.icon}
              </span>
              <span className="flex-1 text-[14px] font-bold text-organic-text">{profile.tier.label}</span>
              <span className="font-display text-[14px] tabular-nums text-organic-text">
                {profile.soloPoints}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-organic-neutral-300">
              <motion.div
                className="h-full rounded-full bg-organic-accent-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
            <p className="mt-1.5 text-center text-[11px] font-medium text-organic-neutral-500">
              {profile.next
                ? `${profile.pointsToNext} points avant ${profile.next.label}`
                : 'Palier maximum atteint'}
            </p>
          </div>
        )}

        {profile && (
          <p className="mt-3 text-center text-[12px] font-bold text-organic-neutral-600">
            {profile.hintBalance} indice{profile.hintBalance !== 1 ? 's' : ''} disponible
            {profile.hintBalance !== 1 ? 's' : ''}
          </p>
        )}

        <button
          type="button"
          onClick={onAdvance}
          className="mt-5 w-full rounded-full bg-organic-accent-500 py-3 font-display text-[14px] text-organic-bg shadow-md transition active:scale-95 active:bg-organic-accent-600"
        >
          Grille suivante →
        </button>
    </ResultModal>
  );
}
