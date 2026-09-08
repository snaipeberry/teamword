import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { login, oauthLogin, register, type Session } from '../lib/auth';
import { renderGoogleButton, signInWithApple } from '../lib/oauthProviders';
import { screenShell } from '../lib/motion';

/**
 * Connexion et inscription.
 *
 * Le jeu reste jouable sans compte : cet écran est toujours facultatif. Un
 * compte sert uniquement à retrouver sa progression sur un autre appareil, ou
 * après effacement des données du navigateur.
 *
 * Google/Apple créent un compte exactement comme le formulaire pseudo/mot de
 * passe (même `/oauth/callback` → même reprise de progression invité) —
 * simplement sans mot de passe à retenir. Apple n'est pas là que par
 * confort : Apple l'EXIGE (règle 4.8) dès qu'on propose une autre méthode de
 * connexion sur iOS.
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
  const googleButtonRef = useRef<HTMLDivElement>(null);

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

  const viaOAuth = async (provider: 'google' | 'apple', credential: string, name?: string | null) => {
    setErreur(null);
    setEnCours(true);
    const res = await oauthLogin(provider, credential, name).catch(() => 'Serveur injoignable');
    setEnCours(false);
    if (typeof res === 'string') setErreur(res);
    else onDone(res);
  };

  // Le bouton Google est rendu PAR son propre SDK dans ce conteneur (pas un
  // <button> à nous) : on ne peut pas juste le griser via `enCours`, sans
  // que ça vaille la peine de le démonter/remonter pour si peu.
  useEffect(() => {
    if (!googleButtonRef.current) return;
    renderGoogleButton(googleButtonRef.current, (credential) => {
      void viaOAuth('google', credential);
    }).catch(() => {
      // Pas de VITE_GOOGLE_CLIENT_ID configuré, ou SDK injoignable : le
      // bouton pseudo/mot de passe reste utilisable, on n'affiche rien.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const champ =
    'w-full rounded-full border border-organic-divider bg-organic-neutral-100 px-5 py-2.5 text-left font-display text-[15px] text-organic-text placeholder:font-medium placeholder:text-organic-neutral-500 focus:outline-none focus:ring-2 focus:ring-organic-accent-500';

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

      <div className="mt-6 flex w-full flex-col items-center gap-2.5">
        <button
          type="button"
          disabled={enCours}
          onClick={() =>
            void signInWithApple()
              .then(({ idToken, name }) => viaOAuth('apple', idToken, name))
              .catch((e: Error) => setErreur(e.message))
          }
          className="flex w-full max-w-[320px] items-center justify-center gap-2 rounded-full bg-black py-2.5 font-display text-[14px] text-white shadow-sm active:scale-[0.98] disabled:opacity-40"
        >
          {/* Glyphe Apple minimal, pas un émoji — évite d'y mêler du chrome
              décoratif interdit ailleurs dans l'app tout en restant reconnaissable. */}
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden="true">
            <path d="M16.365 1.43c0 1.14-.462 2.096-1.174 2.837-.808.848-2.137 1.512-3.264 1.42-.14-1.13.437-2.293 1.148-3.026C13.83 1.79 15.2 1.156 16.365 1.43zM20.5 17.29c-.457 1.05-.676 1.517-1.264 2.45-.82 1.31-1.976 2.943-3.41 2.956-1.27.013-1.598-.83-3.32-.82-1.72.01-2.083.834-3.354.82-1.434-.014-2.53-1.487-3.35-2.796-2.297-3.65-2.538-7.933-1.12-10.213.995-1.6 2.567-2.54 4.045-2.54 1.505 0 2.452.83 3.7.83 1.21 0 1.945-.832 3.686-.832 1.317 0 2.71.72 3.703 1.96-3.256 1.786-2.727 6.44.184 7.185z" />
          </svg>
          Continuer avec Apple
        </button>

        <div ref={googleButtonRef} />

        <div className="my-1 flex w-full max-w-[320px] items-center gap-3">
          <div className="h-px flex-1 bg-organic-divider" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-organic-neutral-500">ou</span>
          <div className="h-px flex-1 bg-organic-divider" />
        </div>
      </div>

      <div className="mt-1 flex w-full flex-col gap-3">
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
