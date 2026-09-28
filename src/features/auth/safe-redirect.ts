/** Only same-origin paths are followed after sign-in; anything else goes home. */
export function safeNext(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export const changePasswordPath = (next: string) => `/change-password?next=${encodeURIComponent(next)}`
