// Watch party is still under development: enabled in dev, and in production
// builds only when VITE_ENABLE_WATCH_PARTY=true is set at build time
// (used for extension testing against `vite preview`).
export const watchPartyEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_WATCH_PARTY === 'true'
