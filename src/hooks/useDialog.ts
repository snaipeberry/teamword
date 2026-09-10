import { useEffect, useRef } from 'react';

/**
 * Fait d'un panneau superposé un vrai dialogue.
 *
 * Les feuilles et modales de l'application étaient de simples `div` posées
 * par-dessus : rien ne s'y focalisait, la touche Échap ne les fermait pas, et
 * la tabulation continuait de parcourir l'écran situé DERRIÈRE — un lecteur
 * d'écran lisait donc tranquillement une page que l'utilisateur ne pouvait
 * plus atteindre.
 *
 * Ce hook rend le comportement attendu : focus déplacé à l'ouverture, piégé
 * tant que le dialogue est là, et rendu à son point de départ à la fermeture.
 * L'appelant pose en plus `role="dialog"`, `aria-modal` et un titre.
 */
const FOCUSABLES =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialog<T extends HTMLElement>(ouvert: boolean, fermer: () => void) {
  const ref = useRef<T>(null);
  // Une ref plutôt qu'une dépendance : `fermer` est presque toujours une
  // fonction recréée à chaque rendu, et la mettre en dépendance
  // reconstruirait l'écouteur — donc reprendrait le focus — en continu.
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;

  useEffect(() => {
    if (!ouvert) return;
    const rendreA = document.activeElement as HTMLElement | null;

    // Le premier élément actionnable, à défaut le conteneur lui-même : on
    // entre dans le dialogue plutôt que de rester quelque part derrière.
    const premier = ref.current?.querySelector<HTMLElement>(FOCUSABLES);
    (premier ?? ref.current)?.focus?.();

    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        fermerRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const cibles = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLES)];
      if (cibles.length === 0) return;
      const debut = cibles[0];
      const fin = cibles[cibles.length - 1];
      if (e.shiftKey && document.activeElement === debut) {
        e.preventDefault();
        fin.focus();
      } else if (!e.shiftKey && document.activeElement === fin) {
        e.preventDefault();
        debut.focus();
      }
    };

    // En capture : la grille écoute les touches au niveau de la fenêtre pour
    // la saisie des lettres (voir CrosswordGrid). Sans capture, Échap et la
    // tabulation lui parviendraient d'abord.
    document.addEventListener('keydown', surTouche, true);
    return () => {
      document.removeEventListener('keydown', surTouche, true);
      rendreA?.focus?.();
    };
  }, [ouvert]);

  return ref;
}
