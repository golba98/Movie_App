import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../lib/errors'

interface RequestState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

const initialState = <T,>(): RequestState<T> => ({ data: null, loading: true, error: null })

/**
 * Runs `loader` whenever its identity changes, aborting the previous request.
 * Keep the loader stable (useCallback) or it refetches every render.
 */
export function useRequest<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<RequestState<T>>(initialState)
  const [attempt, setAttempt] = useState(0)

  // Reset during render when the loader changes (e.g. another movie is picked).
  // Waiting for the effect would paint the previous result for one frame.
  const [tracked, setTracked] = useState({ loader })
  if (tracked.loader !== loader) {
    setTracked({ loader })
    setState(initialState)
  }

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: true, error: null }))

    loader(controller.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ data: null, loading: false, error: errorMessage(error, 'Something went wrong. Please try again.') })
      })

    return () => controller.abort()
  }, [loader, attempt])

  const retry = useCallback(() => setAttempt((current) => current + 1), [])
  return { ...state, retry }
}
