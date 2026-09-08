/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REALTIME_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_PUZZLE_API_URL?: string;
  readonly VITE_LIVEBLOCKS_PUBLIC_KEY?: string;
  /** "Se connecter avec Google/Apple" — voir src/lib/oauthProviders.ts et .env.example. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_APPLE_SERVICES_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
