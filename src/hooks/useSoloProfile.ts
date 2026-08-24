import { useCallback, useEffect, useState } from 'react';
import { fetchProfile, type Profile } from '../lib/roomClient';

interface UseSoloProfileResult {
  profile: Profile | null;
  /** Recharge le profil — à appeler après `soloGridDone` pour refléter les
   * points/palier/ampoules à jour (le serveur seul connaît le résultat). */
  refresh: () => void;
}

/**
 * Profil solo (points pondérés, palier, ampoules) d'un joueur.
 *
 * Partagé entre `CrosswordGrid` (désactiver le bouton indice) et
 * `SoloRoundResults` (afficher la progression) : les deux ont besoin des
 * mêmes données, mieux vaut un seul point de fetch que deux copies.
 */
export function useSoloProfile(playerId: string, active: boolean): UseSoloProfileResult {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchProfile(playerId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [playerId, active, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return { profile, refresh };
}
