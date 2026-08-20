/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_PUZZLE_API_URL?: string;
  readonly VITE_LIVEBLOCKS_PUBLIC_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
