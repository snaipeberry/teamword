/**
 * Vérification des jetons d'identité Google / Apple ("Se connecter avec…").
 *
 * Les DEUX flux (JS SDK Google Identity Services, JS SDK Apple) renvoient un
 * jeton d'identité — un JWT signé PAR Google/Apple, pas par nous. On vérifie
 * sa signature contre leurs clés publiques (JWKS, mises en cache et
 * rafraîchies automatiquement par `jose`), jamais un secret client : ce
 * flux "vérifier un id_token" n'en a besoin d'aucun, contrairement à
 * l'échange de code d'autorisation server-to-server (qu'on n'utilise pas
 * ici — inutilement plus complexe pour ce qu'on veut faire : juste savoir
 * qui vient de s'authentifier).
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * @returns {Promise<{sub: string, email: string|null, name: string|null}>}
 * @throws si le jeton est invalide, expiré, ou ne nous est pas destiné.
 */
export async function verifyGoogleIdToken(idToken, clientId) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  });
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

/**
 * @returns {Promise<{sub: string, email: string|null}>}
 * Apple ne renvoie le nom que dans la réponse JS du CLIENT au tout premier
 * consentement (jamais dans le jeton, jamais aux connexions suivantes) —
 * c'est pourquoi `name` n'est pas ici : l'appelant le transmet séparément,
 * lu depuis cette même première réponse, quand il est disponible.
 */
export async function verifyAppleIdToken(idToken, audience) {
  const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
    issuer: 'https://appleid.apple.com',
    audience,
  });
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
  };
}
