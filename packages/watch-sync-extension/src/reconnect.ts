export function reconnectDelayMs(attempt: number, random = Math.random) {
  const base = Math.min(20_000, 500 * 2 ** Math.max(0, attempt))
  return Math.round(base * (0.8 + random() * 0.4))
}
