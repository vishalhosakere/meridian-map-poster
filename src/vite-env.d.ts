/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** overpass.ch API key. Without it Meridian uses the public Overpass mirrors only. */
  readonly VITE_OVERPASS_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
