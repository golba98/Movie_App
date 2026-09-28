import { useEffect, useState } from 'react'

/** `value`, once it has stopped changing for `delay` ms. */
export function useDebounce<T>(value: T, delay = 350) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay)
    return () => window.clearTimeout(timeout)
  }, [value, delay])

  return debouncedValue
}
