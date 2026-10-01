/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public site origin (no trailing slash). Same as server PUBLIC_APP_URL. */
  readonly PUBLIC_APP_URL?: string;
  readonly VITE_PUBLIC_BUILDER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
