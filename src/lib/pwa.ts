/**
 * Mise à jour de l'application après un déploiement.
 *
 * Le service worker précache `index.html` et sert TOUTES les navigations
 * depuis ce cache (voir `navigateFallback` dans la configuration Workbox).
 * Autrement dit, la page affichée vient toujours du cache : un déploiement
 * s'installe en arrière-plan, prend même le contrôle de l'onglet grâce à
 * `skipWaiting` + `clientsClaim`, mais la page DÉJÀ rendue continue de faire
 * tourner l'ancien code. Sans le rechargement ci-dessous, on ne voit la
 * nouvelle version qu'au chargement suivant — d'où l'impression tenace
 * qu'il faut un onglet privé pour être à jour.
 */

/** Une PWA installée peut rester ouverte des heures sans jamais naviguer :
 *  sans cette vérification régulière, elle ne découvrirait un déploiement
 *  qu'au prochain démarrage à froid. */
const INTERVALLE_VERIF_MS = 60_000;

export function startAppUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  // Le worker n'est produit qu'au build : en développement il n'y a rien à
  // enregistrer, et un worker résiduel masquerait les modules servis par Vite.
  if (import.meta.env.DEV) return;

  // Capturé AVANT tout enregistrement : à la toute première visite, le worker
  // prend le contrôle d'une page qui n'en avait pas, et `controllerchange` se
  // déclenche alors qu'il n'y a rien de périmé à rafraîchir. Recharger là
  // ferait clignoter l'application sans raison.
  const avaitUnControleur = navigator.serviceWorker.controller !== null;
  let rechargementLance = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitUnControleur || rechargementLance) return;
    // En pleine partie, on ne coupe pas le joueur : le nouveau worker
    // contrôle déjà l'onglet, donc la prochaine navigation (retour au menu,
    // fin de manche) servira d'elle-même la nouvelle version.
    if (new URLSearchParams(window.location.search).has('session')) return;
    rechargementLance = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        window.setInterval(() => void registration.update(), INTERVALLE_VERIF_MS);
        // Revenir sur l'onglet est le moment le plus probable pour découvrir
        // un déploiement fait entre-temps, et le moins coûteux pour recharger.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration.update();
        });
      })
      .catch(() => {});
  });
}
