// Watch party is still under development: on in dev, and in production builds
// only with VITE_ENABLE_WATCH_PARTY=true (used to test the extension against
// `vite preview`).
export const watchPartyEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_WATCH_PARTY === 'true'
