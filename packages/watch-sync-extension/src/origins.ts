export function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function originPattern(origin: string) {
  const normalized = normalizeHttpOrigin(origin)
  return normalized ? `${normalized}/*` : null
}

export function discoverFrameOrigins(frames: { frameId: number; url: string }[]) {
  let topOrigin: string | null = null
  const embedded = new Set<string>()
  for (const frame of frames) {
    const origin = normalizeHttpOrigin(frame.url)
    if (!origin) continue
    if (frame.frameId === 0) topOrigin = origin
    else embedded.add(origin)
  }
  if (topOrigin) embedded.delete(topOrigin)
  return { topOrigin, embeddedOrigins: [...embedded].sort() }
}
