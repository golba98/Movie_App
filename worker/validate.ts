import { ApiError } from './http'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function positiveInteger(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

/** A trimmed string cut to `max` characters, or '' when the value is not a string. */
export function trimmedString(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Throws a 400 carrying per-field messages when any field failed validation. */
export function assertNoFieldErrors(fieldErrors: Record<string, string>, message = 'Check the highlighted fields.') {
  if (Object.keys(fieldErrors).length) throw new ApiError(400, 'VALIDATION_ERROR', message, fieldErrors)
}

/** Turns a D1 unique-constraint failure into a 409 conflict. */
export function rethrowUniqueViolation(error: unknown, conflict: ApiError): never {
  if (String(error).toLowerCase().includes('unique')) throw conflict
  throw error
}
