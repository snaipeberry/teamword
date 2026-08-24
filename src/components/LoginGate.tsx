import { useState } from 'react';
import { motion } from 'framer-motion';
import { AuthScreen } from './Auth';
import { skipGateForThisTab } from '../lib/auth';

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

  if (mode !== 'menu') {
    return (
      <AuthScreen
        initialMode={mode}
        onClose={terminer}
        onDone={() => terminer()}
        closeLabel="← Retour au choix"
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full max-w-[360px] flex-1 flex-col items-center justify-center gap-4 px-5">
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-amber-200 via-orange-100 to-rose-200 bg-clip-text text-center font-display text-3xl font-bold text-transparent drop-shadow"
      >
        TeamWords
      </motion.h1>
      <p className="text-center text-[12px] font-medium text-white/60">Comment voulez-vous jouer ?</p>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setMode('login')}
        className="w-full rounded-2xl bg-gradient-to-r from-aurora-coral to-aurora-amber py-3 font-display text-[15px] font-bold text-white shadow-xl"
      >
        🔐 Se connecter
        <span className="mt-0.5 block text-[11px] font-medium text-white/70">
          Retrouvez votre progression et votre classement
        </span>
      </motion.button>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setMode('register')}
        className="w-full rounded-2xl border border-amber-200/40 bg-gradient-to-r from-amber-400/25 to-orange-400/25 py-3 font-display text-[15px] font-bold text-white shadow-xl backdrop-blur-md"
      >
        ✨ Créer un compte
        <span className="mt-0.5 block text-[11px] font-medium text-white/60">
          Sauvegardez vos points — solo, grille du jour, classement
        </span>
      </motion.button>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={terminer}
        className="w-full rounded-2xl bg-white/12 py-3 font-display text-[15px] font-bold text-white/90"
      >
        👤 Continuer en invité
        <span className="mt-0.5 block text-[11px] font-medium text-white/50">
          Multijoueur uniquement — nom généré, rien n’est sauvegardé
        </span>
      </motion.button>
    </div>
  );
}
