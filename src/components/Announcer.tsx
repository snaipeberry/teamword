import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { onAnnounce, type Annonce } from '../lib/announce';

/**
 * Rend les annonces (voir lib/announce.ts) : une pastille flottante pour qui
 * regarde l'écran, et deux régions live pour qui ne le regarde pas.
 *
 * Monté UNE seule fois, à la racine : les régions live doivent exister dans le
 * document AVANT que leur contenu ne change, sinon la plupart des lecteurs
 * d'écran n'annoncent rien du tout. Un composant monté à la demande, au moment
 * du message, arriverait systématiquement trop tard.
 */
export function Announcer() {
  const [annonce, setAnnonce] = useState<Annonce | null>(null);
  useEffect(() => onAnnounce(setAnnonce), []);

  const erreur = annonce?.ton === 'erreur';

  return (
    <>
      {/* Deux régions distinctes et TOUJOURS présentes : une action qui a
          échoué interrompt (assertive), une réussite attend la fin de la
          phrase en cours (polite). Les faire cohabiter dans une seule région
          obligerait à choisir une urgence unique pour les deux. */}
      <div aria-live="polite" aria-atomic="true" role="status" className="sr-only">
        {annonce && !erreur ? annonce.texte : ''}
      </div>
      <div aria-live="assertive" aria-atomic="true" role="alert" className="sr-only">
        {annonce && erreur ? annonce.texte : ''}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+18px)] z-[70] flex justify-center px-4">
        <AnimatePresence>
          {annonce && !annonce.discret && (
            <motion.p
              key={annonce.id}
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              // `aria-hidden` : le texte est déjà porté par les régions
              // ci-dessus. Sans cela il serait énoncé deux fois.
              aria-hidden="true"
              className={`max-w-[92%] rounded-full px-4 py-2 text-center text-[12.5px] font-bold shadow-lg ${
                erreur
                  ? 'bg-organic-accent-700 text-organic-bg'
                  : annonce.ton === 'succes'
                    ? 'bg-organic-accent2-700 text-organic-bg'
                    : 'bg-organic-neutral-900/90 text-organic-bg'
              }`}
            >
              {annonce.texte}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
