import { useState } from 'react';
import { motion } from 'framer-motion';
import { login, register, type Session } from '../lib/auth';

/**
 * Connexion et inscription.
 *
 * Le jeu reste jouable sans compte : cet écran est toujours facultatif. Un
 * compte sert uniquement à retrouver sa progression sur un autre appareil, ou
 * après effacement des données du navigateur.
 */
export function AuthScreen({
  onDone,
  onClose,
  initialMode = 'login',
  closeLabel = 'Continuer sans compte',
}: {
  onDone: (session: Session) => void;
  onClose: () => void;
  initialMode?: 'login' | 'register';
  closeLabel?: string;
}) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const valider = async () => {
    setErreur(null);
    setEnCours(true);
    const res = mode === 'login'
      ? await login(username, password).catch(() => 'Serveur injoignable')
      : await register(username, password).catch(() => 'Serveur injoignable');
    setEnCours(false);
    if (typeof res === 'string') setErreur(res);
    else onDone(res);
  };

  const champ =
    'w-full rounded-full border border-white/25 bg-white/15 px-4 py-2.5 text-center font-display text-[15px] font-bold text-white placeholder:font-medium placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40';

  return (
    <div className="flex min-h-0 w-full max-w-[340px] flex-1 flex-col items-center justify-center gap-4 px-5">
      <h1 className="font-display text-xl font-bold text-white">
        {mode === 'login' ? 'Connexion' : 'Créer un compte'}
      </h1>

      {mode === 'register' && (
        <p className="text-center text-[12px] text-white/55">
          Votre progression actuelle sera conservée.
        </p>
      )}

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        autoCapitalize="none"
        autoComplete="username"
        placeholder="Pseudo"
        aria-label="Pseudo"
        className={champ}
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void valider();
          e.stopPropagation();
        }}
        type="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        placeholder="Mot de passe"
        aria-label="Mot de passe"
        className={champ}
      />

      {erreur && <p className="text-center text-[12px] font-bold text-rose-300">{erreur}</p>}

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        disabled={enCours || !username || !password}
        onClick={() => void valider()}
        className="w-full rounded-full bg-gradient-to-r from-aurora-coral to-aurora-amber py-3 font-display text-[15px] font-bold text-white shadow-xl disabled:opacity-40"
      >
        {enCours ? '…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
      </motion.button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setErreur(null);
        }}
        className="text-[12px] font-bold text-white/60 underline underline-offset-2"
      >
        {mode === 'login' ? 'Pas encore de compte ?' : 'J’ai déjà un compte'}
      </button>

      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-white/15 px-5 py-2 text-[13px] font-bold text-white/80 active:scale-95"
      >
        {closeLabel}
      </button>
    </div>
  );
}
