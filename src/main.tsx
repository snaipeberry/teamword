import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { hideSplashScreen } from './lib/native';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Une frame après le rendu initial : le premier contenu est peint, l'écran
// de démarrage natif peut céder la place sans flash de blanc entre les deux.
requestAnimationFrame(() => void hideSplashScreen());
