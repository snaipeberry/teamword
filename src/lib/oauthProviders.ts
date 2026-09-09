/**
 * Chargement des SDK JS Google / Apple et récupération du jeton d'identité
 * brut — la VÉRIFICATION de ce jeton se fait côté serveur (voir
 * server/websocket/oauth.js), jamais ici : un client ne peut jamais être une
 * source de vérité pour sa propre identité.
 *
 * Les deux flux fonctionnent en web comme dans la coque Capacitor (une
 * WebView), sans plugin natif — au prix d'une popup plutôt que la feuille
 * native `ASAuthorizationController` sur iOS. Un plugin natif dédié reste
 * une amélioration possible plus tard, pas un blocage pour fonctionner.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
    AppleID?: {
      auth: {
        init: (config: {
          clientId: string;
          scope: string;
          redirectURI: string;
          usePopup: boolean;
        }) => void;
        signIn: () => Promise<{
          authorization: { id_token: string };
          user?: { name?: { firstName?: string; lastName?: string } };
        }>;
      };
    };
  }
}

function loadScript(src: string, isReady: () => boolean): Promise<void> {
  if (isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Échec de chargement : ${src}`));
    document.head.appendChild(script);
  });
}

// Mémorisée : sans ce cache, un `preloadGoogleAuth()` précoce PUIS le
// `renderGoogleButton` de l'écran de connexion injecteraient chacun leur
// propre <script>, en double — un seul chargement, partagé par tous les
// appelants.
let googleScript: Promise<void> | null = null;
function ensureGoogleScript(): Promise<void> {
  if (!googleScript) {
    googleScript = loadScript('https://accounts.google.com/gsi/client', () => Boolean(window.google?.accounts?.id));
  }
  return googleScript;
}

/**
 * Démarre le chargement du SDK Google DE LOIN à l'avance (voir l'appel dans
 * main.tsx) — sans ça, le bouton ne commençait à se charger qu'à l'ouverture
 * de l'écran de connexion, d'où un « pop-in » visible une fois la page déjà
 * affichée. Volontairement sans awaited ni valeur de retour : un échec (pas
 * de clé configurée, réseau injoignable) ne doit strictement rien changer à
 * l'affichage tant que personne n'a encore ouvert cet écran.
 */
export function preloadGoogleAuth(): void {
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()) return;
  ensureGoogleScript().catch(() => {});
}

/**
 * Affiche le bouton Google officiel dans `container` et appelle
 * `onCredential` avec le jeton d'identité (JWT) dès qu'un utilisateur
 * s'authentifie. `VITE_GOOGLE_CLIENT_ID` doit être renseigné — voir
 * .env.example pour où l'obtenir.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  onCredential: (idToken: string) => void,
): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error('Connexion Google indisponible pour le moment');

  await ensureGoogleScript();

  window.google!.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
  });
  window.google!.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    width: 320,
    text: 'continue_with',
    shape: 'pill',
  });
}

/**
 * Déclenche la fenêtre "Se connecter avec Apple" et renvoie son jeton
 * d'identité. `name` n'est renvoyé par Apple qu'au tout premier consentement
 * de l'utilisateur — jamais ensuite, même en cas de reconnexion : c'est
 * pourquoi il faut le capturer ICI et le transmettre au serveur, qui ne
 * pourra plus jamais le redemander à Apple par la suite.
 */
export async function signInWithApple(): Promise<{ idToken: string; name: string | null }> {
  const clientId = import.meta.env.VITE_APPLE_SERVICES_ID?.trim();
  if (!clientId) throw new Error('Connexion Apple indisponible pour le moment');

  await loadScript(
    'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
    () => Boolean(window.AppleID),
  );

  window.AppleID!.auth.init({
    clientId,
    scope: 'name email',
    // Doit correspondre EXACTEMENT à la Return URL enregistrée sur le
    // Services ID Apple (voir .env.example) — la racine de l'app suffit,
    // aucune route dédiée : le SDK Apple gère la relève via la popup.
    redirectURI: window.location.origin,
    usePopup: true,
  });

  const res = await window.AppleID!.auth.signIn();
  const name = res.user?.name
    ? [res.user.name.firstName, res.user.name.lastName].filter(Boolean).join(' ') || null
    : null;
  return { idToken: res.authorization.id_token, name };
}
