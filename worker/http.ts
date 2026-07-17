export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(
    { data },
    {
      status,
      headers: { ...securityHeaders, ...headers },
    },
  )
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        },
      },
      { status: error.status, headers: securityHeaders },
    )
  }
  console.error('Unhandled API error', error)
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
    { status: 500, headers: securityHeaders },
  )
}

export async function readJson<T>(request: Request): Promise<T> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'JSON_REQUIRED', 'This endpoint accepts JSON only.')
  }
  try {
    return (await request.json()) as T
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.')
  }
}

export function assertSameOrigin(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'The request origin is not allowed.')
  }
}

export function methodNotAllowed(allowed: string[]) {
  return Response.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } },
    { status: 405, headers: { ...securityHeaders, Allow: allowed.join(', ') } },
  )
}

export function parseCookies(request: Request) {
  const cookies = new Map<string, string>()
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim())
  }
  return cookies
}

export function requestIp(request: Request) {
  return request.headers.get('CF-Connecting-IP') ?? 'local'
}
