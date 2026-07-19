const allowedFields = new Set([
  'timestamp', 'kind', 'tabId', 'frameId', 'documentId', 'origin', 'candidateCount', 'fingerprint',
  'permissionState', 'socketState', 'controllerState', 'revision', 'driftMs', 'correction', 'readiness',
  'suppressionReason', 'reconnectAttempt', 'message',
])

const sensitiveKey = /token|authorization|header|cookie|query|src|source|url/i
const bearerLike = /bearer\s+[a-z0-9._~-]+/gi
const queryLike = /([?&][^=\s]+)=([^&#\s]+)/g

export function redactDiagnosticValue(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[redacted]'
  if (typeof value === 'string') {
    return value.replace(bearerLike, 'Bearer [redacted]').replace(queryLike, '$1=[redacted]')
  }
  if (Array.isArray(value)) return value.map((entry) => redactDiagnosticValue(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactDiagnosticValue(entryValue, entryKey)]))
  }
  return value
}

export class DiagnosticRing {
  private entries: Record<string, unknown>[] = []

  constructor(private readonly capacity = 500) {}

  add(entry: Record<string, unknown>) {
    const safe = Object.fromEntries(
      Object.entries(entry)
        .filter(([key]) => allowedFields.has(key))
        .map(([key, value]) => [key, redactDiagnosticValue(value, key)]),
    )
    safe.timestamp = typeof safe.timestamp === 'number' ? safe.timestamp : Date.now()
    this.entries.push(safe)
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity)
  }

  export() {
    return this.entries.map((entry) => ({ ...entry }))
  }

  get size() {
    return this.entries.length
  }
}
