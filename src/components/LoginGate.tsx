import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthScreen } from './Auth';
import { skipGateForThisTab } from '../lib/auth';
import { screenClassName, screenTransition, screenVariants } from '../lib/motion';

/**
 * Portail d'entrée : connexion, création de compte, ou invité.
 *
 * Montré une fois par onglet tant qu'aucun compte n'est connecté (voir
 * `shouldSkipGate`/`skipGateForThisTab`) — sinon rejoindre une partie, qui
 * recharge la page, redemanderait « connecté / invité » avant CHAQUE partie.
 * Le choix invité lui-même reste sans stockage : c'est le passage du portail
 * qu'on retient, pas l'identité qui en sort (voir auth.ts).
 */
export function LoginGate({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'menu' | 'login' | 'register'>('menu');

  const terminer = () => {
    skipGateForThisTab();
    onDone();
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode}
        variants={screenVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={screenTransition}
        className={screenClassName}
      >
        {mode !== 'menu' ? (
          <AuthScreen
            initialMode={mode}
            onClose={terminer}
            onDone={() => terminer()}
            closeLabel="← Retour au choix"
          />
        ) : (
    <div className="flex min-h-0 w-full max-w-[360px] flex-1 flex-col items-center justify-center gap-4 px-5">
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center font-display text-4xl leading-none text-organic-text"
      >
        TeamWords
      </motion.h1>
      <p className="text-center text-[12px] font-medium text-organic-neutral-700">Comment voulez-vous jouer ?</p>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setMode('login')}
        className="w-full rounded-[28px] bg-organic-accent-500 py-4 text-left shadow-md active:bg-organic-accent-600"
      >
        <span className="block px-5 font-display text-[19px] text-organic-bg">Se connecter</span>
        <span className="mt-0.5 block px-5 text-[12px] font-semibold text-organic-bg/80">
          Retrouvez votre progression et votre classement
        </span>
      </motion.button>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setMode('register')}
        className="w-full rounded-[28px] border border-organic-divider bg-organic-neutral-100 py-4 text-left active:bg-organic-neutral-200"
      >
        <span className="block px-5 font-display text-[19px] text-organic-text">Créer un compte</span>
        <span className="mt-0.5 block px-5 text-[12px] font-semibold text-organic-neutral-700">
          Sauvegardez vos points — solo, grille du jour, classement
        </span>
      </motion.button>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={terminer}
        className="w-full rounded-[28px] py-4 text-left active:bg-organic-neutral-200"
      >
        <span className="block px-5 font-display text-[19px] text-organic-text">Continuer en invité</span>
        <span className="mt-0.5 block px-5 text-[12px] font-semibold text-organic-neutral-600">
          Multijoueur uniquement — nom généré, rien n’est sauvegardé
        </span>
      </motion.button>
    </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
