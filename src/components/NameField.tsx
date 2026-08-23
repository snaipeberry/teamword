import { useEffect, useState } from 'react';

/**
 * Champ de pseudo. Le nom initial est tiré au sort (« RapideLynx82 ») ; ce
 * champ permet de le remplacer, et le choix est conservé d'une partie à
 * l'autre dans le navigateur.
 */
export function NameField({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (name: string) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  // Le nom peut changer ailleurs (autre onglet, salon) : on resynchronise,
  // sans écraser ce que le joueur est en train de taper.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const clean = draft.trim();
    if (clean && clean !== value) onChange(clean);
    else setDraft(value);
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        // Le jeu écoute les touches au niveau de la fenêtre pour le clavier
        // physique : sans cela, taper son nom remplirait aussi la grille.
        e.stopPropagation();
      }}
      maxLength={16}
      aria-label="Votre nom"
      placeholder="Votre nom"
      className={`min-w-0 rounded-full border border-white/25 bg-white/15 text-center font-display font-bold text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40 ${
        compact ? 'px-2 py-1 text-[12px]' : 'w-full px-4 py-2.5 text-[15px]'
      }`}
    />
  );
}
