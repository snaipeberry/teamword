/**
 * Amorçage spécifique à la coque native (Capacitor). No-op complet sur le
 * web : chaque fonction vérifie `isNativePlatform()` avant de toucher quoi
 * que ce soit, donc ce module reste sûr à importer inconditionnellement
 * depuis du code partagé web/natif.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/**
 * Referme l'écran de démarrage natif une fois le premier rendu React
 * effectivement peint. `launchAutoHide: false` dans capacitor.config.ts
 * confie ce moment à l'app plutôt qu'à un délai fixe arbitraire — sans quoi
 * l'écran de démarrage resterait affiché indéfiniment.
 */
export async function hideSplashScreen(): Promise<void> {
  if (!isNative) return;
  const { SplashScreen } = await import('@capacitor/splash-screen');
  await SplashScreen.hide();
}
