import { activePlayerId, currentSession } from './auth';
import { pingPresence } from './roomClient';

/**
 * Présence — « qui est devant l'application, là, maintenant ».
 *
 * Le socket temps réel ne s'ouvre QUE dans une partie (voir `GameState.tsx`).
 * S'y fier seul revenait à déclarer hors ligne un ami en train de parcourir
 * l'accueil ou le classement, c'est-à-dire exactement quelqu'un de joignable.
 * D'où ce battement HTTP, indépendant des salles et vivant sur tous les
 * écrans.
 *
 * Rythme volontairement lent : une pastille de statut n'a pas besoin d'être
 * à la seconde près, et le serveur tolère un ping manqué (`PRESENCE_TTL_MS`
 * y vaut plus de deux battements).
 */
export const PRESENCE_PING_MS = 30_000;

let demarre = false;

/**
 * Lance le battement pour toute la durée de vie de l'application.
 *
 * Rien à arrêter : appelé une fois au démarrage (voir `main.tsx`), il
 * s'interrompt de lui-même dès que l'onglet passe en arrière-plan — un
 * téléphone verrouillé dans une poche n'est pas une présence.
 */
export function startPresence(): void {
  // Un invité n'apparaît dans la liste d'amis de personne : le faire battre
  // ne créerait que du trafic et un profil serveur jetable.
  if (demarre || !currentSession()) return;
  demarre = true;

  const battre = () => {
    if (document.visibilityState !== 'visible') return;
    void pingPresence(activePlayerId());
  };

  battre();
  window.setInterval(battre, PRESENCE_PING_MS);
  // Au retour à l'écran, on ne veut pas attendre le prochain tour de boucle :
  // c'est précisément l'instant où l'on redevient joignable.
  document.addEventListener('visibilitychange', battre);
}
