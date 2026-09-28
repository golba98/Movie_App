import { useCallback, useState } from 'react'
import { apiErrorMessage } from '../../lib/errors'

/**
 * Busy, error and notice state for admin forms. `run` marks one item busy,
 * clears the previous messages, and turns a failure into an error message.
 */
export function useAdminAction(fallbackError: string) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const run = useCallback(async (busyKey: string, action: () => Promise<void>, failure = fallbackError) => {
    setBusyId(busyKey)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (caught) {
      setError(apiErrorMessage(caught, failure))
    } finally {
      setBusyId(null)
    }
  }, [fallbackError])

  return { busyId, error, notice, setError, setNotice, run }
}
