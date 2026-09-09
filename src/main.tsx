import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { hideSplashScreen } from './lib/native';
import { preloadGoogleAuth } from './lib/oauthProviders';
import { startPresence } from './lib/presence';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Démarré ici plutôt qu'à l'ouverture de l'écran de connexion (LoginGate,
// Profile) : le SDK Google a ainsi toute la durée du premier écran pour se
// charger, et le bouton apparaît immédiatement une fois cet écran atteint
// au lieu de « pop-in » après un délai visible.
preloadGoogleAuth();

// Ici et pas dans un écran : on reste « en ligne » pour ses amis quel que
// soit l'endroit de l'application où l'on se trouve, partie comprise.
startPresence();

// Une frame après le rendu initial : le premier contenu est peint, l'écran
// de démarrage natif peut céder la place sans flash de blanc entre les deux.
requestAnimationFrame(() => void hideSplashScreen());
