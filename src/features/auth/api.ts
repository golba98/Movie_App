import { apiRequest } from '../../lib/api-client'
import type { ViewerAccount } from '../../types/account'

type AccountResponse = { account: ViewerAccount }

export function getSession() {
  return apiRequest<AccountResponse>('/api/auth/session')
}

export function login(username: string, password: string) {
  return apiRequest<AccountResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST', body: '{}' })
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiRequest<AccountResponse>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}
