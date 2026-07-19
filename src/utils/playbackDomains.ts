// The hosts the third-party playback chain actually depends on, in load order:
// vidsrc.to (embed entry) → vsembed.ru (player shell) → cloudorchestranova.com
// (stream resolver) → cloudnestra.com (final stream host). A break anywhere in
// this chain surfaces as "This media is unavailable at the moment." inside the
// player iframe, so the diagnostics reachability checks probe every hop — not a
// stale list of vidsrc mirrors that playback never touches.
export const PLAYBACK_CHAIN_DOMAINS = [
  'https://vidsrc.to',
  'https://vsembed.ru',
  'https://cloudorchestranova.com',
  'https://cloudnestra.com',
] as const
