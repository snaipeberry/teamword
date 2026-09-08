import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Identifiant du build affiché en tout petit au pied de l'accueil — utile
 * pour vérifier QUELLE version tourne réellement en prod (un déploiement qui
 * traîne, un cache de service worker périmé, voir les mésaventures de cette
 * session). `VERCEL_GIT_COMMIT_SHA` est déjà posé par Vercel à la build,
 * sans dépendre de la présence du dossier `.git` dans son environnement de
 * build ; `git rev-parse` reste le repli pour un build local.
 */
function getBuildVersion(): string {
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha) return vercelSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(getBuildVersion()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Mots Fléchés',
        short_name: 'Mots Fléchés',
        description: 'Mots fléchés multijoueur en temps réel',
        theme_color: '#F5A623',
        background_color: '#FFF8EC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    // En production, /api/puzzle est servi par la fonction serverless
    // (api/puzzle.py) sur la même origine. En dev, on redirige vers le
    // serveur Python local pour que le front appelle exactement la même URL
    // des deux côtés — pas de variable d'environnement à gérer.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // Routes HTTP du service temps réel (classement, profils).
      '/rt': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rt/, ''),
      },
      // Serveur temps réel des parties (server/index.js).
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
        rewrite: (p) => p.replace(/^\/ws/, ''),
      },
    },
  },
});
