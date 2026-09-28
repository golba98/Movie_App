const LOCALE = 'en-ZA'

const pad = (value: number) => String(value).padStart(2, '0')

export function formatRating(rating: number | null | undefined) {
  return typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : 'Not rated'
}

/** A calendar date from TMDB, e.g. "2024-03-01" → "1 March 2024". */
export function formatDate(date: string | null | undefined) {
  if (!date) return 'Not available'
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(parsed)
}

/** A timestamp in milliseconds, or "Never". */
export function formatDateTime(value: number | null) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

/** A runtime in minutes, e.g. 135 → "2h 15m". */
export function formatRuntime(runtime: number | null | undefined) {
  if (!runtime || runtime <= 0) return 'Not available'
  const hours = Math.floor(runtime / 60)
  const minutes = runtime % 60
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** A player clock in m:ss; minutes keep counting past the hour. */
export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/** A resume point in h:mm:ss, or m:ss under an hour. */
export function formatResumeTime(seconds: number) {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return hours ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`
}
