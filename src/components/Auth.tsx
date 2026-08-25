import { useState } from 'react';
import { motion } from 'framer-motion';
import { login, register, type Session } from '../lib/auth';
import { screenShell } from '../lib/motion';

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
    'w-full rounded-full border border-organic-divider bg-organic-neutral-100 px-4 py-2.5 text-center font-display text-[15px] text-organic-text placeholder:font-medium placeholder:text-organic-neutral-500 focus:outline-none focus:ring-2 focus:ring-organic-accent-500';

  return (
    <div className={screenShell}>
      <h1 className="font-display text-[30px] leading-none text-organic-text">
        {mode === 'login' ? 'Connexion' : 'Créer un compte'}
      </h1>

      {mode === 'register' && (
        <p className="mt-2 text-[12.5px] text-organic-neutral-700">
          Votre progression actuelle sera conservée.
        </p>
      )}

      <div className="mt-6 flex w-full flex-col gap-3">
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

      {erreur && <p className="text-center text-[12px] font-bold text-organic-accent-700">{erreur}</p>}

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        disabled={enCours || !username || !password}
        onClick={() => void valider()}
        className="w-full rounded-full bg-organic-accent-500 py-3.5 font-display text-[15px] text-organic-bg shadow-md active:bg-organic-accent-600 disabled:opacity-40"
      >
        {enCours ? '…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
      </motion.button>
      </div>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setErreur(null);
        }}
        className="mt-4 self-center text-[12px] font-bold text-organic-neutral-700 underline underline-offset-2"
      >
        {mode === 'login' ? 'Pas encore de compte ?' : 'J’ai déjà un compte'}
      </button>

      <button
        type="button"
        onClick={onClose}
        className="mb-3.5 mt-auto self-center rounded-full bg-organic-neutral-100 px-6 py-2.5 text-[13px] text-organic-text active:scale-95"
      >
        {closeLabel}
      </button>
    </div>
  );
}
