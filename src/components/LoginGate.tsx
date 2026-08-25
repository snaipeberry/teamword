import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthScreen } from './Auth';
import { skipGateForThisTab } from '../lib/auth';
import { screenClassName, screenShell, screenTransition, screenVariants } from '../lib/motion';

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
    <div className={screenShell}>
      <motion.p
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-[11px] font-bold uppercase tracking-[0.12em] text-organic-accent-700"
      >
        Mots fléchés à plusieurs
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-0.5 font-display text-[40px] leading-none text-organic-text"
      >
        TeamWords
      </motion.h1>
      <p className="mt-2 text-[12.5px] font-medium text-organic-neutral-700">Comment voulez-vous jouer ?</p>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setMode('login')}
        className="mt-6 w-full rounded-[28px] bg-organic-accent-500 py-4 text-left shadow-md active:bg-organic-accent-600"
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
        className="mt-3 w-full rounded-[28px] border border-organic-divider bg-organic-neutral-100 py-4 text-left active:bg-organic-neutral-200"
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
        className="mt-3 w-full rounded-[28px] border border-transparent py-4 text-left active:bg-organic-neutral-200"
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
