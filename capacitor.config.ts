import type { CapacitorConfig } from '@capacitor/cli';

// #f5ead8 = organic-bg (tailwind.config.js) — même couleur que le
// theme-color de index.html, pour qu'écran de démarrage, barre de statut et
// premier rendu web s'enchaînent sans à-coup de couleur perceptible.
const ORGANIC_BG = '#f5ead8';

const config: CapacitorConfig = {
  appId: 'com.teamwords.app',
  appName: 'TeamWords',
  webDir: 'dist',
  backgroundColor: ORGANIC_BG,
  plugins: {
    SplashScreen: {
      backgroundColor: ORGANIC_BG,
      showSpinner: false,
      // L'app se veut instantanée dès l'ouverture ; un délai fixe long
      // donnerait l'impression inverse. `hide()` est appelé manuellement
      // une fois React monté (voir main.tsx) plutôt que de compter sur un
      // minimum de temps arbitraire.
      launchAutoHide: false,
    },
    StatusBar: {
      style: 'LIGHT', // texte sombre sur fond clair (crème Organic)
      backgroundColor: ORGANIC_BG,
      overlaysWebView: false,
    },
  },
};

export default config;
