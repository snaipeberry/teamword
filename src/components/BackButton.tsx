/**
 * Retour à l'écran précédent — toujours une petite flèche en haut à gauche.
 *
 * Un seul geste de retour, au même endroit sur tous les écrans : c'est ce
 * qu'on attend d'une application mobile. Remplace les boutons « Retour »
 * posés en bas de page, qui changeaient de place d'un écran à l'autre.
 */
export function BackButton({
  onClick,
  label = 'Menu',
}: {
  onClick: () => void;
  /** Destination, pour dire OÙ l'on revient plutôt qu'un « Retour » nu. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Retour vers ${label}`}
      // `min-h-11` (44px) : la cible tactile réelle, invisible, dépasse
      // largement le texte — avant, ~20px de haut sur un geste utilisé sur
      // CHAQUE écran. Le `-ml-2`/`pl-2` compense le padding ajouté pour que
      // le texte reste exactement au même endroit visuellement.
      className="-ml-2 flex min-h-11 shrink-0 items-center self-start pl-2 pr-3 text-[13px] font-bold text-organic-neutral-700 active:text-organic-accent-700"
    >
      ← {label}
    </button>
  );
}
