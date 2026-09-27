interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
    fieldErrors?: Record<string, string>
  }
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = 'REQUEST_FAILED',
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiClientError('Unable to reach the service. Check your connection.', 0, 'NETWORK_ERROR')
  }

  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload & { data?: T }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/admin/')) {
      window.dispatchEvent(new Event('fedora:auth-expired'))
    }
    throw new ApiClientError(
      payload.error?.message ?? 'The request could not be completed.',
      response.status,
      payload.error?.code,
      payload.error?.fieldErrors,
    )
  }
  return payload.data as T
}
