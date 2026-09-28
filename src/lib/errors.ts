import { ApiClientError } from './api-client'

/** Any error's message, or the fallback for non-errors. */
export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** A message the API chose to show; anything else (a bug, a crash) gets the fallback. */
export function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback
}
