import { useCallback, useEffect, useState } from 'react'

interface RequestState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

const initialState = <T,>(): RequestState<T> => ({ data: null, loading: true, error: null })

export function useRequest<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<RequestState<T>>(initialState)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: true, error: null }))

    loader(controller.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
        setState({ data: null, loading: false, error: message })
      })

    return () => controller.abort()
  }, [loader, attempt])

  const retry = useCallback(() => setAttempt((current) => current + 1), [])
  return { ...state, retry }
}
