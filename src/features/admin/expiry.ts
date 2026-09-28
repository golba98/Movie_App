const DAY_MS = 86_400_000

const pad = (value: number) => String(value).padStart(2, '0')

/** A timestamp as a local yyyy-mm-dd value for <input type="date">. */
export function dateInputValue(value: number | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Accounts expire at the end of the chosen local day; empty means never. */
export function expiryValue(value: string) {
  return value ? new Date(`${value}T23:59:59`).getTime() : null
}

/** The earliest expiry the form accepts: tomorrow, worked out when asked so it never goes stale. */
export const minExpiryDate = () => dateInputValue(Date.now() + DAY_MS)
